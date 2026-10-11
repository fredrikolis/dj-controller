// Concern: what the computer can show on a model (LEDs, colours, values) as commands, encoded and read back | Non-concern: which address is which control (model) | IO: (Output) -> Messages
use std::fmt;

use crate::midi::Message;
use crate::model::{Address, Control, Model, OutputKind, Part};

/// What to show, by the control's `out` kind, as raw as the device takes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Show {
    Led(bool),
    Colour(u8),
    Value(u16),
}

impl Show {
    pub fn kind(self) -> OutputKind {
        match self {
            Show::Led(_) => OutputKind::Led,
            Show::Colour(_) => OutputKind::Colour,
            Show::Value(_) => OutputKind::Value,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Output {
    pub control: &'static Control,
    pub show: Show,
}

#[derive(Debug, Clone, PartialEq)]
pub enum OutputError {
    /// The control takes a different kind, or nothing.
    Takes { control: String, takes: Option<OutputKind>, given: OutputKind },
    /// A number the control does not take.
    Unfit { control: String, value: f64, unfit: Unfit },
}

/// Why a number is none a device takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unfit {
    /// A fraction, or no number at all.
    NotWhole,
    /// Outside what the model file states.
    OutOfRange,
}

impl fmt::Display for Unfit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Unfit::NotWhole => "is not a whole number",
            Unfit::OutOfRange => "is out of range",
        })
    }
}

/// `n` as a whole number from 0 to `max`.
fn whole(n: f64, max: u16) -> Result<u16, Unfit> {
    if n.fract() != 0.0 {
        return Err(Unfit::NotWhole);
    }
    if !(0.0..=f64::from(max)).contains(&n) {
        return Err(Unfit::OutOfRange);
    }
    Ok(n as u16)
}

impl fmt::Display for OutputError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OutputError::Takes { control, takes: Some(takes), given } => {
                write!(f, "{control} takes a {}, not a {}", takes.name(), given.name())
            }
            OutputError::Takes { control, takes: None, .. } => write!(f, "{control} takes no output"),
            OutputError::Unfit { control, value, unfit } => write!(f, "{control}: {value} {unfit}"),
        }
    }
}

impl std::error::Error for OutputError {}

/// `n` as a colour number: 0 to 127, the model's palette.
pub fn colour(n: f64) -> Result<u8, Unfit> {
    whole(n, 0x7F).map(|c| c as u8)
}

impl Show {
    pub fn colour(control: &Control, n: f64) -> Result<Show, OutputError> {
        colour(n).map(Show::Colour).map_err(|unfit| OutputError::Unfit { control: control.name(), value: n, unfit })
    }

    /// A raw value within what the model file states for `control`.
    pub fn raw(control: &Control, n: f64) -> Result<Show, OutputError> {
        let unfit = |unfit| OutputError::Unfit { control: control.name(), value: n, unfit };
        let value = whole(n, u16::MAX).map_err(unfit)?;
        control.admits(value).then_some(Show::Value(value)).ok_or(unfit(Unfit::OutOfRange))
    }

    /// A value for `control` as the unit shows it where the model file says how (`shows`), else raw.
    pub fn shown(control: &Control, n: f64) -> Result<Show, OutputError> {
        let Some(shows) = &control.shows else { return Show::raw(control, n) };
        let unfit = |unfit| OutputError::Unfit { control: control.name(), value: n, unfit };
        let raw = shows.raw(n).ok_or(unfit(Unfit::NotWhole))?;
        Show::raw(control, raw).map_err(|_| unfit(Unfit::OutOfRange))
    }
}

impl Output {
    /// Every output the model takes, in its file's order, each unlit or at 0, which some value outputs refuse.
    pub fn all(model: &'static Model) -> Vec<Output> {
        let off = |kind| match kind {
            OutputKind::Led => Show::Led(false),
            OutputKind::Colour => Show::Colour(0),
            OutputKind::Value => Show::Value(0),
        };
        model.controls().iter().filter_map(|control| Some(Output { control, show: off(control.output?) })).collect()
    }

