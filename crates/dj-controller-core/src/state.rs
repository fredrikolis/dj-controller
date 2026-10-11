// Concern: what a controller last reported: each row's value, each owner's pad mode, page and shift, the row a write lands on | Non-concern: decoding, what it was told (ledger) | IO: (Event) -> state
//! Pad mode and page live on the controller (docs/research/flx10-midi.md); the rules are
//! docs/research/model-surface.md.

use std::fmt;

use crate::decode::{Event, Value};
use crate::surface::{Kind, Owner, Surface};

/// What an owner shows: its pad mode (into [`Surface::modes`]) and page, each where known, and
/// whether its shift is held.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Shown {
    pub mode: Option<usize>,
    pub page: Option<usize>,
    pub shift: bool,
}

/// Why no row of a control can be written now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unshown {
    /// Its owner's pad mode, or page, is not known yet.
    Unknown { control: String, what: &'static str },
    /// No layer of it takes an output a write can name.
    NoOutput { control: String },
}

impl fmt::Display for Unshown {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Unshown::Unknown { control, what } => {
                write!(f, "{control}: the {what} showing is not known yet; a pad press tells it")
            }
            Unshown::NoOutput { control } => write!(f, "{control} takes no output a write can name"),
        }
    }
}

impl std::error::Error for Unshown {}

/// Every tick some rows reported, summed exactly, and the latest's row and time.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Turned {
    pub ticks: i64,
    pub latest: Option<(usize, f64)>,
}

pub struct State {
    surface: &'static Surface,
    seq: u64,
    rows: Vec<Option<(u64, Value)>>,
    turned: Vec<(i64, f64)>,
    owners: Vec<Shown>,
}

impl State {
    pub fn new(surface: &'static Surface) -> State {
        let start = |owner: &Owner| match &surface.start {
            Some(l) if owner.modes.iter().any(|&m| l.mode == Some(m)) => {
                Shown { mode: l.mode, page: l.page, shift: false }
            }
            _ => Shown::default(),
        };
        State {
            surface,
            seq: 0,
            rows: vec![None; surface.layers.len()],
            turned: vec![(0, 0.0); surface.layers.len()],
            owners: surface.owners.iter().map(start).collect(),
        }
    }

    /// Records `event`, received at `time`, and returns the owner whose [`Shown`] it changed. A
    /// lone 14-bit half keeps the other half last reported.
    pub fn feed(&mut self, event: &Event, time: f64) -> Option<usize> {
        let Event::Control { control, value, .. } = event else { return None };
        let model = self.surface.model;
        let row = model.row(control);
        let before = self.rows[row].map(|(_, v)| v);
        let whole = |v: Option<Value>| match v {
            Some(Value::Absolute(v)) => v,
            _ => 0,
        };
        let value = match *value {
            Value::Msb(msb) => Value::Absolute(u16::from(msb) << 7 | whole(before) & 0x7F),
            Value::Lsb(lsb) => Value::Absolute(whole(before) & !0x7F | u16::from(lsb)),
            value => value,
        };
        self.seq += 1;
        self.rows[row] = Some((self.seq, value));
        if let Value::Relative(ticks) = value {
            let (sum, at) = &mut self.turned[row];
            *sum += i64::from(ticks);
            *at = time;
        }

        let object = self.surface.row_object[row];
        let owner_id = self.surface.objects[object].owner;
        let owner = &self.surface.owners[owner_id];
        let layer = &self.surface.layers[row];
        let mut shown = self.owners[owner_id];
        let pressed = matches!(value, Value::Button(true)) || matches!(value, Value::Pad(v) if v > 0);
        if owner.shift == Some(object) {
            shown.shift = value == Value::Button(true);
        } else if pressed && let Some(bank) = &self.surface.selects[row] {
            if shown.mode != bank.mode || bank.page.is_some() {
                shown.page = bank.page;
            }
            shown.mode = bank.mode;
        } else if pressed && let Some(mode) = layer.mode {
            shown.page = layer.page;
            shown.mode = Some(mode);
        } else if pressed && self.surface.objects[object].rows.iter().any(|&r| self.surface.selects[r].is_some()) {
            (shown.mode, shown.page) = (None, None);
        }
        let changed = shown != self.owners[owner_id];
        self.owners[owner_id] = shown;
        changed.then_some(owner_id)
    }

    /// The value last reported by any of `rows`.
    pub fn latest(&self, rows: &[usize]) -> Option<Value> {
        rows.iter().filter_map(|&r| self.rows[r]).max_by_key(|(seq, _)| *seq).map(|(_, v)| v)
    }

    pub fn turned(&self, rows: &[usize]) -> Turned {
        let ticks = rows.iter().map(|&r| self.turned[r].0).sum();
        let reported = rows.iter().filter_map(|&r| self.rows[r].map(|(seq, _)| (seq, r)));
        let latest = reported.max().map(|(_, r)| (r, self.turned[r].1));
        Turned { ticks, latest }
    }

