// Concern: writes a model's surface as code: the core's typed Rust, its TypeScript and its wasm projection | Non-concern: the tree's rules (surface.rs) | IO: (Model) -> source
//! One source for each typed view of a model, so their names and shapes cannot drift apart.

use std::collections::BTreeMap;
use std::fmt::Write;

use crate::model::{Input, Model};
use crate::surface::{Kind, Node, Object, Step, Surface, surface};

/// `DDJ-FLX10` as `DdjFlx10`, `hot-cue` or `hotCue` as `HotCue`.
pub fn pascal(text: &str) -> String {
    let mut out = String::new();
    for word in text.split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| !w.is_empty()) {
        let upper = word.chars().filter(char::is_ascii_alphabetic).all(|c| c.is_ascii_uppercase());
        let word = if upper { word.to_ascii_lowercase() } else { word.to_owned() };
        let mut chars = word.chars();
        out.extend(chars.next().map(|c| c.to_ascii_uppercase()));
        out.push_str(chars.as_str());
    }
    out
}

/// `pascal`, kept a Rust identifier: `4-beat-jump` as `N4BeatJump`.
fn variant(text: &str) -> String {
    let name = pascal(text);
    if name.starts_with(|c: char| c.is_ascii_digit()) { format!("N{name}") } else { name }
}

/// The model's module name: `DDJ-FLX10` as `ddj_flx10`.
pub fn module(model: &Model) -> String {
    model.name.to_ascii_lowercase().replace(|c: char| !c.is_ascii_alphanumeric(), "_")
}

/// A camelCase name as a Rust field: `playPause` as `play_pause`, `4BeatExit` as `n4_beat_exit`.
fn snake(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_uppercase() {
            out.push('_');
        }
        out.push(c.to_ascii_lowercase());
    }
    if out.starts_with(|c: char| c.is_ascii_digit()) { format!("n{out}") } else { out }
}

fn singular(name: &str) -> &str {
    name.strip_suffix('s').unwrap_or(name)
}

/// An object's name as its type names it: `decks[0].pads[3]` as `DeckPad`.
fn template(place: &[Step]) -> String {
    let mut out = String::new();
    for (i, step) in place.iter().enumerate() {
        if let Step::Name(name) = step {
            let tuple = matches!(place.get(i + 1), Some(Step::Index(_)));
            out.push_str(&pascal(if tuple { singular(name) } else { name }));
        }
    }
    if out.starts_with(|c: char| c.is_ascii_digit()) { format!("N{out}") } else { out }
}

/// Rows as a match pattern, each run of consecutive rows a range.
fn pattern(rows: &[usize]) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut i = 0;
    while i < rows.len() {
        let mut j = i;
        while j + 1 < rows.len() && rows[j + 1] == rows[j] + 1 {
            j += 1;
        }
        parts.push(if j > i { format!("{}..={}", rows[i], rows[j]) } else { rows[i].to_string() });
        i = j + 1;
    }
    parts.join(" | ")
}

/// One type of the core's `controls` as the TypeScript interface its projection presents, with
/// the core type's parameters: `Id` for a control's identity `I`.
struct Interface {
    name: &'static str,
    params: &'static str,
    extends: &'static [&'static str],
    doc: &'static str,
    members: &'static [&'static str],
}

