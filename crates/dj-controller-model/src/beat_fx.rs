// Concern: a model file's Beat FX display: the SysEx writing its effect name, beat text and BPM, encoded as rekordbox's were captured | Non-concern: sending (the core) | IO: (text, BPM) -> Message
//! Layouts decoded from captures, never seen drawn by a unit (docs/research/flx10-beat-fx-display.md).

use std::fmt;

use serde::Deserialize;

use crate::midi::Message;

/// A model file's `beat-fx-display`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BeatFxDisplay {
    pub source: String,
    pub observed: Option<String>,
    pub name: Text,
    pub beat: Text,
    pub bpm: Bpm,
}

/// `characters`: those a source shows the display drawing.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Text {
    #[serde(deserialize_with = "opening")]
    pub opens: Vec<u8>,
    pub length: usize,
    pub characters: String,
    pub source: String,
}

/// `range` in hundredths of a BPM.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bpm {
    #[serde(deserialize_with = "opening")]
    pub opens: Vec<u8>,
    #[serde(deserialize_with = "data")]
    pub tail: Vec<u8>,
    pub range: [u32; 2],
    pub source: String,
}

fn hex<E: serde::de::Error>(text: &str) -> Result<Vec<u8>, E> {
    text.split(' ')
        .map(|b| u8::from_str_radix(b, 16))
        .collect::<Result<_, _>>()
        .map_err(|e| E::custom(format!("{text:?}: {e}")))
}

fn data<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
    let text = String::deserialize(d)?;
    let bytes: Vec<u8> = hex(&text)?;
    if bytes.iter().any(|b| *b > 0x7F) {
        return Err(serde::de::Error::custom(format!("{text:?} holds a byte over 7F")));
    }
    Ok(bytes)
}

/// Kept without its `F0`.
fn opening<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
    let text = String::deserialize(d)?;
    let bytes: Vec<u8> = hex(&text)?;
    match bytes.split_first() {
        Some((0xF0, body)) if body.iter().all(|b| *b <= 0x7F) => Ok(body.to_vec()),
        _ => Err(serde::de::Error::custom(format!("{text:?} is not F0 and data bytes"))),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Field {
    Name,
    Beat,
    Bpm,
}

impl fmt::Display for Field {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Field::Name => "the Beat FX display's name",
            Field::Beat => "the Beat FX display's beat text",
            Field::Bpm => "the Beat FX display's BPM",
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Refusal {
    Empty { field: Field },
    TooLong { field: Field, characters: usize, most: usize },
    Character { field: Field, character: char, at: usize, takes: String },
    NotHundredths { bpm: f64 },
    OutOfRange { bpm: f64, range: [f64; 2] },
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Refusal::Empty { field } => write!(f, "{field} takes no empty text: no capture holds one"),
            Refusal::TooLong { field, characters, most } => {
                write!(f, "{field} carries up to {most} characters, not {characters}")
            }
            Refusal::Character { field, character, at, takes } => write!(
                f,
                "{field} takes {takes:?} alone, the characters a capture or the manual shows on it, not {character:?} at {at}"
            ),
            Refusal::NotHundredths { bpm } => write!(f, "{}: {bpm} is no whole number of hundredths", Field::Bpm),
            Refusal::OutOfRange { bpm, range: [low, high] } => {
                write!(f, "{}: {bpm} is outside {low} to {high}", Field::Bpm)
            }
        }
    }
}

impl std::error::Error for Refusal {}

/// `bytes` as one bit stream cut into 7-bit bytes, least significant bit first, as frames 71 and
/// 72 of crates/dj-controller-core/fixtures/ddj-flx10-rekordbox-connect.json read as ASCII.
fn pack7(bytes: &[u8]) -> Vec<u8> {
    let (mut bits, mut held, mut out) = (0u32, 0, Vec::new());
    for &byte in bytes {
        bits |= u32::from(byte) << held;
        held += 8;
        while held >= 7 {
            out.push((bits & 0x7F) as u8);
            bits >>= 7;
            held -= 7;
        }
    }
    if held > 0 {
        out.push(bits as u8);
    }
    out
}

fn length(count: usize) -> [u8; 2] {
    [(count >> 7) as u8 & 0x7F, count as u8 & 0x7F]
}

