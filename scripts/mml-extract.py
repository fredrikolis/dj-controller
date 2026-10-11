#!/usr/bin/env python3
# Concern: reads a Pioneer DDJ MIDI message list PDF into its message rows, or a draft model file | Non-concern: naming controls for good (a person reviews the draft) | IO: (PDF or its text) -> stdout
"""Pioneer's DDJ MIDI lists share one table: channel, NOTE/CC, MIDI-IN status, data 1, data 2,
MIDI-OUT status, data 1, data 2. A 14-bit control's MSB and LSB sit on lines beside its status.

  rows PDF          per message row: page, direction, channel column, status, data 1
  draft PDF MODEL   a model file whose controls and layers are guesses for a person to review
"""

import json
import re
import subprocess
import sys

STATUS = r"[89AB][0-9A-Fnmp]"
HEX = r"[0-9A-F]{2}"
ROW = re.compile(
    rf"(?P<ch>\d+(?:/\d+)*)\s+(?:NOTE\s+(?:\d+|-)\s+(?:(?:[A-G]#?-?\d+|-)\s+)?|CC\s+(?:\d+|-)\s+(?:-\s+)?)"
    rf"(?P<st>{STATUS}|-)(?:\s+(?P<d1>{HEX}|-)\s+(?:(?P<d2>hh|{HEX}|MSB|LSB|-)\s+)?"
    rf"(?P<ost>{STATUS}|-)(?:\s+(?P<od1>{HEX}|-)\s+(?P<od2>hh|{HEX}|-))?)?(?=\s|$)"
)
HALF = re.compile(rf"(?:^|\s)(?:\d+\s+)?(?P<d1>{HEX})\s+(?P<half>MSB|LSB)(?=\s|$)")
FIG = re.compile(r"^(?:[A-Z]\d+|\d+-\d+)$")
TRIGGERS = {"press", "long press", "rotate", "touch", "slide", "turn"}


def text_of(path):
    if path.endswith(".txt"):
        return open(path, encoding="utf-8").read()
    return subprocess.run(["pdftotext", "-layout", path, "-"], check=True, capture_output=True, text=True).stdout


def lines_of(text):
    for page, body in enumerate(text.split("\f"), 1):
        for n, line in enumerate(body.split("\n")):
            yield page, n, line


def rows(text):
    found, anchors, halves = [], [], []
    for page, n, line in lines_of(text):
        m = ROW.search(line)
        if m:
            g = {k: v or "-" for k, v in m.groupdict().items()}
            if g["st"] != "-" and g["d1"] != "-" and g["d2"] not in ("MSB", "LSB"):
                out = g["od1"] != "-"
                found.append((page, n, "inout" if out else "in", g["ch"], g["st"], g["d1"], g["d2"], line))
            elif g["st"] == "-" and g["od1"] != "-":
                found.append((page, n, "out", g["ch"], g["ost"], g["od1"], g["od2"], line))
            elif g["st"] != "-" and g["d2"] in ("MSB", "LSB"):
                anchors.append((page, n, "in", g["ch"], g["st"], line))
                halves.append((page, n, g["d1"], g["d2"], line))
                continue
            elif g["st"] != "-" or g["ost"] != "-":
                anchors.append((page, n, "in" if g["st"] != "-" else "out", g["ch"], g["st"] if g["st"] != "-" else g["ost"], line))
        for h in HALF.finditer(line[m.end():] if m else line):
            halves.append((page, n, h["d1"], h["half"], line))
    for page, n, d1, half, line in halves:
        near = [a for a in anchors if a[0] == page and abs(a[1] - n) <= 2]
        if not near:
            sys.exit(f"p.{page} line {n}: {d1} {half} has no status within two lines")
        _, _, way, ch, st, at = min(near, key=lambda a: (abs(a[1] - n), a[1] > n))
        found.append((page, n, f"{way}-{half.lower()}", ch, st, d1, None, line))
    found.sort(key=lambda r: (r[0], r[1]))
    unique, seen = [], set()
    for r in found:
        key = (r[0],) + r[2:6]
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique


def channels(column, status):
    if status[1] in "nmp":
        return [int(c) - 1 for c in column.split("/")]
    return [int(status[1], 16)]


HEADERS = ("Fig.", "UI name", "Name", "Function", "Deck", "Trigger", "+SHIFT", "Condition")
COLUMN = {"Name": "UI name", "Function": "UI name"}