    /// What `owner` shows. One without a shift button of its own counts any held shift.
    pub fn shown(&self, owner: usize) -> Shown {
        let mut shown = self.owners[owner];
        if self.surface.owners[owner].shift.is_none() {
            shown.shift = self.surface.owners.iter().zip(&self.owners).any(|(o, s)| o.shift.is_some() && s.shift);
        }
        shown
    }

    /// The row of `object` a write lands on: its layer for the pad mode and page its owner shows
    /// now, unshifted whatever shift the device reports, as only a shifted view names a shift
    /// layer; a shift layer only where the object has no other.
    pub fn showing(&self, object: usize) -> Result<usize, Unshown> {
        let o = &self.surface.objects[object];
        let control = self.surface.model.controls()[o.rows[0]].control.clone();
        let layers = &self.surface.layers;
        let model = self.surface.model;
        let rows: Vec<usize> =
            o.rows.iter().copied().filter(|&r| model.controls()[r].output.is_some() && layers[r].is_bank()).collect();
        if rows.is_empty() || matches!(o.kind, Kind::Switch | Kind::Absolute | Kind::Relative) {
            return Err(Unshown::NoOutput { control });
        }
        let shown = self.shown(o.owner);
        let shift = rows.iter().all(|&r| layers[r].shift);
        let unknown = |what| Unshown::Unknown { control: control.clone(), what };
        for &r in rows.iter().filter(|&&r| layers[r].shift == shift) {
            let l = &layers[r];
            if l.mode.is_some() && shown.mode.is_none() {
                return Err(unknown("pad mode"));
            }
            if l.page.is_some() && shown.mode == l.mode && shown.page.is_none() {
                return Err(unknown("page"));
            }
            if l.mode.is_none_or(|m| shown.mode == Some(m)) && l.page.is_none_or(|p| shown.page == Some(p)) {
                return Ok(r);
            }
        }
        Err(unknown("pad mode"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decode::Decoder;
    use crate::midi::Message;
    use crate::model::Model;
    use crate::surface::surface;

    fn flx10() -> &'static Surface {
        surface(Model::named("DDJ-FLX10").unwrap())
    }

    fn note(channel: u8, note: u8, velocity: u8) -> Message {
        Message::NoteOn { channel, note, velocity }
    }

    fn fed(state: &mut State, messages: &[Message]) -> Vec<Option<usize>> {
        let mut decoder = Decoder::new(flx10().model);
        messages.iter().flat_map(|m| decoder.feed(m)).map(|e| state.feed(&e, 0.0)).collect()
    }

    fn object(path: &str) -> usize {
        let model = flx10().model;
        flx10().row_object[model
            .row(model.control(path, "").or_else(|| model.controls().iter().find(|c| c.control == path)).unwrap())]
    }

    fn written(state: &State, path: &str) -> Result<String, Unshown> {
        state.showing(object(path)).map(|r| flx10().model.controls()[r].name())
    }

    #[test]
    fn a_pad_press_tells_its_decks_mode_and_page_and_a_write_follows_it() {
        let mut state = State::new(flx10());
        assert_eq!(written(&state, "deck1.pad1").unwrap(), "deck1.pad1 (hot-cue page-1)", "the model's start-bank");
        // Deck 1 pad 1 on SAMPLER page 1, ch8 (MML p.4): note 0x30.
        let changed = fed(&mut state, &[note(7, 0x30, 0x7F), note(7, 0x30, 0x00)]);
        assert_eq!(changed[0], Some(flx10().objects[object("deck1.pad1")].owner));
        assert_eq!(changed[1], None);
        assert_eq!(written(&state, "deck1.pad1").unwrap(), "deck1.pad1 (sampler page-1)");
        assert_eq!(written(&state, "deck1.page.left").unwrap(), "deck1.page.left (sampler)");
    }

    #[test]
    fn a_held_shift_never_moves_a_write_off_the_unshifted_layer() {
        let mut state = State::new(flx10());
        // Deck 1 SHIFT held, 90 3F (MML p.2 D25); deck 1 pad 1 on SAMPLER page 1, 97 30 (MML p.4).
        fed(&mut state, &[note(0, 0x3F, 0x7F), note(7, 0x30, 0x7F)]);
        assert!(state.shown(flx10().objects[object("deck1.pad1")].owner).shift);
        assert_eq!(written(&state, "deck1.pad1").unwrap(), "deck1.pad1 (sampler page-1)");
        assert_eq!(written(&state, "deck1.play-pause").unwrap(), "deck1.play-pause");
        assert_eq!(written(&state, "deck1.loop-in").unwrap(), "deck1.loop-in");
        assert_eq!(written(&state, "mixer.channel1.cue").unwrap(), "mixer.channel1.cue");
    }

    fn unknown(state: &State, what: &str) -> bool {
        matches!(written(state, "deck1.pad1"), Err(Unshown::Unknown { what: w, .. }) if w == what)
    }

    #[test]
    fn a_page_press_shows_its_page_in_the_mode_it_names() {
        let mut state = State::new(flx10());
        // PAGE ▶ then ◀ in HOT CUE, 90 2C and 90 24 (MML p.6 P14, P13; p.7 *1).
        fed(&mut state, &[note(0, 0x2C, 0x7F), note(0, 0x2C, 0x00)]);
        assert_eq!(written(&state, "deck1.pad1").unwrap(), "deck1.pad1 (hot-cue page-2)");
        fed(&mut state, &[note(0, 0x24, 0x7F)]);
        assert_eq!(written(&state, "deck1.pad1").unwrap(), "deck1.pad1 (hot-cue page-1)");
        fed(&mut state, &[note(0, 0x32, 0x7F)]);
        assert_eq!(written(&state, "deck1.pad1").unwrap(), "deck1.pad1 (beat-loop page-2)");
    }

    #[test]
    fn a_mode_button_shows_its_mode_keeping_the_page_only_where_the_mode_stays() {
        let mut state = State::new(flx10());
        // PAGE ▶ in HOT CUE (90 2C), then HOT CUE (90 1B, MML p.6 P9).
        fed(&mut state, &[note(0, 0x2C, 0x7F), note(0, 0x1B, 0x7F)]);
        assert_eq!(written(&state, "deck1.pad1").unwrap(), "deck1.pad1 (hot-cue page-2)");
        // SAMPLER (90 22, MML p.6 P12), then PAGE ◀ in it (90 27).
        fed(&mut state, &[note(0, 0x22, 0x7F)]);
        assert!(unknown(&state, "page"));
        fed(&mut state, &[note(0, 0x27, 0x7F)]);
        assert_eq!(written(&state, "deck1.pad1").unwrap(), "deck1.pad1 (sampler page-1)");
        // HOT CUE long press, 90 4B: no bank.
        fed(&mut state, &[note(0, 0x4B, 0x7F)]);
        assert!(unknown(&state, "pad mode"));
    }

    #[test]
    fn a_shifted_mode_button_shows_the_mode_the_manual_gives_it() {
        let mut state = State::new(flx10());
        let deck = flx10().objects[object("deck1.pad1")].owner;
        let mode = |state: &State| flx10().modes[state.shown(deck).mode.unwrap()].clone();
        // SHIFT (90 3F) held, each mode button's shift row (MML p.6 P9-P12; MAN pp.17-18 items 13-16).
        for (button, shifted) in [(0x69, "keyboard"), (0x6B, "padFx2"), (0x6D, "beatLoop"), (0x6F, "keyShift")] {
            fed(&mut state, &[note(0, 0x3F, 0x7F), note(0, button, 0x7F), note(0, button, 0x00), note(0, 0x3F, 0x00)]);
            assert_eq!(mode(&state), shifted);
        }
        // Beat Loop, then PAGE ▶ in it (90 32): page 2's pad 1, 97 68 (MML p.4 P1).
        fed(&mut state, &[note(0, 0x3F, 0x7F), note(0, 0x6D, 0x7F), note(0, 0x3F, 0x00), note(0, 0x32, 0x7F)]);
        let row = state.showing(object("deck1.pad1")).unwrap();
        assert_eq!(flx10().model.controls()[row].midi.message(0), note(7, 0x68, 0));
    }

    #[test]
    fn a_shifted_page_press_tells_its_mode_and_keeps_the_page() {
        let mut state = State::new(flx10());
        // PAGE ▶ in HOT CUE (90 2C), SHIFT + PAGE ◀ in it (90 01, MML p.6 P13; MAN p.18 item 17).
        fed(&mut state, &[note(0, 0x2C, 0x7F), note(0, 0x3F, 0x7F), note(0, 0x01, 0x7F), note(0, 0x3F, 0x00)]);
        assert_eq!(written(&state, "deck1.pad1").unwrap(), "deck1.pad1 (hot-cue page-2)");
        // SAMPLER (90 22, MML p.6 P12), SHIFT + PAGE ▶ in HOT CUE (90 09, P14): a new mode, no page.
        fed(&mut state, &[note(0, 0x22, 0x7F), note(0, 0x3F, 0x7F), note(0, 0x09, 0x7F)]);
        assert!(unknown(&state, "page"));
    }

    #[test]
    fn a_lone_half_keeps_the_other_half_last_reported() {
        let mut state = State::new(flx10());
        let cc = |control, value| Message::ControlChange { channel: 0, control, value };
        fed(&mut state, &[cc(0x13, 0x40), cc(0x33, 0x01), cc(0x13, 0x41), note(0, 0x3F, 0)]);
        let rows = &flx10().objects[object("mixer.channel1.fader")].rows;
        assert_eq!(state.latest(rows), Some(Value::Absolute(0x41 << 7 | 0x01)));
    }
}