impl Text {
    fn padded(&self, field: Field, text: &str) -> Result<Vec<u8>, Refusal> {
        let characters = text.chars().count();
        if characters == 0 {
            return Err(Refusal::Empty { field });
        }
        if characters > self.length {
            return Err(Refusal::TooLong { field, characters, most: self.length });
        }
        if let Some((at, character)) = text.chars().enumerate().find(|(_, c)| !self.characters.contains(*c)) {
            return Err(Refusal::Character { field, character, at, takes: self.characters.clone() });
        }
        let mut bytes = text.as_bytes().to_vec();
        bytes.resize(self.length, 0);
        Ok(bytes)
    }

    fn check(&self, field: &str) -> Result<(), String> {
        if self.length == 0 || self.characters.is_empty() {
            return Err(format!("beat-fx-display {field}: no length or no characters"));
        }
        match self.characters.chars().find(|c| !c.is_ascii_graphic() && *c != ' ') {
            Some(c) => Err(format!("beat-fx-display {field}: {c:?} is no printable ASCII character")),
            None => Ok(()),
        }
    }
}

const BPM_NIBBLES: u32 = 6;

impl BeatFxDisplay {
    pub fn check(&self) -> Result<(), String> {
        self.name.check("name")?;
        self.beat.check("beat")?;
        let [low, high] = self.bpm.range;
        if low > high || high >= 1 << (4 * BPM_NIBBLES) {
            return Err(format!("beat-fx-display bpm: range {low} to {high} is none {BPM_NIBBLES} hex digits carry"));
        }
        Ok(())
    }

    /// Frame 71 of the capture for "TRANS": the length of what follows (40), again (38), then a
    /// `00` of unknown meaning and the name, packed.
    pub fn name(&self, text: &str) -> Result<Message, Refusal> {
        let mut bytes = vec![0x00];
        bytes.extend(self.name.padded(Field::Name, text)?);
        let packed = pack7(&bytes);
        let mut body = self.name.opens.clone();
        body.extend(length(packed.len() + 2));
        body.extend(length(packed.len()));
        body.extend(packed);
        Ok(Message::SysEx(body))
    }

    /// Frame 72 of the capture for "1".
    pub fn beat(&self, text: &str) -> Result<Message, Refusal> {
        let mut body = self.beat.opens.clone();
        body.extend(pack7(&self.beat.padded(Field::Beat, text)?));
        Ok(Message::SysEx(body))
    }

    /// Frame 73 of the capture for 120.00: hundredths as hex digits, the highest first, one a byte.
    pub fn bpm(&self, bpm: f64) -> Result<Message, Refusal> {
        let hundredths = (bpm * 100.0).round();
        if !bpm.is_finite() || (bpm * 100.0 - hundredths).abs() > 1e-6 {
            return Err(Refusal::NotHundredths { bpm });
        }
        let [low, high] = self.bpm.range;
        if hundredths < f64::from(low) || hundredths > f64::from(high) {
            return Err(Refusal::OutOfRange { bpm, range: self.bpm_range() });
        }
        let value = hundredths as u32;
        let mut body = self.bpm.opens.clone();
        body.extend((0..BPM_NIBBLES).rev().map(|digit| (value >> (4 * digit)) as u8 & 0x0F));
        body.extend(&self.bpm.tail);
        Ok(Message::SysEx(body))
    }