const INTERFACES: [Interface; 13] = [
    Interface {
        name: "Telling",
        params: "T",
        extends: &[],
        doc: "The core's `Telling`: what an output was last told, as its write takes it, on the unshifted bank showing now or the bank a view names; undefined until told there. What the device was told, not what it shows. `base` is what shows there once no lease holds it: the last telling but a lease's step, or a write made under a lease. `toldChanges` and `baseChanges` yield the latest: a slow reader gets the newest, never a backlog.",
        members: &[
            "readonly told: T | undefined;",
            "toldChanges(options?: Listen): Feed<T | undefined>;",
            "readonly base: T | undefined;",
            "baseChanges(options?: Listen): Feed<T | undefined>;",
        ],
    },
    Interface {
        name: "Play",
        params: "T",
        extends: &[],
        doc: "The core's `Play`: `play` runs a pattern on the output as a lease: on a control, on the unshifted bank showing, moving with each bank change as a write would land (the bank left shows what it would without the lease); on a view, on the bank it names for the lease's life; it resolves once the first step is told. The newest lease on a bank shows. A write under a lease resolves having set only the bank's base, shown once every lease on the bank has ended; ending the newest lease shows the next newest at its step now, else the base. `told` is what shows. The signal's abort ends the lease, as disposing it or the controller closing does.",
        members: &["play(pattern: Pattern<T>, options?: Listen): Promise<Lease>;"],
    },
    Interface {
        name: "Moded",
        params: "Mode, Page",
        extends: &[],
        doc: "An owner of pad modes: what it shows now. `modeChanges` yields the latest: a slow reader gets the newest, never a backlog.",
        members: &["readonly mode: Shown<Mode, Page>;", "modeChanges(options?: Listen): Feed<Shown<Mode, Page>>;"],
    },
    Interface {
        name: "Button",
        params: "Id",
        extends: &[],
        doc: "`presses` yields every press in order, each with its release: none skipped while at most 4096 wait unread.",
        members: &[
            "readonly pressed: boolean;",
            "presses(options?: Listen): Feed<Press<Id>>;",
            "nextPress(options?: Listen): Promise<Press<Id>>;",
        ],
    },
    Interface {
        name: "LedButton",
        params: "Id",
        extends: &["Button<Id>", "Telling<boolean>", "Play<boolean>"],
        doc: "`led` writes its unshifted layer, or the bank a view names: a held SHIFT never moves it, the `shifted` view names the SHIFT layer.",
        members: &["led(on: boolean): Promise<void>;"],
    },
    Interface {
        name: "Pad",
        params: "Id",
        extends: &[],
        doc: "`hits` yields every hit in order, each with its release: none skipped while at most 4096 wait unread.",
        members: &["hits(options?: Listen): Feed<Hit<Id>>;"],
    },
    Interface {
        name: "ColourPad",
        params: "Id",
        extends: &["Pad<Id>", "Telling<number>", "Play<number>"],
        doc: "`colour` writes the unshifted bank of the pad mode and page showing now, or the bank a view names: a whole 0 to 127, the model's palette; any other number is refused.",
        members: &["colour(colour: number): Promise<void>;"],
    },
    Interface {
        name: "Switch",
        params: "",
        extends: &[],
        doc: "One position of a selector, or a state the device reports: undefined until the device reports it. A control reads its own layer, its `shifted` view the SHIFT layer. `changes` yields every report in order: none skipped while at most 4096 wait unread.",
        members: &["readonly on: boolean | undefined;", "changes(options?: Listen): Feed<SwitchChange>;"],
    },
    Interface {
        name: "Absolute",
        params: "",
        extends: &[],
        doc: "A fader or knob, 0 to `max`: undefined until the device reports it. A control reads its own layer, its `shifted` view the SHIFT layer, so neither mixes in the other. `changes` yields the latest value: a slow reader gets the newest, never a backlog.",
        members: &[
            "readonly value: number | undefined;",
            "readonly max: number;",
            "changes(options?: Listen): Feed<number>;",
        ],
    },
    Interface {
        name: "Relative",
        params: "Id, R extends number | undefined = number | undefined",
        extends: &[],
        doc: "A jog or encoder: `position` is every tick its layers reported since connect, summed exactly: a control's own layers, never its SHIFT layer, which its `shifted` view sums. `positions` yields the latest position of each run of ticks on one layer: a tick on another layer than the one before it ends a run, so the ticks between two positions all came on the later's `latest.layer` and no read spans a layer change; within a run a slow reader gets the newest, never a backlog, and loses no motion, as each position holds every tick before it. `revolution` is the ticks of one revolution where the model file states one, so `position.ticks / revolution` is revolutions turned; undefined where it does not.",
        members: &[
            "readonly position: Position<Id>;",
            "readonly revolution: R;",
            "positions(options?: Listen): Feed<Position<Id>>;",
        ],
    },
    Interface {
        name: "LedOut",
        params: "",
        extends: &["Telling<boolean>", "Play<boolean>"],
        doc: "",
        members: &["set(on: boolean): Promise<void>;"],
    },
    Interface {
        name: "ColourOut",
        params: "",
        extends: &["Telling<number>", "Play<number>"],
        doc: "",
        members: &["set(colour: number): Promise<void>;"],
    },
    Interface {
        name: "ValueOut",
        params: "",
        extends: &["Telling<number>", "Play<number>"],
        doc: "Written as the unit shows it where the model file says how, else raw. `range` is the model file's, in those units; undefined where it lists only some values. `labels` is what each value of `range` stands for, from its low end, where the model file's source states it, as a jog screen's key: raw, `set(range[0] + labels.indexOf(label))`; undefined otherwise.",
        members: &[
            "readonly range: readonly [number, number] | undefined;",
            "readonly labels: readonly string[] | undefined;",
            "set(value: number): Promise<void>;",
        ],
    },
];

