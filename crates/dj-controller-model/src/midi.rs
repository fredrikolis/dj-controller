// Concern: MIDI 1.0 messages as typed values: parsed from bytes, encoded back, framed from a byte stream | Non-concern: which control a message names | IO: (bytes) -> Message; (Message) -> bytes
//! Status bytes and lengths are the MIDI 1.0 Detailed Specification 4.2's (MIDI Association),
//! Table I, "Summary of Status Bytes". Channels are 0-based here, 0..=15.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Message {
    NoteOff {
        channel: u8,
        note: u8,
        velocity: u8,
    },
    /// Velocity 0 is kept as sent, not turned into a note-off.
    NoteOn {
        channel: u8,
        note: u8,
        velocity: u8,
    },
    PolyPressure {
        channel: u8,
        note: u8,
        pressure: u8,
    },
    ControlChange {
        channel: u8,
        control: u8,
        value: u8,
    },
    ProgramChange {
        channel: u8,
        program: u8,
    },
    ChannelPressure {
        channel: u8,
        pressure: u8,
    },
    /// 14-bit, 0..=16383, centre 8192.
    PitchBend {
        channel: u8,
        value: u16,
    },
    /// The bytes between `F0` and `F7`.
    SysEx(Vec<u8>),
    /// System common (`F1`..=`F6`) and real-time (`F8`..=`FF`) messages, as sent.
    System {
        status: u8,
        data: Vec<u8>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    Empty,
    /// The first byte is a data byte, or a stream sent one with no status to run on.
    NoStatus(u8),
    /// `F7` or the reserved status bytes, which open no message.
    UndefinedStatus(u8),
    /// A data byte with its top bit set, at this index.
    DataOutOfRange(usize),
    Length {
        status: u8,
        expected: usize,
        got: usize,
    },
    UnterminatedSysEx,
    /// A value too wide for its field.
    ValueOutOfRange,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Empty => write!(f, "no bytes"),
            Error::NoStatus(b) => write!(f, "data byte {b:02X} with no status"),
            Error::UndefinedStatus(b) => write!(f, "status {b:02X} opens no message"),
            Error::DataOutOfRange(i) => write!(f, "byte {i} is not a data byte"),
            Error::Length { status, expected, got } => {
                write!(f, "status {status:02X} takes {expected} bytes, got {got}")
            }
            Error::UnterminatedSysEx => write!(f, "sysex without F7"),
            Error::ValueOutOfRange => write!(f, "a value is too wide for its field"),
        }
    }
}

impl std::error::Error for Error {}

const SYSEX: u8 = 0xF0;
const SYSEX_END: u8 = 0xF7;

/// The whole length of the message `status` opens, `None` for sysex (ended by `F7`), or
/// an error for a status that opens none.
fn length_of(status: u8) -> Result<Option<usize>, Error> {
    match status {
        0x80..=0xBF | 0xE0..=0xEF => Ok(Some(3)),
        0xC0..=0xDF => Ok(Some(2)),
        SYSEX => Ok(None),
        0xF1 | 0xF3 => Ok(Some(2)),
        0xF2 => Ok(Some(3)),
        0xF6 | 0xF8 | 0xFA..=0xFC | 0xFE | 0xFF => Ok(Some(1)),
        _ => Err(Error::UndefinedStatus(status)),
    }
}

fn is_data(b: u8) -> bool {
    b < 0x80
}

