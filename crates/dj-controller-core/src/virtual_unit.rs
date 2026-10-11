// Concern: a unit with no hardware: a gesture on a physical control as the message its model sends, received by its session | Non-concern: where gestures come from | IO: (gesture) -> messages received
//! The unit keeps no state of its own: a gesture's row is the one its session last heard the owner
//! on, its SHIFT, pad mode and
//! page, which its session, the device itself, knows: a pad mode comes up on the page it was left
//! on, page 1 if never (assumed, unobserved on any unit). Any other layer (`long-press`, `vinyl-on`, a shared control's deck) the gesture names.

use crate::decode::Value;
use crate::error::Error;
use crate::midi::Message;
use crate::model::{Control, Input, Model, VirtualUnit as Facts};
use crate::session::Session;
use crate::surface::{Kind, Object, Surface, surface};

/// A gesture's layer beyond SHIFT, pad mode and page: its other words as the model file writes
/// them, and the 0-based member a shared control names.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Layer {
    pub rest: String,
    pub index: Option<usize>,
}

/// What a hand does to one physical control.
#[derive(Debug, Clone, PartialEq)]
pub enum Gesture {
    Press(Layer),
    Release,
    /// 1 to 127.
    Hit(u8),
    Lift,
    /// 0 to the control's `max`.
    Move(u16),
    /// Signed ticks, any number: sent as the 7-bit steps they fit in.
    Turn(i64, Layer),
    Flip(bool),
}

/// Cloning shares its session.
#[derive(Clone)]
pub struct VirtualUnit {
    session: Session,
    facts: &'static Facts,
}

fn refused<T>(why: String) -> Result<T, Error> {
    Err(Error::Refused(why))
}

impl VirtualUnit {
    /// Refused for a model whose file states no `virtual`.
    pub fn new(session: &Session) -> Result<VirtualUnit, Error> {
        let model = session.model();
        match &model.virtual_unit {
            Some(facts) => {
                session.own_device();
                Ok(VirtualUnit { session: session.clone(), facts })
            }
            None => refused(format!("{} has no virtual unit: its model file states no `virtual`", model.name)),
        }
    }

