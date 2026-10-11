// Concern: the vendor HID display reports the sources document | Non-concern: the interface's steps (dj-controller-model) | IO: (fields) -> report bytes
//! Experimental, unseen to draw; layouts and sources: docs/research/flx10-hid.md.

pub use dj_controller_model::steps::{Interface, Setup, Step, Via};

/// EP5 OUT, no report ids (docs/vision.md).
pub const REPORT: usize = 128;

/// Byte 0 for deck 1 to 4 [LOU-JOG; VZ-F].
fn deck_byte(deck: u8) -> Result<u8, String> {
    match deck {
        1..=4 => Ok(deck << 4),
        _ => Err(format!("deck {deck}: decks are 1 to 4")),
    }
}

/// `position` is in 1/128 s of audio [VZ-F; LOU-RELAY].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeckState {
    pub deck: u8,
    pub loaded: bool,
    pub bpm_tenths: u16,
    pub remaining_ms: u32,
    pub position: u32,
}

/// `xx 27`, which LOU-JOG saw render BPM and a playhead; every byte as LOU-RELAY `build_xx27`
/// places it. VZ-F disagrees on some (docs/research/flx10-hid.md).
pub fn deck_state(state: DeckState) -> Result<Vec<u8>, String> {
    let deck = deck_byte(state.deck)?;
    let mut report = vec![0; REPORT];
    report[..5].copy_from_slice(&[deck, 0x27, 0xB4, 0x80, 0x01]);
    report[20] = 0x0E;
    report[25] = 0x80;
    report[30] = 0x0D;
    // LOU-RELAY `SERATO_DECK_31`.
    report[31] = [0x02, 0x01, 0x04, 0x03][usize::from(state.deck - 1)];
    report[32] = 0xE0;
    report[33] = 0x01;
    if !state.loaded {
        report[29] = 0x80;
        return Ok(report);
    }
    report[29] = 0x92;
    let minutes = state.remaining_ms / 60_000;
    if minutes > 0xFF {
        return Err(format!("{} ms remaining: the minutes byte holds 255 at most", state.remaining_ms));
    }
    let bpm = state.bpm_tenths / 10;
    if bpm > 0xFF {
        return Err(format!("{}.{} BPM: the whole-BPM byte holds 255 at most", bpm, state.bpm_tenths % 10));
    }
    if state.position > 0xFF_FFFF {
        return Err(format!("position {}: 24 bits at most", state.position));
    }
    let ms = (state.remaining_ms % 1000) as u16;
    report[5..8].copy_from_slice(&state.position.to_be_bytes()[1..]);
    report[9] = minutes as u8;
    report[10] = (state.remaining_ms / 1000 % 60) as u8;
    report[11..13].copy_from_slice(&ms.to_le_bytes());
    report[13] = bpm as u8;
    report[14] = ((state.bpm_tenths % 10) as u8) << 4;
    Ok(report)
}

/// `00 3D <page> 00 05`: the display page by LOU-RELAY, rekordbox's heartbeat by VZ-F.
pub fn display_page(page: u8) -> Result<Vec<u8>, String> {
    if !(1..=5).contains(&page) {
        return Err(format!("page {page}: pages are 1 to 5"));
    }
    let mut report = vec![0; REPORT];
    report[..5].copy_from_slice(&[0x00, 0x3D, page, 0x00, 0x05]);
    Ok(report)
}

/// Unobserved: the firmware's own field length.
pub const LABEL_BYTES: usize = REPORT - 8;

/// `xx 39`, a pad-mode label laid out as LOU-JOG's one sample; bytes 2 to 6 are undecoded.
pub fn pad_label(deck: u8, text: &str) -> Result<Vec<u8>, String> {
    let deck = deck_byte(deck)?;
    if !text.bytes().all(|b| (0x20..0x7F).contains(&b)) {
        return Err(format!("{text:?}: printable ASCII only"));
    }
    if text.len() > LABEL_BYTES {
        return Err(format!("{text:?}: {LABEL_BYTES} bytes at most"));
    }
    let mut report = vec![0; REPORT];
    report[..7].copy_from_slice(&[deck, 0x39, 0x01, 0x00, 0x03, 0x00, 0x00]);
    report[7..7 + text.len()].copy_from_slice(text.as_bytes());
    Ok(report)
}

/// The waveform uploads LOU-JOG decodes, unverified on hardware.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Waveform {
    /// `xx 37`, the whole track.
    Overview,
    /// `xx 38`, scrolled by the firmware.
    Detail,
}

/// Reports of `deck, cmd, seq LE16 from 1, total LE16`, then payload; the payloads joined are
/// `[high, low, mid]` columns, the overview's after `80 01 01 00` [LOU-JOG].
pub fn waveform(deck: u8, kind: Waveform, columns: &[[u8; 3]]) -> Result<Vec<Vec<u8>>, String> {
    let deck = deck_byte(deck)?;
    let (command, head): (u8, &[u8]) = match kind {
        Waveform::Overview => (0x37, &[0x80, 0x01, 0x01, 0x00]),
        Waveform::Detail => (0x38, &[]),
    };
    let stream: Vec<u8> = head.iter().copied().chain(columns.iter().flatten().copied()).collect();
    let chunks: Vec<&[u8]> = stream.chunks(REPORT - 6).collect();
    let total = u16::try_from(chunks.len()).map_err(|_| format!("{} columns: over 65535 reports", columns.len()))?;
    Ok(chunks
        .iter()
        .zip(1u16..)
        .map(|(chunk, seq)| {
            let mut report = vec![0; REPORT];
            report[..2].copy_from_slice(&[deck, command]);
            report[2..4].copy_from_slice(&seq.to_le_bytes());
            report[4..6].copy_from_slice(&total.to_le_bytes());
            report[6..6 + chunk.len()].copy_from_slice(chunk);
            report
        })
        .collect())
}