def columns(text):
    """Label cells left of the message columns, filed by look or nearest header."""
    heads, found = {}, []
    for page, n, line in lines_of(text):
        m = ROW.search(line) or HALF.search(line)
        if "Fig." in line or "Function" in line:
            heads[page] = {}
        named = [h for h in HEADERS if h in line]
        if page in heads and len(named) > 1 and not m:
            for h in named:
                heads[page].setdefault(COLUMN.get(h, h), line.index(h) + len(h) / 2)
            continue
        left = line[: m.start()] if m else line
        for cell in re.finditer(r"\S+(?: \S+)*", left):
            found.append((page, n, cell.start(), cell.start() + len(cell.group()) / 2, cell.group()))
    filed = {}
    for page, n, start, x, text_ in found:
        head = heads.get(page) or heads.get(page - 1) or {}
        if not head or start < head.get("Fig.", 0) - 3 or text_.startswith("("):
            continue
        if FIG.match(text_):
            column = "Fig."
        elif text_ == "+SHIFT":
            column = "+SHIFT"
        elif re.match(r"(?i)deck \d$", text_):
            column = "Deck"
        elif text_.lower() in TRIGGERS:
            column = "Trigger"
        else:
            near = [h for h in head if h != "Fig." and (text_ == "-" or h in ("UI name", "Condition"))]
            column = min(near, key=lambda h: abs(head[h] - x))
        filed.setdefault((page, column), []).append((n, text_))
    return filed


def assign(labels, lines):
    """Splits the row lines into runs, one per label in order, each label nearest its run's middle."""
    labels, lines = sorted(labels), sorted(set(lines))
    best = {(0, 0): (0, [])}
    for j, (at, text_) in enumerate(labels, 1):
        for i in range(len(lines) + 1):
            options = []
            for k in range(i + 1):
                if (j - 1, k) in best:
                    cost = abs(at - (lines[k] + lines[i - 1]) / 2) if i > k else 2
                    options.append((best[(j - 1, k)][0] + cost, best[(j - 1, k)][1] + [text_] * (i - k)))
            best[(j, i)] = min(options, key=lambda o: o[0])
    names = best.get((len(labels), len(lines)), (0, []))[1]
    return dict(zip(lines, names))


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def draft(text, model):
    """Every row as a model-file entry; control and layer are guesses from the labels around it."""
    found = rows(text)
    filed = columns(text)
    label, row_lines = {}, {(r[0], r[1]) for r in found}
    for (page, column), labels in filed.items():
        if column in ("Fig.", "UI name", "Deck"):
            for n, text_ in assign(labels, [r[1] for r in found if r[0] == page]).items():
                label[(page, n, column)] = text_
            continue
        # A layer is the row's own: on its line, or on a line next to it that holds no other row.
        for n, text_ in labels:
            for near in (n, n - 1, n + 1):
                if (page, near) in row_lines and (near == n or (page, n) not in row_lines):
                    label.setdefault((page, near, column), text_)
    entries = []
    for page, n, way, column, status, d1, d2, line in found:
        at = lambda c: label.get((page, n, c), "")
        name, deck = at("UI name"), at("Deck")
        layer = [w for w in ["shift" if at("+SHIFT") == "+SHIFT" else "", slug(at("Trigger")) if "long" in at("Trigger").lower() else "",
                             "" if at("Condition") in ("", "-") else slug(at("Condition"))] if w]
        kind = "NOTE" if status[0] == "9" else "CC"
        for ch in channels(column, status):
            prefix = slug(deck).replace("-", "") or (f"deck{ch + 1}" if status[1] == "n" else "")
            entry = {"control": ".".join(filter(None, [prefix, slug(name)])), "layer": " ".join(layer)}
            if way.startswith("in"):
                entry["in"] = "button" if kind == "NOTE" else "absolute"
            if way.startswith("out") or way == "inout":
                entry["out"] = "led" if kind == "NOTE" else "value"
            entry["midi"] = f"{(0x90 if kind == 'NOTE' else 0xB0) | ch:02X} {d1}"
            entry["source"] = f"MML p.{page} {at('Fig.')} {name}".replace("  ", " ").strip()
            entry["half"] = way.split("-")[1] if "-" in way else None
            entries.append(entry)
    controls, by_status = [], {}
    for e in entries:
        half = e.pop("half")
        if half == "msb":
            by_status[(e["midi"][:2], int(e["midi"][3:], 16) + 0x20)] = e
        if half == "lsb":
            msb = by_status.get((e["midi"][:2], int(e["midi"][3:], 16)))
            if msb:
                msb["lsb"] = e["midi"]
                continue
        controls.append(e)
    return {"model": model, "usb": {"vendor": "", "product": "", "source": ""}, "hardware": "unverified", "sources": {"MML": ""}, "controls": controls}


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "rows":
        for page, _, way, column, status, d1, _, _ in rows(text_of(sys.argv[2])):
            print(page, way, column, status, d1)
    elif len(sys.argv) == 4 and sys.argv[1] == "draft":
        model = draft(text_of(sys.argv[2]), sys.argv[3])
        print("{")
        for key in ("model", "usb", "hardware", "sources"):
            print(f"  {json.dumps(key)}: {json.dumps(model[key], ensure_ascii=False)},")
        print('  "controls": [')
        rows_ = [json.dumps(c, ensure_ascii=False) for c in model["controls"]]
        print(",\n".join("    " + r for r in rows_))
        print("  ]\n}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
