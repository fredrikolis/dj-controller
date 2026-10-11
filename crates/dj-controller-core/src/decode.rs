// Concern: turns a model's MIDI messages into control events, pairing each 14-bit control's two CCs | Non-concern: which address is which control (model), framing bytes (midi) | IO: (Message) -> Event
use std::fmt;

use crate::midi::Message;
use crate::model::{Address, Control, Input, Model, Part};

/// What one control's message, or 14-bit pair, carried, by the control's `in` kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Value {
    Button(bool),
    Switch(bool),
    /// 7 or 14 bits, as the control sends.
    Absolute(u16),
    /// The top 7 bits of a 14-bit value whose low half did not follow.
    Msb(u8),
    /// The low 7 bits of a 14-bit value whose top half did not follow.
    Lsb(u8),
    Relative(i8),
    Pad(u8),
}

impl Value {
    /// A pad's velocity.
    pub fn velocity(self) -> u8 {
        let Value::Pad(velocity) = self else { unreachable!("{self:?} is no pad's") };
        velocity
    }

    /// A relative control's signed step.
    pub fn ticks(self) -> i8 {
        let Value::Relative(ticks) = self else { unreachable!("{self:?} is no relative control's") };
        ticks
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let on = |b: bool, yes, no| if b { yes } else { no };
        match *self {
            Value::Button(pressed) => f.write_str(on(pressed, "pressed", "released")),
            Value::Switch(state) => f.write_str(on(state, "on", "off")),
            Value::Absolute(value) => write!(f, "{value}"),
            Value::Msb(msb) => write!(f, "MSB {msb} (LSB not sent)"),
            Value::Lsb(lsb) => write!(f, "LSB {lsb} (MSB not sent)"),
            Value::Relative(step) => write!(f, "{step:+}"),
            Value::Pad(velocity) => write!(f, "velocity {velocity}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// `midi` holds the message or messages it came from, in arrival order.
    Control { control: &'static Control, value: Value, midi: Vec<Message> },
    /// A message the model's file does not list.
    Unmapped(Message),
}

impl fmt::Display for Event {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Event::Control { control, value, .. } => write!(f, "{} · {value}", control.name()),
            Event::Unmapped(_) => f.write_str("unmapped"),
        }
    }
}

/// Decodes one controller's messages in order. Its only state is one held 14-bit half: the lists
/// state no MSB/LSB order, so a half waits for the next message. Its partner completes it in
/// either order; anything else releases it alone as [`Value::Msb`] or [`Value::Lsb`].
#[derive(Debug)]
pub struct Decoder {
    model: &'static Model,
    held: Option<(&'static Control, Part, u8, Message)>,
}

impl Decoder {
    pub fn new(model: &'static Model) -> Decoder {
        Decoder { model, held: None }
    }

    /// The events `message` completes: none while it holds half a pair, two when it releases a lone held half first.
    pub fn feed(&mut self, message: &Message) -> Vec<Event> {
        let found = Address::of(message).and_then(|(address, value)| Some((self.model.input_at(address)?, value)));
        let Some(((control, part), value)) = found else {
            return self.flush().into_iter().chain([Event::Unmapped(message.clone())]).collect();
        };
        if part == Part::Whole {
            return self.flush().into_iter().chain([event(control, part, value, vec![message.clone()])]).collect();
        }
        if let Some((_, held, partner, first)) = self.held.take_if(|h| std::ptr::eq(h.0, control) && h.1 != part) {
            let (msb, lsb) = if held == Part::Msb { (partner, value) } else { (value, partner) };
            let value = Value::Absolute(u16::from(msb) << 7 | u16::from(lsb));
            return vec![Event::Control { control, value, midi: vec![first, message.clone()] }];
        }
        let released = self.flush();
        self.held = Some((control, part, value, message.clone()));
        released.into_iter().collect()
    }

    /// Releases a held half alone, for a transport that knows no more messages are coming.
    pub fn flush(&mut self) -> Option<Event> {
        let (control, part, value, message) = self.held.take()?;
        Some(event(control, part, value, vec![message]))
    }
}

/// The event one message makes on its own. A relative step is the value minus the centre, read as
/// 7-bit two's complement: centre 0x40 gives 0x41 → +1 and 0x3F → −1, centre 0 gives 0x7F → −1.
fn event(control: &'static Control, part: Part, value: u8, midi: Vec<Message>) -> Event {
    let value = match (control.input, part) {
        (_, Part::Msb) => Value::Msb(value),
        (_, Part::Lsb) => Value::Lsb(value),
        (Some(Input::Button), _) => Value::Button(value != 0),
        (Some(Input::Switch), _) => Value::Switch(value != 0),
        (Some(Input::Relative), _) => {
            let step = value.wrapping_sub(control.centre.unwrap_or(0)) & 0x7F;
            Value::Relative(((step << 1) as i8) >> 1)
        }
        (Some(Input::Pad), _) => Value::Pad(value),
        (Some(Input::Absolute) | None, _) => Value::Absolute(value.into()),
    };
    Event::Control { control, value, midi }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flx10() -> &'static Model {
        Model::named("DDJ-FLX10").unwrap()
    }

    fn cc(channel: u8, control: u8, value: u8) -> Message {
        Message::ControlChange { channel, control, value }
    }

    fn note(channel: u8, note: u8, velocity: u8) -> Message {
        Message::NoteOn { channel, note, velocity }
    }

    fn feed(messages: &[Message]) -> Vec<Event> {
        let mut decoder = Decoder::new(flx10());
        messages.iter().flat_map(|m| decoder.feed(m)).collect()
    }

    /// Each event as its control, layer and value, the way a consumer reads it.
    fn read(events: &[Event]) -> Vec<(String, String, Value)> {
        events
            .iter()
            .map(|e| match e {
                Event::Control { control, value, .. } => (control.control.clone(), control.layer.clone(), *value),
                Event::Unmapped(m) => panic!("unmapped {m:?}"),
            })
            .collect()
    }

    fn named(control: &str, layer: &str, value: Value) -> (String, String, Value) {
        (control.to_owned(), layer.to_owned(), value)
    }

    #[test]
    fn a_button_reports_its_control_layer_and_press() {
        let events = feed(&[note(1, 0x47, 0x7F), note(1, 0x47, 0x00)]);
        assert_eq!(
            read(&events),
            [
                named("deck2.play-pause", "shift", Value::Button(true)),
                named("deck2.play-pause", "shift", Value::Button(false))
            ]
        );
        assert_eq!(events[0].to_string(), "deck2.play-pause (shift) · pressed");
    }

    fn ch2(value: Value) -> Vec<(String, String, Value)> {
        vec![named("mixer.channel2.fader", "", value)]
    }

    #[test]
    fn msb_then_lsb_makes_one_fourteen_bit_value_from_both_messages() {
        let events = feed(&[cc(1, 0x13, 0x40), cc(1, 0x33, 0x01)]);
        assert_eq!(read(&events), ch2(Value::Absolute(0x40 << 7 | 0x01)));
        let Event::Control { midi, .. } = &events[0] else { unreachable!() };
        assert_eq!(midi, &[cc(1, 0x13, 0x40), cc(1, 0x33, 0x01)]);
    }

    #[test]
    fn lsb_then_msb_makes_the_same_value() {
        assert_eq!(read(&feed(&[cc(1, 0x33, 0x01), cc(1, 0x13, 0x40)])), ch2(Value::Absolute(0x40 << 7 | 0x01)));
    }

    #[test]
    fn a_lone_half_is_reported_alone_never_joined_to_an_earlier_partner() {
        let shift_down = note(0, 0x3F, 0x7F);
        let events = feed(&[cc(1, 0x13, 0x10), cc(1, 0x33, 0x05), cc(1, 0x13, 0x11), shift_down.clone()]);
        let mut expected = ch2(Value::Absolute(0x10 << 7 | 0x05));
        expected.extend(ch2(Value::Msb(0x11)));
        expected.push(named("deck1.shift", "", Value::Button(true)));
        assert_eq!(read(&events), expected);
        assert_eq!(read(&feed(&[cc(1, 0x33, 0x05), shift_down]))[..1], ch2(Value::Lsb(0x05)));
    }

    #[test]
    fn a_repeated_half_releases_the_one_held() {
        assert_eq!(
            read(&feed(&[cc(6, 0x3F, 0x02), cc(6, 0x3F, 0x03)])),
            [named("mixer.crossfader", "", Value::Lsb(0x02))]
        );
    }

    #[test]
    fn flush_releases_a_held_half() {
        let mut decoder = Decoder::new(flx10());
        assert_eq!(decoder.feed(&cc(0, 0x05, 0x7F)), vec![]);
        assert_eq!(
            read(&decoder.flush().into_iter().collect::<Vec<_>>()),
            [named("deck1.tempo", "shift", Value::Msb(0x7F))]
        );
        assert_eq!(decoder.flush(), None);
    }

    #[test]
    fn halves_of_different_controls_do_not_pair() {
        assert_eq!(
            read(&feed(&[cc(0, 0x13, 0x7F), cc(1, 0x33, 0x7F)])),
            [named("mixer.channel1.fader", "", Value::Msb(0x7F))]
        );
    }

    #[test]
    fn a_relative_control_reads_its_step_around_its_centre() {
        let step = |message| match read(&feed(&[message]))[0].2 {
            Value::Relative(step) => step,
            other => panic!("{other:?}"),
        };
        assert_eq!([0x41, 0x3F, 0x00, 0x7F].map(|v| step(cc(3, 0x22, v))), [1, -1, -64, 63]);
        assert_eq!([0x01, 0x1E, 0x7F, 0x62].map(|v| step(cc(6, 0x40, v))), [1, 30, -1, -30]);
    }

    #[test]
    fn a_pad_reports_its_mode_and_page_as_its_layer_and_its_velocity() {
        assert_eq!(
            read(&feed(&[note(0x0A, 0x4F, 0x7F)])),
            [named("deck2.pad8", "shift keyboard page-2", Value::Pad(0x7F))]
        );
    }

    #[test]
    fn deck_select_is_sent_on_the_lower_decks_channel() {
        let event = feed(&[note(3, 0x72, 0x7F)]).remove(0);
        let Event::Control { control, .. } = event else { unreachable!() };
        assert_eq!(
            (control.control.as_str(), control.source.as_str()),
            ("deck-select.right", "MML p.2 D5, sent on channel 4")
        );
    }

    /// The FLX10's whole answer to its state request, as `amidi -d` printed it, one message a line.
    const STATE_REPLY: &str = include_str!("../fixtures/ddj-flx10-state-2026-10-08.hex");

    #[test]
    fn the_flx10_state_reply_decodes_with_every_pair_whole_and_only_unlisted_addresses_unmapped() {
        let bytes = |line: &str| line.split(' ').map(|b| u8::from_str_radix(b, 16).unwrap()).collect::<Vec<u8>>();
        let messages: Vec<Message> =
            STATE_REPLY.lines().filter(|l| !l.is_empty()).map(|l| Message::parse(&bytes(l)).unwrap()).collect();
        assert_eq!(messages.len(), 104);
        let mut decoder = Decoder::new(flx10());
        let mut events: Vec<Event> = messages.iter().flat_map(|m| decoder.feed(m)).collect();
        events.extend(decoder.flush());
        let (mut wide, mut unmapped) = (0, Vec::new());
        for event in &events {
            match event {
                Event::Control { control, value, midi } => {
                    assert!(!matches!(value, Value::Msb(_) | Value::Lsb(_)), "{} came alone", control.name());
                    wide += usize::from(midi.len() == 2);
                }
                Event::Unmapped(m) => unmapped.push(m.encode().unwrap()),
            }
        }
        // 58 controls, 33 of them 14-bit pairs: 66 + 25 messages, and 13 unmapped make 104.
        assert_eq!((events.len() - unmapped.len(), wide), (58, 33));
        // In neither the MML (E1) nor the community maps: what they are is open (docs/research/flx10-observed.md).
        let unlisted = [
            "90 3A 00", "91 3A 00", "92 3A 00", "93 3A 00", "90 3B 00", "91 3B 00", "92 3B 00", "93 3B 00", "94 46 00",
            "94 60 00", "B4 50 09", "B4 70 30", "92 4E 7F",
        ];
        assert_eq!(unmapped, unlisted.map(bytes));
    }

    /// Deck 2's jog, as `amidi -d` printed it (owner, 2026-10-10, docs/research/flx10-observed-jog.md):
    /// touched, a slow platter lap marked by hand; released, a side lap; touched, a normal-speed platter lap.
    const JOG_LAPS: &str = include_str!("../fixtures/ddj-flx10-jog-laps-2026-10-10.hex");

    #[test]
    fn the_flx10_jog_laps_sum_within_the_platters_revolution_and_the_side_never_steps_below_its_least() {
        let bytes = |line: &str| line.split(' ').map(|b| u8::from_str_radix(b, 16).unwrap()).collect::<Vec<u8>>();
        let mut decoder = Decoder::new(flx10());
        // Each run of one control's reports: its control and layer, and steps.
        let mut runs: Vec<(&str, &str, Vec<i8>)> = Vec::new();
        for line in JOG_LAPS.lines().filter(|l| !l.is_empty()) {
            for event in decoder.feed(&Message::parse(&bytes(line)).unwrap()) {
                let Event::Control { control, value: Value::Relative(step), .. } = event else { continue };
                match runs.last_mut() {
                    Some((name, layer, steps)) if (*name, *layer) == (&control.control[..], &control.layer[..]) => {
                        steps.push(step)
                    }
                    _ => runs.push((&control.control, &control.layer, vec![step])),
                }
            }
        }
        let sum = |steps: &[i8]| steps.iter().map(|&s| i32::from(s)).sum::<i32>();
        let summary: Vec<(&str, &str, i32)> = runs.iter().map(|(n, l, s)| (*n, *l, sum(s))).collect();
        let (platter, side) = (("deck2.jog.platter", "vinyl-off"), ("deck2.jog.side", ""));
        let lap = |(name, layer): (&'static str, &'static str), ticks| (name, layer, ticks);
        assert_eq!(summary, [lap(platter, 12884), lap(side, 1081), lap(platter, 13266)]);
        let control = |name: &str, layer: &str| flx10().control(name, layer).unwrap();
        let revolution = control("deck2.jog.platter", "vinyl-off").revolution.unwrap();
        assert_eq!(revolution.laps.map(i64::from), [summary[0].2, summary[2].2].map(i64::from));
        let least = control("deck2.jog.side", "").least_step.unwrap();
        assert!(runs[1].2.iter().all(|&s| s.unsigned_abs() >= least), "a side report below its least step");
    }

    #[test]
    fn messages_the_list_does_not_hold_stay_midi() {
        for message in [note(5, 0x00, 0x7F), Message::NoteOff { channel: 0, note: 0x0B, velocity: 0 }] {
            assert_eq!(feed(std::slice::from_ref(&message)), vec![Event::Unmapped(message)]);
        }
    }
}