    /// The messages that show this, in order. The lists give no order for a 14-bit pair; MSB then
    /// LSB is assumed, unobserved on any unit.
    pub fn encode(&self) -> Result<Vec<Message>, OutputError> {
        let control = self.control;
        if control.output != Some(self.show.kind()) {
            return Err(OutputError::Takes { control: control.name(), takes: control.output, given: self.show.kind() });
        }
        let refuse =
            |value: u16| OutputError::Unfit { control: control.name(), value: value.into(), unfit: Unfit::OutOfRange };
        Ok(match self.show {
            Show::Led(lit) => vec![control.midi.message(if lit { 0x7F } else { 0x00 })],
            Show::Colour(colour) if colour <= 0x7F => vec![control.midi.message(colour)],
            Show::Colour(colour) => return Err(refuse(colour.into())),
            Show::Value(value) if !control.admits(value) => return Err(refuse(value)),
            Show::Value(value) => match control.lsb {
                Some(lsb) => vec![control.midi.message((value >> 7) as u8), lsb.message((value & 0x7F) as u8)],
                None => vec![control.midi.message(value as u8)],
            },
        })
    }

    /// The encoded messages' bytes, back to back.
    pub fn bytes(&self) -> Result<Vec<u8>, OutputError> {
        let messages = self.encode()?;
        Ok(messages.iter().flat_map(|m| m.encode().expect("every output encodes to valid MIDI")).collect())
    }