/// The control type a leaf of `kind` is, in the core and as its TypeScript interface.
fn interface(kind: Kind, writable: bool) -> &'static Interface {
    let name = match kind {
        Kind::Button if writable => "LedButton",
        Kind::Button => "Button",
        Kind::Pad if writable => "ColourPad",
        Kind::Pad => "Pad",
        Kind::Relative => "Relative",
        Kind::Switch => "Switch",
        Kind::Absolute => "Absolute",
        Kind::Led => "LedOut",
        Kind::Colour => "ColourOut",
        Kind::Value => "ValueOut",
    };
    INTERFACES.iter().find(|i| i.name == name).expect("every kind has an interface")
}

/// Every control type's TypeScript interface, as each model's TypeScript names them.
pub fn interfaces() -> String {
    let mut out = String::new();
    for Interface { name, params, extends, doc, members } in &INTERFACES {
        if !doc.is_empty() {
            writeln!(out, "/** {doc} */").unwrap();
        }
        let params = if params.is_empty() { String::new() } else { format!("<{params}>") };
        let extends = if extends.is_empty() { String::new() } else { format!(" extends {}", extends.join(", ")) };
        writeln!(out, "export interface {name}{params}{extends} {{").unwrap();
        members.iter().for_each(|m| writeln!(out, "  {m}").unwrap());
        writeln!(out, "}}\n").unwrap();
    }
    out
}

/// What each typed view needs of one model, read once from its surface.
struct Plan {
    s: &'static Surface,
    prefix: String,
    /// Each tuple's member count, by its singular name.
    lengths: BTreeMap<String, usize>,
}

impl Plan {
    fn new(model: &'static Model) -> Plan {
        let s = surface(model);
        let mut lengths: BTreeMap<String, usize> = BTreeMap::new();
        let mut count = |name: &str, i: usize| {
            let len = lengths.entry(name.to_owned()).or_default();
            *len = (*len).max(i + 1);
        };
        for o in &s.objects {
            for (name, i) in &o.fields.indices {
                count(name, *i);
            }
            for &r in &o.rows {
                for (name, i) in &s.layers[r].indices {
                    count(name, *i);
                }
                if let Some(p) = s.layers[r].page {
                    count("page", p);
                }
            }
        }
        Plan { s, prefix: pascal(&model.name), lengths }
    }