    pub fn bpm_range(&self) -> [f64; 2] {
        self.bpm.range.map(|hundredths| f64::from(hundredths) / 100.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Model;

    fn display() -> &'static BeatFxDisplay {
        Model::named("DDJ-FLX10").unwrap().beat_fx_display.as_ref().unwrap()
    }

    fn bytes(message: Result<Message, Refusal>) -> Vec<u8> {
        message.unwrap().encode().unwrap()
    }

    fn hex(text: &str) -> Vec<u8> {
        text.split(' ').map(|b| u8::from_str_radix(b, 16).unwrap()).collect()
    }

    /// What follows the 11 opening bytes and, in a name, its 4 length bytes.
    fn payload(message: Result<Message, Refusal>, lengths: usize) -> Vec<u8> {
        bytes(message)[11 + lengths..].to_vec()
    }

    #[test]
    fn rekordboxs_connect_messages_are_what_trans_1_and_120_encode_to() {
        let handshake = &Model::named("DDJ-FLX10").unwrap().hid.as_ref().unwrap().step("handshake").unwrap().messages;
        assert_eq!(bytes(display().beat("1")), handshake[1]);
        assert_eq!(bytes(display().bpm(120.0)), handshake[2]);
        assert_eq!(bytes(display().name("TRANS")), handshake[3]);
    }

    #[test]
    fn a_name_of_several_words_is_the_blob_loui1979s_mapping_holds() {
        // LOU-JS l.928, `_SYSEX_RKBOX_MODE_CONFIG`, to an FLX10.
        let mut captured =
            hex("F0 00 40 05 00 00 04 01 00 00 0A 00 28 00 26 00 18 3D 3A 05 64 50 2A 54 40 14 1A 04 69 13");
        captured.extend([0; 23]);
        captured.push(0xF7);
        assert_eq!(bytes(display().name("LOW CUT ECHO")), captured);
    }

    #[test]
    fn the_texts_and_bpms_rekordbox_sent_a_ddj_1000_are_the_same_payloads() {
        // NT-1000 `PRELUDE` and `JOGSCREEN_ENABLE`, to a DDJ-1000, some listed short of their trailing 00s.
        let starts = |payload: Vec<u8>, listed: &str| assert_eq!(payload[..hex(listed).len()], hex(listed), "{listed}");
        starts(payload(display().name("ENIGMA JET"), 4), "00 0A 39 4A 74 28 53 20 20 14 15 22 05");
        starts(payload(display().name("REVERB"), 4), "00 24 15 32 55 48 14 21");
        starts(payload(display().beat("+4"), 0), "2B 68 00 00 00");
        starts(payload(display().beat("50%"), 0), "35 60 14 01 00");
        // NT-1000 l.183-187.
        for (bpm, digits) in [(145.0, "03 08 0A 04"), (140.0, "03 06 0B 00"), (150.0, "03 0A 09 08")] {
            assert_eq!(payload(display().bpm(bpm), 0)[2..6], hex(digits), "{bpm}");
        }
    }

    #[test]
    fn a_text_fills_its_field_and_no_more() {
        let longest = "ABCDEFGHIJLMNORSTUVWYABCDEFGHIJL";
        assert_eq!(bytes(display().name(longest)).len(), 54);
        assert_eq!(
            display().name(&format!("{longest}N")),
            Err(Refusal::TooLong { field: Field::Name, characters: 33, most: 32 })
        );
        assert_eq!(bytes(display().beat("-1/16")).len(), 18);
        assert_eq!(display().beat("+1/128"), Err(Refusal::TooLong { field: Field::Beat, characters: 6, most: 5 }));
    }

    #[test]
    fn a_text_no_source_shows_on_the_display_is_refused() {
        assert_eq!(display().name(""), Err(Refusal::Empty { field: Field::Name }));
        assert_eq!(display().beat(""), Err(Refusal::Empty { field: Field::Beat }));
        let takes = display().name.characters.clone();
        assert_eq!(
            display().name("Echo"),
            Err(Refusal::Character { field: Field::Name, character: 'c', at: 1, takes: takes.clone() })
        );
        assert_eq!(
            display().name("DÉLAI"),
            Err(Refusal::Character { field: Field::Name, character: 'É', at: 1, takes })
        );
        let refused = display().beat("1 4").unwrap_err();
        assert!(matches!(refused, Refusal::Character { field: Field::Beat, character: ' ', at: 1, .. }), "{refused}");
    }

    #[test]
    fn a_bpm_is_whole_hundredths_within_the_files_range() {
        assert_eq!(payload(display().bpm(87.5), 0), hex("00 00 02 02 02 0E 00 00 F7"));
        let [low, high] = display().bpm_range();
        assert!(display().bpm(low).is_ok() && display().bpm(high).is_ok());
        assert_eq!(display().bpm(120.005), Err(Refusal::NotHundredths { bpm: 120.005 }));
        assert!(matches!(display().bpm(f64::NAN), Err(Refusal::NotHundredths { .. })));
        assert_eq!(display().bpm(high + 0.01), Err(Refusal::OutOfRange { bpm: high + 0.01, range: [low, high] }));
        assert_eq!(display().bpm(-1.0), Err(Refusal::OutOfRange { bpm: -1.0, range: [low, high] }));
    }
}