    /// The output these messages encode on `model`, if they are exactly one: an inverse of `encode`.
    pub fn decode(model: &'static Model, messages: &[Message]) -> Option<Output> {
        let at = |m| Address::of(m).and_then(|(address, value)| Some((model.output_at(address)?, value)));
        let output = match messages {
            [one] => {
                let ((control, Part::Whole), value) = at(one)? else { return None };
                let show = match control.output? {
                    OutputKind::Led => Show::Led(value == 0x7F),
                    OutputKind::Colour => Show::Colour(value),
                    OutputKind::Value => Show::Value(value.into()),
                };
                Output { control, show }
            }
            [first, second] => {
                let (((control, Part::Msb), high), ((partner, Part::Lsb), low)) = (at(first)?, at(second)?) else {
                    return None;
                };
                if !std::ptr::eq(control, partner) {
                    return None;
                }
                Output { control, show: Show::Value(u16::from(high) << 7 | u16::from(low)) }
            }
            _ => return None,
        };
        (output.encode().ok()? == messages).then_some(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flx10() -> &'static Model {
        Model::named("DDJ-FLX10").unwrap()
    }

    fn output(control: &str, layer: &str, show: Show) -> Output {
        Output { control: flx10().control(control, layer).unwrap_or_else(|| panic!("{control}")), show }
    }

    fn bytes(control: &str, layer: &str, show: Show) -> Vec<u8> {
        output(control, layer, show).bytes().unwrap()
    }

    #[test]
    fn a_led_lights_on_the_note_its_button_sends() {
        assert_eq!(bytes("deck3.play-pause", "shift", Show::Led(true)), [0x92, 0x47, 0x7F]);
        assert_eq!(bytes("effect.beat-fx-on-off", "", Show::Led(false)), [0x94, 0x47, 0x00]);
    }

    #[test]
    fn a_control_refuses_an_output_of_another_kind() {
        let error = output("deck1.shift", "", Show::Led(true)).encode().unwrap_err();
        assert_eq!(error.to_string(), "deck1.shift takes no output");
        let error = output("deck1.display.bpm", "", Show::Led(true)).encode().unwrap_err();
        assert_eq!(error.to_string(), "deck1.display.bpm takes a value, not a led");
    }

    #[test]
    fn a_pad_colour_is_the_colour_number_on_the_pad_note() {
        assert_eq!(bytes("deck1.pad5", "hot-cue page-2", Show::Colour(42)), [0x97, 0x0C, 42]);
        assert!(output("deck1.pad5", "hot-cue page-2", Show::Colour(128)).encode().is_err());
    }

    #[test]
    fn fourteen_bit_values_send_msb_then_lsb() {
        assert_eq!(bytes("deck2.display.bpm", "", Show::Value(9999)), [0xBF, 0x15, 0x4E, 0xBF, 0x35, 0x0F]);
        assert_eq!(bytes("deck4.display.cue-point", "", Show::Value(0x3FFF)), [0xBF, 0x1F, 0x7F, 0xBF, 0x3F, 0x7F]);
    }

    #[test]
    fn values_outside_the_stated_range_are_refused() {
        let marker = output("deck1.display.digital-marker", "", Show::Value(360)).encode();
        assert_eq!(marker.unwrap_err().to_string(), "deck1.display.digital-marker: 360 is out of range");
        assert!(output("deck1.jog.ring", "", Show::Value(0x7F)).encode().is_err());
        assert!(output("mixer.channel2.level-meter", "", Show::Value(128)).encode().is_err());
    }

    #[test]
    fn key_and_meter_go_on_the_deck_channel() {
        assert_eq!(bytes("deck2.display.key", "", Show::Value(0x18)), [0xB1, 0x49, 0x18]);
        assert_eq!(bytes("mixer.channel4.level-meter", "", Show::Value(100)), [0xB3, 0x02, 100]);
    }

    #[test]
    fn every_output_is_distinct_and_refused_for_its_range_only() {
        let all = Output::all(flx10());
        let names: std::collections::HashSet<String> = all.iter().map(|o| o.control.name()).collect();
        assert_eq!(names.len(), all.len());
        assert_eq!(all.iter().filter(|o| matches!(o.show, Show::Colour(_))).count(), 4 * 2 * 8 * 2 * 8);
        for output in &all {
            match output.encode() {
                Ok(messages) => assert_eq!(Output::decode(flx10(), &messages).as_ref(), Some(output)),
                Err(e) => assert!(matches!(e, OutputError::Unfit { unfit: Unfit::OutOfRange, .. }), "{e}"),
            }
        }
    }

    #[test]
    fn a_number_is_read_whole_and_within_the_controls_range_or_refused() {
        let pad = flx10().control("deck1.pad1", "hot-cue page-1").unwrap();
        assert_eq!(Show::colour(pad, 127.0), Ok(Show::Colour(127)));
        for (n, why) in
            [(128.0, "out of range"), (257.0, "out of range"), (-1.0, "out of range"), (1.5, "not a whole number")]
        {
            assert!(Show::colour(pad, n).unwrap_err().to_string().ends_with(why), "{n}");
        }
        assert!(Show::colour(pad, f64::NAN).is_err());
        let bpm = flx10().control("deck1.display.bpm", "").unwrap();
        assert_eq!(Show::shown(bpm, 128.0), Ok(Show::Value(1280)));
        assert!(Show::shown(bpm, 128.05).unwrap_err().to_string().ends_with("not a whole number"));
        assert!(Show::shown(bpm, -1.0).unwrap_err().to_string().ends_with("out of range"));
        let marker = flx10().control("deck1.display.digital-marker", "").unwrap();
        assert!(Show::raw(marker, 360.0).unwrap_err().to_string().ends_with("out of range"));
    }

    #[test]
    fn decode_reads_back_what_encode_wrote() {
        let outputs = [
            output("deck3.display.playing-speed", "", Show::Value(5000)),
            output("deck1.display.time.seconds", "", Show::Value(59)),
            output("deck4.display.key-change", "", Show::Value(0x0D)),
            output("display.key-format", "", Show::Value(0x7F)),
            output("mixer.channel1.level-meter", "", Show::Value(0)),
        ];
        for output in outputs {
            assert_eq!(Output::decode(flx10(), &output.encode().unwrap()), Some(output));
        }
    }
}