    /// The objects of each template, in the file's order; one template's objects share their fields.
    fn templates(&self) -> Vec<(String, Vec<&'static Object>)> {
        let mut out: Vec<(String, Vec<&'static Object>)> = Vec::new();
        for o in &self.s.objects {
            let t = template(&o.place);
            match out.iter_mut().find(|(name, _)| *name == t) {
                Some((_, objects)) => {
                    let first = objects[0];
                    let same = |a: &Object| {
                        let indices: Vec<String> = a.fields.indices.iter().map(|(n, _)| n.clone()).collect();
                        let f = &a.fields;
                        (a.kind, indices, f.layer_indices.clone(), f.mode, f.page, f.shift, f.rest.clone())
                    };
                    assert!(same(first) == same(o), "{t}: its controls' fields differ");
                    objects.push(o);
                }
                None => out.push((t, vec![o])),
            }
        }
        out
    }

    fn index_type(name: &str) -> String {
        format!("{}Index", pascal(name))
    }

    /// The identity type of an object with an input, by its template.
    fn id(o: &Object) -> String {
        format!("{}Id", template(&o.place))
    }

    fn layer_type(o: &Object) -> String {
        format!("{}Layer", template(&o.place))
    }

    fn has_id(o: &Object) -> bool {
        matches!(o.kind, Kind::Button | Kind::Pad | Kind::Relative)
    }

    /// An object's identity fields as (name, Rust type, TypeScript type).
    fn fields(&self, o: &Object) -> Vec<(String, String, String)> {
        let p = &self.prefix;
        let index = |name: &str| (name.to_owned(), Plan::index_type(name), format!("{p}{}", Plan::index_type(name)));
        let mut fields: Vec<_> = o.fields.indices.iter().map(|(n, _)| index(n)).collect();
        fields.extend(o.fields.layer_indices.iter().map(|n| index(n)));
        if o.fields.mode {
            fields.push(("mode".into(), "Mode".into(), format!("{p}Mode")));
        }
        if o.fields.page {
            fields.push(index("page"));
        }
        if o.fields.shift {
            fields.push(("shift".into(), "bool".into(), "boolean".into()));
        }
        if !o.fields.rest.is_empty() {
            let words: Vec<String> = o.fields.rest.iter().map(|w| format!("{w:?}")).collect();
            fields.push(("layer".into(), Plan::layer_type(o), words.join(" | ")));
        }
        fields
    }

    /// A leaf's control type, generic as the core declares it, `id` naming its identity type.
    fn leaf(&self, object: usize, rows: &[usize], bank: bool, id: impl Fn(String) -> String) -> String {
        let o = &self.s.objects[object];
        let interface = interface(o.kind, self.s.writable(rows, bank));
        if interface.params.is_empty() {
            interface.name.to_owned()
        } else {
            format!("{}<{}>", interface.name, id(Plan::id(o)))
        }
    }
}

/// The tree's group types, named by where they sit and shared where their shapes match.
struct Groups {
    named: Vec<(String, String)>,
}

impl Groups {
    fn name(&mut self, base: &str, body: &str) -> String {
        if let Some((name, _)) = self.named.iter().find(|(_, b)| b == body) {
            return name.clone();
        }
        let mut name = base.to_owned();
        let mut n = 2;
        while self.named.iter().any(|(m, _)| *m == name) {
            name = format!("{base}{n}");
            n += 1;
        }
        self.named.push((name.clone(), body.to_owned()));
        name
    }
}

/// A group's type name from its path, a tuple's name marked `[]`: tuples singular, `modes.<mode>` as `Mode`.
fn group_base(path: &[String], modes: &[String]) -> String {
    let mut out = String::new();
    for (i, step) in path.iter().enumerate() {
        if step == "modes" && i + 1 < path.len() {
            continue;
        }
        if i > 0 && path[i - 1] == "modes" && modes.contains(step) {
            out.push_str("Mode");
        } else if let Some(tuple) = step.strip_suffix("[]") {
            out.push_str(&pascal(singular(tuple)));
        } else {
            out.push_str(&pascal(step));
        }
    }
    out
}

/// A group entry's step in a naming path: a tuple's name marked `[]`.
fn step(name: &str, entry: &Node) -> String {
    if matches!(entry, Node::Tuple(_)) { format!("{name}[]") } else { name.to_owned() }
}

/// One group of the core's tree: its struct fields and the expression that builds it.
struct Built {
    ty: String,
    build: String,
}

/// One group type of the tree: its fields' names and types, and the owner it is, if any.
struct Struct {
    name: String,
    fields: Vec<(String, String)>,
    owner: Option<usize>,
}

struct Rust<'a> {
    plan: &'a Plan,
    groups: Groups,
    structs: Vec<Struct>,
}

impl Rust<'_> {
    fn node(&mut self, node: &Node, path: &mut Vec<String>) -> Built {
        match node {
            Node::Leaf { object, rows, bank } => {
                let ty = self.plan.leaf(*object, rows, *bank, |id| id);
                let rows: Vec<String> = rows.iter().map(usize::to_string).collect();
                let build = format!("{ty}::from(Leaf::new(session, {object}, &[{}], {bank}))", rows.join(", "));
                let build = build.replacen(&format!("{ty}::"), &format!("<{ty}>::"), 1);
                Built { ty, build }
            }
            Node::Tuple(items) => {
                let built: Vec<Built> = items.iter().map(|n| self.node(n, path)).collect();
                let builds: Vec<&str> = built.iter().map(|b| b.build.as_str()).collect();
                // Members of one shape make an array; any that differ, a tuple of each member's type.
                if built.iter().all(|b| b.ty == built[0].ty) {
                    Built {
                        ty: format!("[{}; {}]", built[0].ty, built.len()),
                        build: format!("[{}]", builds.join(", ")),
                    }
                } else {
                    let types: Vec<&str> = built.iter().map(|b| b.ty.as_str()).collect();
                    Built { ty: format!("({})", types.join(", ")), build: format!("({})", builds.join(", ")) }
                }
            }
            Node::Group { entries, owner } => {
                let mut fields = Vec::new();
                let mut builds = Vec::new();
                for (name, entry) in entries {
                    path.push(step(name, entry));
                    let built = self.node(entry, path);
                    path.pop();
                    fields.push((name.clone(), built.ty));
                    builds.push(format!("{}: {}", snake(name), built.build));
                }
                if let Some(o) = owner {
                    builds.push(format!("owner: Owner::new(session, {o})"));
                }
                let body: String = fields.iter().map(|(n, t)| format!("{n}:{t};")).collect::<String>()
                    + if owner.is_some() { "owner" } else { "" };
                let base =
                    if path.is_empty() { self.plan.prefix.clone() } else { group_base(path, &self.plan.s.modes) };
                let name = self.groups.name(&base, &body);
                if !self.structs.iter().any(|s| s.name == name) {
                    self.structs.push(Struct { name: name.clone(), fields, owner: *owner });
                }
                Built { ty: name.clone(), build: format!("{name} {{ {} }}", builds.join(", ")) }
            }
        }
    }
}

