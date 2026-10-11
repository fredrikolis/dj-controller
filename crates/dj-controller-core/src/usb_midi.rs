// Concern: USB-MIDI 1.0 event packets, decoded into MIDI messages | Non-concern: what a message means (model), sending (transports) | IO: (packets) -> (cable, Message)
//! Packets and Code Index Numbers: USB Device Class Definition for MIDI Devices 1.0, §4, Table 4-1.

use crate::midi::{self, Message};

/// The MIDI bytes a Code Index Number carries; `None` for the reserved 0x0 and 0x1.
fn carried(cin: u8) -> Option<usize> {
    match cin {
        0x5 | 0xF => Some(1),
        0x2 | 0x6 | 0xC | 0xD => Some(2),
        0x3 | 0x4 | 0x7 | 0x8..=0xB | 0xE => Some(3),
        _ => None,
    }
}

/// Joins packets into whole messages, SysEx across packets and transfers.
#[derive(Debug, Default)]
pub struct Decoder {
    sysex: Vec<u8>,
}

impl Decoder {
    pub fn new() -> Decoder {
        Decoder::default()
    }

    /// Each message a transfer completes, with its cable; padding is ignored whatever its value.
    pub fn feed(&mut self, transfer: &[u8]) -> Result<Vec<(u8, Message)>, String> {
        if !transfer.len().is_multiple_of(4) {
            return Err(format!("{} bytes is not a whole number of 4-byte packets", transfer.len()));
        }
        let mut out = Vec::new();
        for (i, packet) in transfer.chunks(4).enumerate() {
            let at = |e: String| format!("packet {i}: {e}");
            let (cable, cin) = (packet[0] >> 4, packet[0] & 0x0F);
            let n = carried(cin).ok_or_else(|| at(format!("reserved code index number {cin:X}")))?;
            let bytes = &packet[1..=n];
            let whole = match cin {
                0x4 => {
                    if self.sysex.is_empty() && bytes[0] != 0xF0 {
                        return Err(at("a SysEx packet that neither starts nor continues one".into()));
                    }
                    self.sysex.extend_from_slice(bytes);
                    continue;
                }
                0x5..=0x7 if !self.sysex.is_empty() || bytes[0] == 0xF0 => {
                    self.sysex.extend_from_slice(bytes);
                    std::mem::take(&mut self.sysex)
                }
                _ => bytes.to_vec(),
            };
            let message = Message::parse(&whole).map_err(|e: midi::Error| at(format!("{e}")))?;
            out.push((cable, message));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(transfer: &[u8]) -> Result<Vec<(u8, Message)>, String> {
        Decoder::new().feed(transfer)
    }

    #[test]
    fn a_channel_message_is_the_three_bytes_after_its_header() {
        assert_eq!(
            decode(&[0x09, 0x90, 0x0B, 0x7F]),
            Ok(vec![(0, Message::NoteOn { channel: 0, note: 0x0B, velocity: 0x7F })])
        );
        assert_eq!(decode(&[0x1C, 0xC2, 0x05, 0x00]), Ok(vec![(1, Message::ProgramChange { channel: 2, program: 5 })]));
    }

    #[test]
    fn sysex_joins_its_packets_and_ignores_the_padding_after_its_end() {
        // Frame 76 of the rekordbox connect fixture, padded with a stale 49.
        let transfer = [
            0x04, 0xF0, 0x00, 0x40, 0x04, 0x05, 0x00, 0x00, 0x04, 0x04, 0x01, 0x00, 0x04, 0x11, 0x0F, 0x0F, 0x04, 0x0F,
            0x0F, 0x0F, 0x06, 0x0F, 0xF7, 0x49,
        ];
        let body = vec![0x00, 0x40, 0x05, 0x00, 0x00, 0x04, 0x01, 0x00, 0x11, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F];
        assert_eq!(decode(&transfer), Ok(vec![(0, Message::SysEx(body))]));
    }

    #[test]
    fn sysex_continues_across_transfers() {
        let mut decoder = Decoder::new();
        assert_eq!(decoder.feed(&[0x04, 0xF0, 0x7E, 0x01]), Ok(vec![]));
        assert_eq!(decoder.feed(&[0x05, 0xF7, 0, 0]), Ok(vec![(0, Message::SysEx(vec![0x7E, 0x01]))]));
    }

    #[test]
    fn a_one_byte_packet_outside_sysex_is_its_own_message() {
        assert_eq!(decode(&[0x0F, 0xF8, 0, 0]), Ok(vec![(0, Message::System { status: 0xF8, data: vec![] })]));
        assert_eq!(decode(&[0x05, 0xF6, 0, 0]), Ok(vec![(0, Message::System { status: 0xF6, data: vec![] })]));
    }

    #[test]
    fn what_fits_no_packet_is_refused() {
        assert!(decode(&[0x09, 0x90, 0x0B]).is_err());
        assert!(decode(&[0x01, 0x90, 0x0B, 0x7F]).is_err());
        assert!(decode(&[0x04, 0x00, 0x40, 0x05]).is_err());
        assert!(decode(&[0x09, 0x90, 0x0B, 0x80]).is_err());
    }
}