impl Message {
    /// One whole message, as Web MIDI delivers it (running status already resolved).
    pub fn parse(bytes: &[u8]) -> Result<Message, Error> {
        let (&status, data) = bytes.split_first().ok_or(Error::Empty)?;
        if is_data(status) {
            return Err(Error::NoStatus(status));
        }
        let Some(expected) = length_of(status)? else {
            let Some((&SYSEX_END, body)) = data.split_last() else {
                return Err(Error::UnterminatedSysEx);
            };
            if let Some(i) = body.iter().position(|&b| !is_data(b)) {
                return Err(Error::DataOutOfRange(i + 1));
            }
            return Ok(Message::SysEx(body.to_vec()));
        };
        if bytes.len() != expected {
            return Err(Error::Length { status, expected, got: bytes.len() });
        }
        if let Some(i) = data.iter().position(|&b| !is_data(b)) {
            return Err(Error::DataOutOfRange(i + 1));
        }
        let channel = status & 0x0F;
        let at = |i: usize| data[i];
        Ok(match status & 0xF0 {
            0x80 => Message::NoteOff { channel, note: at(0), velocity: at(1) },
            0x90 => Message::NoteOn { channel, note: at(0), velocity: at(1) },
            0xA0 => Message::PolyPressure { channel, note: at(0), pressure: at(1) },
            0xB0 => Message::ControlChange { channel, control: at(0), value: at(1) },
            0xC0 => Message::ProgramChange { channel, program: at(0) },
            0xD0 => Message::ChannelPressure { channel, pressure: at(0) },
            0xE0 => Message::PitchBend { channel, value: u16::from(at(0)) | u16::from(at(1)) << 7 },
            _ => Message::System { status, data: data.to_vec() },
        })
    }

    /// The bytes that send this message, refusing any field too wide for it.
    pub fn encode(&self) -> Result<Vec<u8>, Error> {
        let bytes = match self {
            Message::NoteOff { channel, note, velocity } => vec![0x80 | channel, *note, *velocity],
            Message::NoteOn { channel, note, velocity } => vec![0x90 | channel, *note, *velocity],
            Message::PolyPressure { channel, note, pressure } => vec![0xA0 | channel, *note, *pressure],
            Message::ControlChange { channel, control, value } => vec![0xB0 | channel, *control, *value],
            Message::ProgramChange { channel, program } => vec![0xC0 | channel, *program],
            Message::ChannelPressure { channel, pressure } => vec![0xD0 | channel, *pressure],
            Message::PitchBend { channel, value } => {
                if *value > 0x3FFF {
                    return Err(Error::ValueOutOfRange);
                }
                vec![0xE0 | channel, (value & 0x7F) as u8, (value >> 7) as u8]
            }
            Message::SysEx(body) => [&[SYSEX][..], body, &[SYSEX_END]].concat(),
            Message::System { status, .. } if *status <= SYSEX || *status == SYSEX_END => {
                return Err(Error::UndefinedStatus(*status));
            }
            Message::System { status, data } => [&[*status][..], data].concat(),
        };
        if let Some(channel) = self.channel()
            && channel > 0x0F
        {
            return Err(Error::ValueOutOfRange);
        }
        // Re-parsing checks every data byte and a system message's status and length.
        Message::parse(&bytes).map_err(|e| match e {
            Error::DataOutOfRange(_) => Error::ValueOutOfRange,
            e => e,
        })?;
        Ok(bytes)
    }

    pub fn channel(&self) -> Option<u8> {
        match self {
            Message::NoteOff { channel, .. }
            | Message::NoteOn { channel, .. }
            | Message::PolyPressure { channel, .. }
            | Message::ControlChange { channel, .. }
            | Message::ProgramChange { channel, .. }
            | Message::ChannelPressure { channel, .. }
            | Message::PitchBend { channel, .. } => Some(*channel),
            Message::SysEx(_) | Message::System { .. } => None,
        }
    }
}

/// Splits a raw MIDI byte stream (a serial or ALSA rawmidi port) into messages, as a
/// receiver must: running status, real-time bytes interleaved anywhere, sysex across reads.
#[derive(Debug, Default)]
pub struct Framer {
    pending: Vec<u8>,
    running: Option<u8>,
}

impl Framer {
    pub fn new() -> Framer {
        Framer::default()
    }