/// The core's typed module for `model`: index types, `Mode`, each control's identity and layer, the
/// tree with its constructor, and `Input`, every input as a typed value.
pub fn rust(model: &'static Model) -> String {
    let plan = Plan::new(model);
    let s = plan.s;
    let mut out = String::new();
    let w = &mut out;
    writeln!(w, "use crate::controls::*;\nuse crate::decode::Value;\nuse crate::session::{{Feed, Session}};\nuse serde::Serialize;\n").unwrap();
    writeln!(w, "pub const MODEL: &str = {:?};\n", model.name).unwrap();
    for (name, len) in &plan.lengths {
        let ty = Plan::index_type(name);
        writeln!(w, "/// A 0-based {name}, below {len}.\n#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]\n#[serde(transparent)]\npub struct {ty}(u8);\n").unwrap();
        writeln!(w, "impl {ty} {{\n    pub const COUNT: usize = {len};\n    pub fn new(index: usize) -> Option<{ty}> {{\n        (index < {len}).then_some({ty}(index as u8))\n    }}\n    pub fn get(self) -> usize {{\n        self.0.into()\n    }}\n}}\n").unwrap();
        writeln!(w, "impl Indexed for {ty} {{\n    fn at(index: usize) -> {ty} {{\n        {ty}::new(index).expect(\"an index the surface names\")\n    }}\n}}\n").unwrap();
    }
    let variants: Vec<String> = s.modes.iter().map(|m| pascal(m)).collect();
    writeln!(w, "/// A pad mode, as the pads' layers name it.\n#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]\npub enum Mode {{").unwrap();
    for (m, v) in s.modes.iter().zip(&variants) {
        writeln!(w, "    #[serde(rename = {m:?})]\n    {v},").unwrap();
    }
    writeln!(
        w,
        "}}\n\nimpl Indexed for Mode {{\n    fn at(index: usize) -> Mode {{\n        [{}][index]\n    }}\n}}\n",
        variants.iter().map(|v| format!("Mode::{v}")).collect::<Vec<_>>().join(", ")
    )
    .unwrap();
    writeln!(w, "pub type ShownMode = Shown<Mode, {}>;\n", Plan::index_type("page")).unwrap();

    for (t, objects) in plan.templates().into_iter().filter(|(_, objects)| Plan::has_id(objects[0])) {
        let o = objects[0];
        if !o.fields.rest.is_empty() {
            writeln!(
                w,
                "#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]\npub enum {} {{",
                Plan::layer_type(o)
            )
            .unwrap();
            for word in &o.fields.rest {
                let v = if word.is_empty() { "Plain".to_owned() } else { variant(word) };
                writeln!(w, "    #[serde(rename = {word:?})]\n    {v},").unwrap();
            }
            writeln!(w, "}}\n").unwrap();
        }
        let fields = plan.fields(o);
        let id = Plan::id(o);
        writeln!(w, "#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]\npub struct {id} {{").unwrap();
        for (name, ty, _) in &fields {
            writeln!(w, "    pub {}: {ty},", snake(name)).unwrap();
        }
        writeln!(w, "}}\n\nimpl Identity for {id} {{\n    fn of(row: usize) -> {id} {{\n        match row {{").unwrap();
        for o in &objects {
            for &r in &o.rows {
                let layer = &s.layers[r];
                let mut values = Vec::new();
                for (name, ty, _) in &fields {
                    let value = match name.as_str() {
                        "mode" => format!("Mode::{}", variants[layer.mode.expect("a moded row")]),
                        "page" => format!("{ty}({})", layer.page.expect("a paged row")),
                        "shift" => layer.shift.to_string(),
                        "layer" => {
                            let v = if layer.rest.is_empty() { "Plain".to_owned() } else { variant(&layer.rest) };
                            format!("{ty}::{v}")
                        }
                        index => {
                            let i = o.fields.indices.iter().chain(&layer.indices).find(|(n, _)| n == index);
                            format!("{ty}({})", i.expect("an index the object names").1)
                        }
                    };
                    values.push(format!("{}: {value}", snake(name)));
                }
                writeln!(w, "            {r} => {id} {{ {} }},", values.join(", ")).unwrap();
            }
        }
        writeln!(w, "            _ => unreachable!(\"row {{row}} is not a {t}\"),\n        }}\n    }}\n}}\n").unwrap();
    }

    let mut rust = Rust { plan: &plan, groups: Groups { named: Vec::new() }, structs: Vec::new() };
    let root = rust.node(&s.root, &mut Vec::new());
    for Struct { name, fields, owner } in &rust.structs {
        writeln!(w, "#[derive(Clone)]\npub struct {name} {{").unwrap();
        for (field, ty) in fields {
            writeln!(w, "    pub {}: {ty},", snake(field)).unwrap();
        }
        if owner.is_some() {
            writeln!(w, "    owner: Owner,").unwrap();
        }
        writeln!(w, "}}\n").unwrap();
        if owner.is_some() {
            writeln!(w, "impl {name} {{\n    /// What it shows now: pad mode and page where the device has told them, and shift.\n    pub fn mode(&self) -> ShownMode {{\n        self.owner.shown()\n    }}\n    pub fn mode_changes(&self) -> Feed<ShownMode> {{\n        self.owner.changes()\n    }}\n}}\n").unwrap();
        }
    }
    let name = &root.ty;
    writeln!(w, "impl {name} {{\n    /// The tree over `session`, which must be this model's.\n    pub fn new(session: &Session) -> {name} {{\n        assert_eq!(session.model().name, MODEL, \"a {name} over another model's session\");\n        {}\n    }}\n}}\n", root.build).unwrap();

    writeln!(w, "/// Every input the device sends, as a typed value.\n#[derive(Debug, Clone, Copy, PartialEq, Serialize)]\n#[serde(tag = \"control\", rename_all = \"camelCase\")]\npub enum Input {{").unwrap();
    let mut arms = String::new();
    for (t, objects) in plan.templates() {
        let o = objects[0];
        let Some(input) = s.model.controls()[o.rows[0]].input else { continue };
        let (field, ty, value) = match input {
            Input::Button => ("pressed", "bool", "value == Value::Button(true)"),
            Input::Switch => ("on", "bool", "value == Value::Switch(true)"),
            Input::Pad => ("velocity", "u8", "value.velocity()"),
            Input::Relative => ("ticks", "i8", "value.ticks()"),
            Input::Absolute => ("level", "Level", "Level::of(value)"),
        };
        let index_fields: Vec<String> =
            o.fields.indices.iter().map(|(n, _)| format!("{}: {}, ", snake(n), Plan::index_type(n))).collect();
        if Plan::has_id(o) {
            writeln!(w, "    {t} {{ #[serde(flatten)] id: {}, {field}: {ty} }},", Plan::id(o)).unwrap();
        } else {
            writeln!(w, "    {t} {{ {}{field}: {ty} }},", index_fields.concat()).unwrap();
        }
        for o in &objects {
            let build = if Plan::has_id(o) {
                format!("Input::{t} {{ id: {}::of(row), {field}: {value} }}", Plan::id(o))
            } else {
                let indices: Vec<String> = o
                    .fields
                    .indices
                    .iter()
                    .map(|(n, i)| format!("{}: {}({i}), ", snake(n), Plan::index_type(n)))
                    .collect();
                format!("Input::{t} {{ {}{field}: {value} }}", indices.concat())
            };
            writeln!(arms, "            {} => {build},", pattern(&o.rows)).unwrap();
        }
    }
    writeln!(w, "}}\n\nimpl Input {{\n    /// The input `value` on `row` of the model's controls is.\n    pub fn of(row: usize, value: Value) -> Input {{\n        match row {{\n{arms}            _ => unreachable!(\"row {{row}} sends nothing\"),\n        }}\n    }}\n}}").unwrap();
    out
}