/// A `xx D8` acknowledgement [VZ-F], no proof of drawing.
pub fn is_ack(report: &[u8]) -> bool {
    report.get(1) == Some(&0xD8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_hid_model_takes_the_reports_these_layouts_fill() {
        for hid in crate::model::models().iter().filter_map(|m| m.hid.as_ref()) {
            assert_eq!(hid.output, REPORT);
            let reports = hid.steps.iter().filter(|s| s.via == Via::Hid).flat_map(|s| &s.messages);
            assert!(reports.into_iter().all(|m| m.len() == REPORT));
        }
    }

    #[test]
    fn a_loaded_deck_state_places_time_bpm_and_position_where_lou_relay_does() {
        let state = DeckState { deck: 2, loaded: true, bpm_tenths: 1285, remaining_ms: 185_250, position: 0x012345 };
        let report = deck_state(state).unwrap();
        assert_eq!(&report[..8], [0x20, 0x27, 0xB4, 0x80, 0x01, 0x01, 0x23, 0x45]);
        assert_eq!(&report[9..15], [3, 5, 250, 0, 128, 0x50]);
        assert_eq!((report[29], report[31]), (0x92, 0x01));
        let empty = deck_state(DeckState { loaded: false, ..state }).unwrap();
        assert_eq!((empty[29], &empty[5..15]), (0x80, &[0; 10][..]));
    }

    #[test]
    fn a_deck_state_refuses_what_its_bytes_cannot_hold() {
        let state = DeckState { deck: 1, loaded: true, bpm_tenths: 1200, remaining_ms: 0, position: 0 };
        assert!(deck_state(DeckState { deck: 5, ..state }).is_err());
        assert!(deck_state(DeckState { bpm_tenths: 2560, ..state }).is_err());
        assert!(deck_state(DeckState { remaining_ms: 256 * 60_000, ..state }).is_err());
        assert!(deck_state(DeckState { position: 1 << 24, ..state }).is_err());
        assert!(deck_state(DeckState { bpm_tenths: 2559, remaining_ms: 256 * 60_000 - 1, ..state }).is_ok());
    }

    #[test]
    fn a_pad_label_follows_the_head_of_lou_jogs_sample_and_ends_in_00() {
        let report = pad_label(1, "AB").unwrap();
        assert_eq!(&report[..10], [0x10, 0x39, 0x01, 0x00, 0x03, 0x00, 0x00, b'A', b'B', 0x00]);
        assert!(pad_label(1, "É").is_err());
        assert!(pad_label(1, &"A".repeat(LABEL_BYTES + 1)).is_err());
        assert_eq!(pad_label(4, &"A".repeat(LABEL_BYTES)).unwrap()[REPORT - 1], 0);
    }

    #[test]
    fn a_display_page_is_one_to_five() {
        assert_eq!(&display_page(3).unwrap()[..6], [0x00, 0x3D, 0x03, 0x00, 0x05, 0x00]);
        assert!(display_page(0).is_err() && display_page(6).is_err());
    }

    #[test]
    fn an_overview_upload_counts_its_reports_as_lou_jogs_capture_did() {
        let columns: Vec<[u8; 3]> = (0..1186u32).map(|i| [i as u8, (i >> 8) as u8, 7]).collect();
        let reports = waveform(1, Waveform::Overview, &columns).unwrap();
        // LOU-JOG: about 1186 columns in 30 reports.
        assert_eq!(reports.len(), 30);
        assert_eq!(&reports[0][..10], [0x10, 0x37, 0x01, 0x00, 0x1E, 0x00, 0x80, 0x01, 0x01, 0x00]);
        assert_eq!(&reports[29][..6], [0x10, 0x37, 0x1E, 0x00, 0x1E, 0x00]);
        let stream: Vec<u8> = reports.iter().flat_map(|r| r[6..].to_vec()).collect();
        let flat: Vec<u8> = columns.into_iter().flatten().collect();
        assert_eq!(&stream[4..4 + flat.len()], flat);
    }

    #[test]
    fn a_detail_upload_has_no_head_and_a_16_bit_sequence() {
        // LOU-JOG: 609 0x38 reports carried 24766 columns.
        let reports = waveform(3, Waveform::Detail, &vec![[1, 2, 3]; 24766]).unwrap();
        assert_eq!(reports.len(), 609);
        assert_eq!(&reports[0][..9], [0x30, 0x38, 0x01, 0x00, 0x61, 0x02, 1, 2, 3]);
        assert_eq!(&reports[256][2..4], [0x01, 0x01]);
        assert!(waveform(0, Waveform::Detail, &[]).is_err());
    }

    #[test]
    fn an_ack_is_d8_in_the_second_byte() {
        assert!(is_ack(&[0x10, 0xD8, 0x00]));
        assert!(!is_ack(&[0xD8]) && !is_ack(&[]));
    }
}