    /// Feeds bytes as read; every message, or error for bytes that fit none, they complete.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Result<Message, Error>> {
        let mut out = Vec::new();
        for &byte in bytes {
            self.push(byte, &mut out);
        }
        out
    }

    fn push(&mut self, byte: u8, out: &mut Vec<Result<Message, Error>>) {
        if byte >= 0xF8 {
            return out.push(Message::parse(&[byte]));
        }
        if byte == SYSEX_END && self.pending.first() == Some(&SYSEX) {
            self.pending.push(byte);
            return out.push(Message::parse(&std::mem::take(&mut self.pending)));
        }
        if !is_data(byte) {
            if let Some(&cut) = self.pending.first() {
                out.push(Err(if cut == SYSEX {
                    Error::UnterminatedSysEx
                } else {
                    let expected = length_of(cut).ok().flatten().unwrap_or(0);
                    Error::Length { status: cut, expected, got: self.pending.len() }
                }));
                self.pending.clear();
            }
            // Only channel messages leave a status that following data runs on.
            self.running = (byte < 0xF0).then_some(byte);
        } else if self.pending.is_empty() {
            match self.running {
                Some(status) => self.pending.push(status),
                None => return out.push(Err(Error::NoStatus(byte))),
            }
        }
        self.pending.push(byte);
        let status = self.pending[0];
        match length_of(status) {
            Ok(None) => {}
            Ok(Some(n)) if self.pending.len() < n => {}
            _ => out.push(Message::parse(&std::mem::take(&mut self.pending))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_messages_parse_to_their_fields() {
        assert_eq!(Message::parse(&[0x93, 60, 127]), Ok(Message::NoteOn { channel: 3, note: 60, velocity: 127 }));
        assert_eq!(Message::parse(&[0x80, 60, 0]), Ok(Message::NoteOff { channel: 0, note: 60, velocity: 0 }));
        assert_eq!(Message::parse(&[0xBF, 7, 64]), Ok(Message::ControlChange { channel: 15, control: 7, value: 64 }));
        assert_eq!(Message::parse(&[0xA1, 36, 90]), Ok(Message::PolyPressure { channel: 1, note: 36, pressure: 90 }));
        assert_eq!(Message::parse(&[0xC2, 5]), Ok(Message::ProgramChange { channel: 2, program: 5 }));
        assert_eq!(Message::parse(&[0xD4, 33]), Ok(Message::ChannelPressure { channel: 4, pressure: 33 }));
    }

    #[test]
    fn a_note_on_at_velocity_zero_stays_a_note_on() {
        assert_eq!(Message::parse(&[0x90, 60, 0]), Ok(Message::NoteOn { channel: 0, note: 60, velocity: 0 }));
    }

    #[test]
    fn pitch_bend_joins_lsb_then_msb_into_fourteen_bits() {
        assert_eq!(Message::parse(&[0xE0, 0x00, 0x40]), Ok(Message::PitchBend { channel: 0, value: 8192 }));
        assert_eq!(Message::parse(&[0xE5, 0x7F, 0x7F]), Ok(Message::PitchBend { channel: 5, value: 16383 }));
        assert_eq!(Message::parse(&[0xE0, 0x01, 0x00]), Ok(Message::PitchBend { channel: 0, value: 1 }));
    }

    #[test]
    fn sysex_and_system_messages_keep_their_bytes() {
        assert_eq!(Message::parse(&[0xF0, 0x00, 0x40, 0x05, 0xF7]), Ok(Message::SysEx(vec![0x00, 0x40, 0x05])));
        assert_eq!(Message::parse(&[0xF8]), Ok(Message::System { status: 0xF8, data: vec![] }));
        assert_eq!(Message::parse(&[0xF2, 1, 2]), Ok(Message::System { status: 0xF2, data: vec![1, 2] }));
    }

    #[test]
    fn malformed_bytes_say_what_is_wrong() {
        assert_eq!(Message::parse(&[]), Err(Error::Empty));
        assert_eq!(Message::parse(&[0x40, 1]), Err(Error::NoStatus(0x40)));
        assert_eq!(Message::parse(&[0x90, 60]), Err(Error::Length { status: 0x90, expected: 3, got: 2 }));
        assert_eq!(Message::parse(&[0x90, 60, 0x80]), Err(Error::DataOutOfRange(2)));
        assert_eq!(Message::parse(&[0xF0, 1, 2]), Err(Error::UnterminatedSysEx));
        assert_eq!(Message::parse(&[0xF0, 0x90, 0xF7]), Err(Error::DataOutOfRange(1)));
        assert_eq!(Message::parse(&[0xF4]), Err(Error::UndefinedStatus(0xF4)));
        assert_eq!(Message::parse(&[0xF7]), Err(Error::UndefinedStatus(0xF7)));
    }

    #[test]
    fn every_message_encodes_to_the_bytes_it_parsed_from() {
        let wire: &[&[u8]] = &[
            &[0x80, 1, 2],
            &[0x9F, 127, 0],
            &[0xA0, 3, 4],
            &[0xB7, 5, 6],
            &[0xC0, 7],
            &[0xD0, 8],
            &[0xE3, 0x12, 0x34],
            &[0xF0, 0x7E, 0xF7],
            &[0xF0, 0xF7],
            &[0xF1, 9],
            &[0xFE],
        ];
        for bytes in wire {
            assert_eq!(Message::parse(bytes).unwrap().encode().as_deref(), Ok(*bytes));
        }
    }

    #[test]
    fn encoding_refuses_fields_too_wide_for_the_wire() {
        assert_eq!(Message::NoteOn { channel: 16, note: 0, velocity: 0 }.encode(), Err(Error::ValueOutOfRange));
        assert_eq!(Message::NoteOn { channel: 0, note: 128, velocity: 0 }.encode(), Err(Error::ValueOutOfRange));
        assert_eq!(Message::PitchBend { channel: 0, value: 16384 }.encode(), Err(Error::ValueOutOfRange));
        assert_eq!(Message::SysEx(vec![0x80]).encode(), Err(Error::ValueOutOfRange));
        assert_eq!(Message::System { status: 0x90, data: vec![1, 2] }.encode(), Err(Error::UndefinedStatus(0x90)));
        assert_eq!(Message::System { status: 0xF0, data: vec![] }.encode(), Err(Error::UndefinedStatus(0xF0)));
        assert_eq!(
            Message::System { status: 0xF8, data: vec![1] }.encode(),
            Err(Error::Length { status: 0xF8, expected: 1, got: 2 })
        );
    }

    fn frame(bytes: &[u8]) -> Vec<Result<Message, Error>> {
        Framer::new().feed(bytes)
    }

    #[test]
    fn the_framer_runs_on_the_last_channel_status() {
        assert_eq!(
            frame(&[0xB0, 1, 10, 1, 11, 2, 12]),
            vec![
                Ok(Message::ControlChange { channel: 0, control: 1, value: 10 }),
                Ok(Message::ControlChange { channel: 0, control: 1, value: 11 }),
                Ok(Message::ControlChange { channel: 0, control: 2, value: 12 }),
            ]
        );
    }

    #[test]
    fn the_framer_passes_real_time_bytes_through_a_message() {
        assert_eq!(
            frame(&[0x90, 60, 0xF8, 100]),
            vec![
                Ok(Message::System { status: 0xF8, data: vec![] }),
                Ok(Message::NoteOn { channel: 0, note: 60, velocity: 100 })
            ]
        );
    }

    #[test]
    fn the_framer_collects_sysex_until_its_end() {
        assert_eq!(
            frame(&[0xF0, 1, 2, 3, 0xF7, 0xC1, 4]),
            vec![Ok(Message::SysEx(vec![1, 2, 3])), Ok(Message::ProgramChange { channel: 1, program: 4 })]
        );
    }

    #[test]
    fn the_framer_reports_a_cut_message_and_a_stray_data_byte() {
        assert_eq!(
            frame(&[0x05, 0x90, 60, 0xB0, 1, 2]),
            vec![
                Err(Error::NoStatus(0x05)),
                Err(Error::Length { status: 0x90, expected: 3, got: 2 }),
                Ok(Message::ControlChange { channel: 0, control: 1, value: 2 }),
            ]
        );
    }

    #[test]
    fn a_one_byte_message_that_cuts_another_still_arrives() {
        assert_eq!(
            frame(&[0x90, 60, 0xF6]),
            vec![
                Err(Error::Length { status: 0x90, expected: 3, got: 2 }),
                Ok(Message::System { status: 0xF6, data: vec![] })
            ]
        );
    }

    #[test]
    fn a_system_common_message_cancels_running_status() {
        assert_eq!(
            frame(&[0x90, 60, 1, 0xF6, 61]),
            vec![
                Ok(Message::NoteOn { channel: 0, note: 60, velocity: 1 }),
                Ok(Message::System { status: 0xF6, data: vec![] }),
                Err(Error::NoStatus(61)),
            ]
        );
    }
}