/// The TypeScript the wasm projection of `rust(model)` presents, each type named after its Rust item.
pub fn typescript(model: &'static Model) -> String {
    let plan = Plan::new(model);
    let (s, p) = (plan.s, &plan.prefix);
    let mut out = String::new();
    let w = &mut out;
    for (name, len) in &plan.lengths {
        let values: Vec<String> = (0..*len).map(|i| i.to_string()).collect();
        writeln!(w, "export type {p}{} = {};", Plan::index_type(name), values.join(" | ")).unwrap();
    }
    let modes: Vec<String> = s.modes.iter().map(|m| format!("{m:?}")).collect();
    writeln!(w, "export type {p}Mode = {};", if modes.is_empty() { "never".into() } else { modes.join(" | ") })
        .unwrap();
    for (_, objects) in plan.templates().into_iter().filter(|(_, objects)| Plan::has_id(objects[0])) {
        let o = objects[0];
        let fields: Vec<String> = plan.fields(o).iter().map(|(n, _, ts)| format!("readonly {n}: {ts}")).collect();
        writeln!(w, "export type {p}{} = {{ {} }};", Plan::id(o), fields.join("; ")).unwrap();
    }
    let mut groups = Groups { named: Vec::new() };
    let mut named = Vec::new();
    let root = ts_node(&plan, &s.root, &mut Vec::new(), &mut groups, &mut named);
    for TsGroup { name, body } in &named {
        writeln!(w, "export type {p}{name} = {};", body.text()).unwrap();
    }
    writeln!(
        w,
        "/** The {}, connected: its controls by physical identity. */\nexport type {p} = Controller<{:?}> & {root};",
        model.name, model.name
    )
    .unwrap();
    out
}