    fn model(&self) -> &'static Model {
        self.session.model()
    }

    fn surface(&self) -> &'static Surface {
        surface(self.model())
    }

    /// Tells every output its rest state, then reports every absolute control and switch where it
    /// rests, as a device answers its state request.
    pub fn start(&self) -> Result<(), Error> {
        self.session.sync(&[], 0.0)?;
        let model = self.model();
        for control in model.controls().iter().filter(|c| c.layer.is_empty()) {
            match control.input {
                Some(Input::Absolute) => {
                    let rest = self.facts.rest.iter().find(|r| r.control == control.control);
                    self.receive(&absolute(control, rest.map_or(control.max().div_ceil(2), |r| r.value)));
                }
                Some(Input::Switch) => {
                    let first = |s: &crate::model::Selector| s.positions[0] == control.control;
                    let placed = self.facts.selectors.iter().any(|s| s.positions.contains(&control.control))
                        || self.facts.toggles.contains(&control.control);
                    if placed {
                        self.receive(&[control.midi.message(on(self.facts.selectors.iter().any(first)))]);
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn receive(&self, messages: &[Message]) {
        for message in messages {
            self.session.receive_framed(Ok(message.clone()), self.session.now());
        }
    }

    /// Every layer word a gesture on `object` may name.
    pub fn layers(&self, object: usize) -> Vec<String> {
        let layers = &self.surface().layers;
        let mut rest: Vec<String> = Vec::new();
        for &row in &self.surface().objects[object].rows {
            if !rest.contains(&layers[row].rest) {
                rest.push(layers[row].rest.clone());
            }
        }
        rest
    }

    /// How a hand moves the switch `object`: `Some(true)` one position of a selector, `Some(false)`
    /// a switch flipped alone, none a state its unit reports.
    pub fn selects(&self, object: usize) -> Option<bool> {
        let o = &self.surface().objects[object];
        let name = &self.model().controls()[o.rows[0]].control;
        let selector = self.facts.selectors.iter().any(|s| s.positions.contains(name));
        (o.kind == Kind::Switch && (selector || self.facts.toggles.contains(name))).then_some(selector)
    }

    /// The row of `object` a device would send on now. A control with no row for a held SHIFT
    /// sends its plain one: assumed, unobserved on any unit.
    fn row(&self, object: usize, layer: &Layer) -> Result<usize, Error> {
        let surface = self.surface();
        let o = &surface.objects[object];
        let name = &self.model().controls()[o.rows[0]].control;
        let shown = self.session.shown(o.owner);
        let (shift, mode, page) = (shown.shift, shown.mode, shown.mode.map(|_| shown.page.unwrap_or(0)));
        let input = |r: &&usize| self.model().controls()[**r].input.is_some();
        let named: Vec<usize> =
            o.rows.iter().filter(input).copied().filter(|&r| surface.layers[r].rest == layer.rest).collect();
        if named.is_empty() {
            return refused(format!("{name} has no layer {:?}: its layers are {:?}", layer.rest, self.layers(object)));
        }
        let mut fits = Vec::new();
        for &r in &named {
            let l = &surface.layers[r];
            if l.mode.is_some() && mode.is_none() {
                return Err(Error::Unshown(format!("{name}: its pad mode is not known yet")));
            }
            let indexed = match (l.indices.first(), layer.index) {
                (Some((_, at)), Some(index)) => *at == index,
                (None, None) => true,
                (Some((field, _)), None) => return refused(format!("{name}: the gesture names no {field}")),
                (None, Some(_)) => return refused(format!("{name} is no shared control: it takes no index")),
            };
            if indexed && l.mode.is_none_or(|m| mode == Some(m)) && l.page.is_none_or(|p| page == Some(p)) {
                fits.push(r);
            }
        }
        let shifted = |want: bool| fits.iter().copied().find(|&r| surface.layers[r].shift == want);
        match shifted(shift).or_else(|| shift.then(|| shifted(false)).flatten()) {
            Some(row) => Ok(row),
            None => refused(format!("{name} sends nothing on layer {:?} as its unit stands", layer.rest)),
        }
    }

    fn held(&self, o: &Object) -> Vec<usize> {
        let down = |r: &usize| match self.session.latest(std::slice::from_ref(r)) {
            Some(Value::Button(pressed)) => pressed,
            Some(Value::Pad(velocity)) => velocity > 0,
            _ => false,
        };
        o.rows.iter().copied().filter(down).collect()
    }

    /// Its messages are received by the session before this returns.
    pub fn act(&self, object: usize, gesture: &Gesture) -> Result<(), Error> {
        if let Some(reason) = self.session.reason() {
            return Err(Error::Closed(reason));
        }
        let surface = self.surface();
        let o = &surface.objects[object];
        let controls = self.model().controls();
        let name = &controls[o.rows[0]].control;
        let takes = |kind: Kind, what: &str| match o.kind == kind {
            true => Ok(()),
            false => refused(format!("{name} is a {}: it takes no {what}", o.kind.name())),
        };
        match gesture {
            Gesture::Press(layer) => {
                takes(Kind::Button, "press")?;
                let row = self.row(object, layer)?;
                if self.held(o).contains(&row) {
                    return refused(format!("{name} is held already"));
                }
                self.receive(&[controls[row].midi.message(on(true))]);
                let selector = self.facts.selectors.iter().find(|s| s.button.as_ref() == Some(name));
                if let Some(selector) = selector.filter(|_| controls[row].layer.is_empty()) {
                    let at = selector.positions.iter().position(|p| self.is_on(p)).map_or(0, |at| at + 1);
                    self.select(selector, &selector.positions[at % selector.positions.len()]);
                }
            }
            Gesture::Release => {
                takes(Kind::Button, "release")?;
                for row in self.held(o) {
                    self.receive(&[controls[row].midi.message(on(false))]);
                }
            }
            Gesture::Hit(velocity) => {
                takes(Kind::Pad, "hit")?;
                if !(1..=0x7F).contains(velocity) {
                    return refused(format!("{name}: a hit's velocity is 1 to 127, not {velocity}"));
                }
                let row = self.row(object, &Layer::default())?;
                self.receive(&[controls[row].midi.message(*velocity)]);
            }
            Gesture::Lift => {
                takes(Kind::Pad, "lift")?;
                for row in self.held(o) {
                    self.receive(&[controls[row].midi.message(0)]);
                }
            }
            Gesture::Move(value) => {
                takes(Kind::Absolute, "move")?;
                let control = &controls[self.row(object, &Layer::default())?];
                if *value > control.max() {
                    return refused(format!("{name}: {value} is past its {}", control.max()));
                }
                self.receive(&absolute(control, *value));
            }
            Gesture::Turn(ticks, layer) => {
                takes(Kind::Relative, "turn")?;
                let control = &controls[self.row(object, layer)?];
                let centre = control.centre.unwrap_or(0);
                let mut left = *ticks;
                // decode.rs: a step is the value minus the centre as 7-bit two's complement, -64 to 63.
                while left != 0 {
                    let step = left.clamp(-64, 63);
                    left -= step;
                    self.receive(&[control.midi.message(centre.wrapping_add(step as u8) & 0x7F)]);
                }
            }
            Gesture::Flip(to) => {
                takes(Kind::Switch, "flip")?;
                if let Some(selector) = self.facts.selectors.iter().find(|s| s.positions.contains(name)) {
                    if !to {
                        return refused(format!("{name} is one position of a selector: flip another on instead"));
                    }
                    self.select(selector, name);
                } else if self.facts.toggles.contains(name) {
                    self.receive(&[controls[self.row(object, &Layer::default())?].midi.message(on(*to))]);
                } else {
                    return refused(format!("{name} is a state its unit reports, moved by no hand"));
                }
            }
        }
        Ok(())
    }

    fn plain(&self, name: &str) -> &'static Control {
        self.model().control(name, "").expect("the model file's check found it")
    }

    fn is_on(&self, name: &str) -> bool {
        let row = self.model().row(self.plain(name));
        self.session.latest(&[row]) == Some(Value::Switch(true))
    }

    /// Moves `selector` to `to`: the position left reports off, then `to` on.
    fn select(&self, selector: &crate::model::Selector, to: &str) {
        for position in selector.positions.iter().filter(|p| *p != to && self.is_on(p)) {
            self.receive(&[self.plain(position).midi.message(on(false))]);
        }
        if !self.is_on(to) {
            self.receive(&[self.plain(to).midi.message(on(true))]);
        }
    }
}

/// 0x7F on, 0x00 off, as every row's source lists it.
fn on(on: bool) -> u8 {
    if on { 0x7F } else { 0x00 }
}

/// An absolute control's report of `value`: MSB then LSB where it has one, as the unit was seen
/// to send them (docs/research/flx10-observed.md, 2026-10-08).
fn absolute(control: &Control, value: u16) -> Vec<Message> {
    match control.lsb {
        Some(lsb) => vec![control.midi.message((value >> 7) as u8), lsb.message((value & 0x7F) as u8)],
        None => vec![control.midi.message(value as u8)],
    }
}

#[cfg(test)]
mod tests {
    use std::future::Future;
    use std::pin::Pin;

    use futures_lite::{StreamExt, future};

    use super::*;
    use crate::session::Link;

    struct NoDevice;

    impl Link for NoDevice {
        fn send(&self, _: &[u8], _: Option<f64>) -> Result<(), String> {
            Ok(())
        }
        fn now(&self) -> f64 {
            0.0
        }
        fn sleep(&self, _: f64) -> Pin<Box<dyn Future<Output = ()>>> {
            Box::pin(future::ready(()))
        }
    }

    fn flx10() -> &'static Model {
        Model::named("DDJ-FLX10").unwrap()
    }

    fn unit() -> (Session, VirtualUnit) {
        let session = Session::new(flx10(), NoDevice);
        let unit = VirtualUnit::new(&session).unwrap();
        unit.start().unwrap();
        (session, unit)
    }

    fn object(name: &str) -> usize {
        let row = flx10().controls().iter().position(|c| c.control == name).unwrap();
        surface(flx10()).row_object[row]
    }

    fn message(name: &str, layer: &str, value: u8) -> Vec<u8> {
        flx10().control(name, layer).unwrap().midi.message(value).encode().unwrap()
    }

    /// The bytes the session received for `gestures`, message by message.
    fn sent(session: &Session, unit: &VirtualUnit, gestures: &[(&str, Gesture)]) -> Vec<Vec<u8>> {
        let mut received = session.received();
        for (name, gesture) in gestures {
            unit.act(object(name), gesture).unwrap();
        }
        session.close(crate::error::CloseReason::Closed);
        future::block_on(async {
            let mut all = Vec::new();
            while let Some(one) = received.next().await {
                all.push(one.bytes.clone());
            }
            all
        })
    }

    fn press() -> Gesture {
        Gesture::Press(Layer::default())
    }

    fn value(session: &Session, name: &str) -> Option<Value> {
        session.latest(&[flx10().row(flx10().control(name, "").unwrap())])
    }

    #[test]
    fn a_started_unit_has_reported_every_control_where_the_model_file_rests_it() {
        let (session, _) = unit();
        assert_eq!(value(&session, "mixer.channel1.fader"), Some(Value::Absolute(16383)));
        assert_eq!(value(&session, "mixer.crossfader"), Some(Value::Absolute(8192)));
        assert_eq!(value(&session, "deck2.tempo"), Some(Value::Absolute(8192)));
        assert_eq!(value(&session, "mixer.channel2.crossfader-assign.thru"), Some(Value::Switch(true)));
        assert_eq!(value(&session, "mixer.channel2.crossfader-assign.a"), Some(Value::Switch(false)));
        assert_eq!(value(&session, "deck1.in-control"), Some(Value::Switch(true)));
        assert_eq!(value(&session, "deck3.in-control"), Some(Value::Switch(false)));
        assert_eq!(value(&session, "mixer.channel3.line-phono.line"), Some(Value::Switch(false)));
        let absolutes = flx10().controls().iter().filter(|c| c.layer.is_empty() && c.input == Some(Input::Absolute));
        assert!(absolutes.into_iter().all(|c| value(&session, &c.control).is_some()));
    }

    // 90 3F, 90 47: SHIFT and SHIFT+PLAY as the unit sent them (docs/research/flx10-observed.md, 2026-10-08).
    #[test]
    fn a_press_goes_on_the_shift_layer_while_shift_is_held_and_is_released_on_the_row_it_went_down_on() {
        let (session, unit) = unit();
        let gestures = [
            ("deck1.shift", press()),
            ("deck1.play-pause", press()),
            ("deck1.shift", Gesture::Release),
            ("deck1.play-pause", Gesture::Release),
            ("deck1.play-pause", press()),
        ];
        assert_eq!(
            sent(&session, &unit, &gestures),
            [[0x90, 0x3F, 0x7F], [0x90, 0x47, 0x7F], [0x90, 0x3F, 0x00], [0x90, 0x47, 0x00], [0x90, 0x0B, 0x7F]]
        );
    }

    #[test]
    fn a_pad_hit_goes_on_the_pad_mode_and_page_its_buttons_chose_a_mode_coming_up_on_the_page_it_was_left_on() {
        let (session, unit) = unit();
        let gestures = [
            ("deck1.pad1", Gesture::Hit(100)),
            ("deck1.pad1", Gesture::Lift),
            ("deck1.pad-mode.sampler", press()),
            ("deck1.pad-mode.sampler", Gesture::Release),
            ("deck1.pad3", Gesture::Hit(1)),
            ("deck1.page.right", press()),
            ("deck1.pad3", Gesture::Lift),
            ("deck1.shift", press()),
            ("deck1.pad3", Gesture::Hit(127)),
            ("deck1.pad3", Gesture::Lift),
            ("deck1.shift", Gesture::Release),
            ("deck1.pad-mode.hot-cue", press()),
            ("deck1.pad2", Gesture::Hit(9)),
            ("deck1.pad-mode.sampler", press()),
            ("deck1.pad2", Gesture::Lift),
            ("deck1.pad2", Gesture::Hit(9)),
        ];
        assert_eq!(
            sent(&session, &unit, &gestures),
            [
                message("deck1.pad1", "hot-cue page-1", 100),
                message("deck1.pad1", "hot-cue page-1", 0),
                message("deck1.pad-mode.sampler", "", 0x7F),
                message("deck1.pad-mode.sampler", "", 0),
                message("deck1.pad3", "sampler page-1", 1),
                message("deck1.page.right", "sampler", 0x7F),
                message("deck1.pad3", "sampler page-1", 0),
                message("deck1.shift", "", 0x7F),
                message("deck1.pad3", "shift sampler page-2", 127),
                message("deck1.pad3", "shift sampler page-2", 0),
                message("deck1.shift", "", 0),
                message("deck1.pad-mode.hot-cue", "", 0x7F),
                message("deck1.pad2", "hot-cue page-1", 9),
                message("deck1.pad-mode.sampler", "", 0x7F),
                message("deck1.pad2", "hot-cue page-1", 0),
                message("deck1.pad2", "sampler page-2", 9),
            ]
        );
    }

    // B0 00 / B0 20: TEMPO's MSB then LSB (MML p.2 D4); B0 22 around 0x40 (MML p.2 D3).
    #[test]
    fn a_move_sends_both_halves_and_a_turn_as_many_steps_as_its_ticks_take() {
        let (session, unit) = unit();
        let vinyl = Layer { rest: "vinyl-on".into(), index: None };
        let gestures = [
            ("deck1.tempo", Gesture::Move(0x1234)),
            ("mixer.channel1.level-meter", Gesture::Move(0)),
            ("deck1.jog.platter", Gesture::Turn(70, vinyl.clone())),
            ("deck1.jog.platter", Gesture::Turn(-3, vinyl)),
            ("browser.rotate", Gesture::Turn(-1, Layer::default())),
        ];
        let refused = unit.act(object(gestures[1].0), &gestures[1].1).unwrap_err();
        assert!(matches!(refused, Error::Refused(_)), "{refused:?}");
        let moved = [gestures[0].clone(), gestures[2].clone(), gestures[3].clone(), gestures[4].clone()];
        assert_eq!(
            sent(&session, &unit, &moved),
            [
                vec![0xB0, 0x00, 0x24],
                vec![0xB0, 0x20, 0x34],
                vec![0xB0, 0x22, 0x7F],
                vec![0xB0, 0x22, 0x47],
                vec![0xB0, 0x22, 0x3D],
                message("browser.rotate", "", 0x7F),
            ]
        );
    }

    #[test]
    fn a_selector_leaves_one_position_for_another_and_its_button_steps_it_round() {
        let (session, unit) = unit();
        let gestures = [
            ("mixer.channel1.crossfader-assign.b", Gesture::Flip(true)),
            ("mixer.channel1.crossfader-assign.b", Gesture::Flip(true)),
            ("deck-select.left", press()),
            ("deck-select.left", Gesture::Release),
            ("mixer.channel3.line-phono.line", Gesture::Flip(true)),
        ];
        assert_eq!(
            sent(&session, &unit, &gestures),
            [
                message("mixer.channel1.crossfader-assign.thru", "", 0),
                message("mixer.channel1.crossfader-assign.b", "", 0x7F),
                message("deck-select.left", "", 0x7F),
                message("deck1.in-control", "", 0),
                message("deck3.in-control", "", 0x7F),
                message("deck-select.left", "", 0),
                message("mixer.channel3.line-phono.line", "", 0x7F),
            ]
        );
    }

    #[test]
    fn a_gesture_its_control_cannot_take_is_refused_with_why() {
        let (_, unit) = unit();
        let refused = |name: &str, gesture: Gesture| match unit.act(object(name), &gesture) {
            Err(Error::Refused(why)) => why,
            other => panic!("{name}: {other:?}"),
        };
        assert!(refused("deck1.jog.platter", Gesture::Turn(1, Layer::default())).contains("sends nothing"));
        assert!(
            refused("deck1.jog.platter", Gesture::Turn(1, Layer { rest: "vinyl".into(), index: None }))
                .contains("vinyl-on")
        );
        assert!(refused("deck1.pad1", press()).contains("takes no press"));
        assert!(refused("deck1.pad1", Gesture::Hit(0)).contains("1 to 127"));
        assert!(refused("mixer.crossfader", Gesture::Move(0x4000)).contains("past"));
        assert!(refused("mixer.mic.on", Gesture::Flip(false)).contains("selector"));
        assert!(refused("mixer.channel1.fader-start.leaves-zero", Gesture::Flip(true)).contains("no hand"));
        assert!(refused("browser.press", press()).contains("names no deck"));
        assert_eq!(unit.selects(object("mixer.mic.on")), Some(true));
        assert_eq!(unit.selects(object("mixer.channel3.line-phono.line")), Some(false));
        assert_eq!(unit.selects(object("mixer.channel1.fader-start.leaves-zero")), None);
        assert_eq!(unit.selects(object("deck1.cue")), None);
        unit.act(object("deck1.cue"), &press()).unwrap();
        assert!(refused("deck1.cue", press()).contains("held already"));
        unit.act(object("browser.press"), &Gesture::Press(Layer { rest: String::new(), index: Some(2) })).unwrap();
    }
}
