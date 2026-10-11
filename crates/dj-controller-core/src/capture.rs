// Concern: a captured host-to-device frame list, decoded for a model, grouped and selected for replay | Non-concern: sending (transports), what a frame means (docs) | IO: (frame list, model) -> frames
//! The file is `[[endpoint, hex], ...]`, endpoint written `ep<N>`, one frame per USB transfer
//! in capture order, as LOU-INIT lays it out (docs/research/flx10-sources.md).

use crate::midi::Message;
use crate::model::{Address, Carries, Model};
use crate::usb_midi;

/// What a frame is, by what the model makes of it (docs/research/flx10-connect.md).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Group {
    /// MIDI carrying SysEx, which the official lists never document.
    Sysex,
    /// MIDI whose every message addresses a listed output.
    Outputs,
    /// MIDI with a message where no output is listed.
    Unlisted,
    /// A report on the model's HID interface.
    Hid,
}

impl Group {
    const ALL: [(Group, &'static str); 4] =
        [(Group::Sysex, "sysex"), (Group::Outputs, "outputs"), (Group::Unlisted, "unlisted"), (Group::Hid, "hid")];

    pub fn name(self) -> &'static str {
        Group::ALL.iter().find(|(g, _)| *g == self).map(|(_, n)| *n).expect("every group is named")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Payload {
    /// The whole messages the frame completes.
    Midi(Vec<Message>),
    /// One report, zero-padded to the interface's output size.
    Report(Vec<u8>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    /// 0-based, in capture order.
    pub index: usize,
    pub endpoint: u8,
    pub group: Group,
    pub payload: Payload,
}

/// Every frame of `json`, each on an endpoint the model's `usb.out-endpoints` names.
pub fn parse(model: &Model, json: &str) -> Result<Vec<Frame>, String> {
    let file: Vec<(String, String)> = serde_json::from_str(json).map_err(|e| format!("frame list: {e}"))?;
    let mut midi = usb_midi::Decoder::new();
    file.iter()
        .enumerate()
        .map(|(index, (name, hex))| {
            let at = |e: String| format!("frame {index}: {e}");
            let endpoint = name
                .strip_prefix("ep")
                .and_then(|n| n.parse::<u8>().ok())
                .ok_or_else(|| at(format!("{name:?} is not ep<N>")))?;
            let bytes = bytes(hex).map_err(at)?;
            let payload = match model.out_endpoints.get(&endpoint) {
                Some(Carries::Midi) => Payload::Midi(messages(&mut midi, &bytes).map_err(at)?),
                Some(Carries::Hid) => Payload::Report(report(model, bytes).map_err(at)?),
                None => return Err(at(format!("{} names no OUT endpoint {endpoint}", model.name))),
            };
            Ok(Frame { index, endpoint, group: group(model, &payload), payload })
        })
        .collect()
}

fn bytes(hex: &str) -> Result<Vec<u8>, String> {
    if !hex.len().is_multiple_of(2) {
        return Err(format!("{hex:?} has an odd number of hex digits"));
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|e| format!("{hex:?}: {e}")))
        .collect()
}

/// The replay writes to the port's one cable, so only cable 0 is taken.
fn messages(decoder: &mut usb_midi::Decoder, transfer: &[u8]) -> Result<Vec<Message>, String> {
    decoder
        .feed(transfer)?
        .into_iter()
        .map(|(cable, message)| match cable {
            0 => Ok(message),
            _ => Err(format!("cable {cable}: only cable 0 is replayed")),
        })
        .collect()
}

fn report(model: &Model, mut bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let size = model.hid.as_ref().map(|h| h.output).expect("a model with an hid endpoint has an hid interface");
    if bytes.len() > size {
        return Err(format!("a {} byte report is over the interface's {size}", bytes.len()));
    }
    bytes.resize(size, 0);
    Ok(bytes)
}

fn group(model: &Model, payload: &Payload) -> Group {
    let Payload::Midi(messages) = payload else { return Group::Hid };
    if messages.iter().any(|m| matches!(m, Message::SysEx(_))) {
        Group::Sysex
    } else if messages.iter().all(|m| Address::of(m).is_some_and(|(a, _)| model.output_at(a).is_some())) {
        Group::Outputs
    } else {
        Group::Unlisted
    }
}

/// The frames `spec` names, in capture order: comma-separated frame indices, `a-b` ranges
/// (inclusive) and group names.
pub fn select<'a>(frames: &'a [Frame], spec: &str) -> Result<Vec<&'a Frame>, String> {
    let mut wanted = vec![false; frames.len()];
    for term in spec.split(',') {
        let index = |s: &str| {
            s.parse::<usize>()
                .ok()
                .filter(|&i| i < frames.len())
                .ok_or(format!("{term:?} is no frame index 0 to {}, range or group", frames.len().saturating_sub(1)))
        };
        if let Some((group, _)) = Group::ALL.iter().find(|(_, name)| *name == term) {
            frames.iter().filter(|f| f.group == *group).for_each(|f| wanted[f.index] = true);
        } else if let Some((from, to)) = term.split_once('-') {
            let (from, to) = (index(from)?, index(to)?);
            if from > to {
                return Err(format!("{term:?} runs backwards"));
            }
            wanted[from..=to].iter_mut().for_each(|w| *w = true);
        } else {
            wanted[index(term)?] = true;
        }
    }
    Ok(frames.iter().filter(|f| wanted[f.index]).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hid::Via;

    const CONNECT: &str = include_str!("../fixtures/ddj-flx10-rekordbox-connect.json");

    fn flx10() -> &'static Model {
        Model::named("DDJ-FLX10").unwrap()
    }

    fn frames() -> Vec<Frame> {
        parse(flx10(), CONNECT).unwrap()
    }

    fn count(group: Group) -> usize {
        frames().iter().filter(|f| f.group == group).count()
    }

    #[test]
    fn every_frame_of_rekordboxs_connect_decodes_to_one_message_or_one_report() {
        let frames = frames();
        assert_eq!(frames.len(), 324);
        for frame in &frames[..323] {
            assert!(matches!(&frame.payload, Payload::Midi(m) if m.len() == 1), "frame {}", frame.index);
            assert_eq!(frame.endpoint, 3);
        }
        assert_eq!((frames[323].endpoint, frames[323].group), (5, Group::Hid));
    }

    #[test]
    fn the_groups_are_those_docs_research_flx10_connect_md_counts() {
        assert_eq!(
            (count(Group::Sysex), count(Group::Outputs), count(Group::Unlisted), count(Group::Hid)),
            (26, 253, 44, 1)
        );
    }

    #[test]
    fn its_sysex_are_the_handshake_steps_messages_and_its_report_the_init_step() {
        let hid = flx10().hid.as_ref().unwrap();
        let sent = |f: &Frame| match &f.payload {
            Payload::Midi(m) => m[0].encode().unwrap(),
            Payload::Report(r) => r.clone(),
        };
        let mut distinct: Vec<Vec<u8>> = Vec::new();
        for frame in frames().iter().filter(|f| f.group == Group::Sysex) {
            if !distinct.contains(&sent(frame)) {
                distinct.push(sent(frame));
            }
        }
        let handshake = hid.step("handshake").unwrap();
        assert_eq!(handshake.via, Via::Midi);
        assert_eq!(distinct, handshake.messages);
        assert_eq!(vec![sent(&frames()[323])], hid.step("init").unwrap().messages);
    }

    #[test]
    fn a_selection_unions_indices_ranges_and_groups_in_capture_order() {
        let frames = frames();
        let picked: Vec<usize> = select(&frames, "hid,4-5,1,0").unwrap().iter().map(|f| f.index).collect();
        assert_eq!(picked, [0, 1, 4, 5, 323]);
        assert_eq!(select(&frames, "sysex").unwrap().len(), 26);
        for bad in ["324", "5-4", "x", "", "1-"] {
            assert!(select(&frames, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_frame_on_an_endpoint_the_model_does_not_name_is_refused() {
        assert!(parse(flx10(), r#"[["ep4", "09900b00"]]"#).is_err());
        assert!(parse(flx10(), r#"[["ep3", "09900b"]]"#).is_err());
        assert!(parse(flx10(), r#"[["ep5", "00"]]"#).is_ok());
    }
}