/// A TypeScript group type's members, each with the doc its model rows give it, and what follows
/// the braces. Its identity is `key`, the members without docs: a doc is a note on rows, so it
/// never makes two groups of one shape two types.
struct TsBody {
    members: Vec<(Option<String>, String)>,
    tail: String,
}

impl TsBody {
    fn key(&self) -> String {
        let members: String = self.members.iter().map(|(_, m)| m.as_str()).collect();
        format!("{{\n{members}}}{}", self.tail)
    }

    fn text(&self) -> String {
        let docs =
            self.members.iter().map(|(doc, m)| doc.as_ref().map_or(String::new(), |d| format!("  /** {d} */\n")) + m);
        format!("{{\n{}}}{}", docs.collect::<String>(), self.tail)
    }

    /// Keeps only the docs `other`, a group of the same type, also gives: what the shared type
    /// states holds for every group it names.
    fn keep_shared_docs(&mut self, other: &TsBody) {
        for ((doc, _), (theirs, _)) in self.members.iter_mut().zip(&other.members) {
            if doc != theirs {
                *doc = None;
            }
        }
    }
}

struct TsGroup {
    name: String,
    body: TsBody,
}

fn ts_node(plan: &Plan, node: &Node, path: &mut Vec<String>, groups: &mut Groups, named: &mut Vec<TsGroup>) -> String {
    let p = &plan.prefix;
    match node {
        Node::Leaf { object, rows, bank } => {
            let o = &plan.s.objects[*object];
            if o.kind != Kind::Relative {
                return plan.leaf(*object, rows, *bank, |id| format!("{p}{id}"));
            }
            let revolution = plan.s.model.revolution(rows).map_or("undefined".to_owned(), |r| r.ticks.to_string());
            format!("Relative<{p}{}, {revolution}>", Plan::id(o))
        }
        Node::Tuple(items) => {
            let types: Vec<String> = items.iter().map(|n| ts_node(plan, n, path, groups, named)).collect();
            format!("readonly [{}]", types.join(", "))
        }
        Node::Group { entries, owner } => {
            let mut members = Vec::new();
            for (name, entry) in entries {
                path.push(step(name, entry));
                let ty = ts_node(plan, entry, path, groups, named);
                path.pop();
                members.push((relative_doc(plan, entry), format!("  readonly {}: {ty};\n", quoted(name))));
            }
            let tail = match owner {
                Some(_) => format!(" & Moded<{p}Mode, {p}{}>", Plan::index_type("page")),
                None => String::new(),
            };
            let body = TsBody { members, tail };
            if path.is_empty() {
                return body.text();
            }
            let name = groups.name(&group_base(path, &plan.s.modes), &body.key());
            match named.iter_mut().find(|g| g.name == name) {
                Some(group) => group.body.keep_shared_docs(&body),
                None => named.push(TsGroup { name: name.clone(), body }),
            }
            format!("{p}{name}")
        }
    }
}

/// The wasm projection of `rust(model)`: each tree type as the plain JS object a page gets, its
/// controls the typed handles' JS classes, and the controller `connect` resolves to: the root's
/// members with the lifecycle's.
pub fn wasm(model: &'static Model) -> String {
    let plan = Plan::new(model);
    let mut rust = Rust { plan: &plan, groups: Groups { named: Vec::new() }, structs: Vec::new() };
    rust.node(&plan.s.root, &mut Vec::new());
    let m = module(model);
    let mut out = String::new();
    let w = &mut out;
    let members = |fields: &[(String, String)], at: &str| {
        let entries: Vec<String> = fields.iter().map(|(f, _)| format!("({f:?}, {at}.{}.as_js())", snake(f))).collect();
        format!("vec![{}]", entries.join(", "))
    };
    let moded = |owner: &Option<usize>, at: &str, name: &str| match owner {
        Some(_) => format!(
            "Some(Moded::of({at}.clone(), |g: &djc::models::{m}::{name}| g.mode(), |g: &djc::models::{m}::{name}| g.mode_changes()))"
        ),
        None => "None".to_owned(),
    };
    let (root, groups) = rust.structs.split_last().expect("the root is built last");
    for Struct { name, fields, owner } in groups {
        writeln!(w, "impl AsJs for djc::models::{m}::{name} {{\n    fn as_js(&self) -> JsValue {{\n        group({}, {})\n    }}\n}}\n", members(fields, "self"), moded(owner, "self", name)).unwrap();
    }
    let Struct { name, fields, owner } = root;
    writeln!(w, "/// The {} as the object `connect` resolves to: its tree, then `lifecycle`.\npub fn {m}(session: &djc::session::Session, lifecycle: Vec<(&'static str, JsValue)>) -> JsValue {{\n    let root = djc::models::{m}::{name}::new(session);\n    let mut members: Vec<(&str, JsValue)> = {};\n    members.extend(lifecycle);\n    group(members, {})\n}}\n", model.name, members(fields, "root"), moded(owner, "root", name)).unwrap();
    out
}

/// What the model file states of a relative leaf's motion, as its member's doc: its revolution and least step.
fn relative_doc(plan: &Plan, entry: &Node) -> Option<String> {
    let Node::Leaf { object, rows, .. } = entry else { return None };
    if plan.s.objects[*object].kind != Kind::Relative {
        return None;
    }
    let model = plan.s.model;
    let mut doc = Vec::new();
    if let Some(r) = model.revolution(rows) {
        let [least, most] = r.laps;
        let measured = rows.iter().map(|&row| &model.controls()[row]).filter(|c| c.revolution.is_some());
        let layers: Vec<&str> = measured.map(|c| if c.layer.is_empty() { "plain" } else { c.layer.as_str() }).collect();
        let layers = layers.join(", ");
        doc.push(format!(
            "{} ticks a revolution, measured on its {layers} layer: laps summed {least} to {most}.",
            r.ticks
        ));
    }
    if let Some(step) = model.least_step(rows) {
        doc.push(format!(
            "Reports nothing below a speed threshold, then at least {step} ticks a report: slow motion is not seen."
        ));
    }
    (!doc.is_empty()).then(|| doc.join(" "))
}

fn quoted(name: &str) -> String {
    let ident = name.starts_with(|c: char| c.is_ascii_alphabetic()) && name.chars().all(|c| c.is_ascii_alphanumeric());
    if ident { name.to_owned() } else { format!("{name:?}") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decks_whose_rows_differ_in_a_note_share_one_type() {
        let flx10 = Model::named("DDJ-FLX10").unwrap();
        let notes: Vec<_> =
            (1..=4).map(|d| flx10.control(&format!("deck{d}.jog.side"), "").unwrap().least_step).collect();
        assert!(notes.iter().any(|n| *n != notes[0]), "this test needs decks whose rows differ in a note");
        let ts = typescript(flx10);
        let decks = ts.split("readonly decks: readonly [").nth(1).and_then(|t| t.split(']').next()).unwrap();
        let types: Vec<&str> = decks.split(", ").collect();
        assert_eq!(types.len(), 4);
        assert!(types.iter().all(|t| *t == types[0]), "{decks}");
    }
}
