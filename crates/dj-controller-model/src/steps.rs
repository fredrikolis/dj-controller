// Concern: a model file's vendor HID interface and its named setup steps, each read and checked | Non-concern: the display reports (the core's hid.rs), sending | IO: (model file) -> Interface

use serde::Deserialize;

use crate::midi::Message;

/// A model file's `hid`.
#[derive(Debug, Deserialize)]
#[serde(try_from = "File")]
pub struct Interface {
    pub usage_page: u16,
    pub input: usize,
    pub output: usize,
    pub source: String,
    pub steps: Vec<Step>,
}

/// One setup step: its messages in order, once or every `every_ms`.
#[derive(Debug)]
pub struct Step {
    pub name: String,
    pub via: Via,
    pub messages: Vec<Vec<u8>>,
    pub every_ms: Option<u32>,
    pub source: String,
    pub observed: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Via {
    Midi,
    /// Reports, zero-padded to the output size.
    Hid,
    /// Control transfers OUT on endpoint 0 with no data stage, each message its 8-byte setup
    /// packet (USB 2.0 9.3), written in the file as `bmRequestType bRequest wValue wIndex`.
    Control,
}

/// The fields of a `control` step's setup packet; wLength is 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Setup {
    pub request_type: u8,
    pub request: u8,
    pub value: u16,
    pub index: u16,
}

impl Setup {
    pub fn of(packet: &[u8]) -> Setup {
        let word = |at: usize| u16::from_le_bytes([packet[at], packet[at + 1]]);
        Setup { request_type: packet[0], request: packet[1], value: word(2), index: word(4) }
    }

    pub fn packet(self) -> Vec<u8> {
        let [v, i] = [self.value.to_le_bytes(), self.index.to_le_bytes()];
        vec![self.request_type, self.request, v[0], v[1], i[0], i[1], 0, 0]
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
struct File {
    usage_page: String,
    input: usize,
    output: usize,
    source: String,
    steps: Vec<StepFile>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
struct StepFile {
    name: String,
    via: Via,
    messages: Vec<String>,
    every_ms: Option<u32>,
    source: String,
    observed: Option<String>,
}

impl TryFrom<File> for Interface {
    type Error = String;

    fn try_from(file: File) -> Result<Interface, String> {
        let usage_page = u16::from_str_radix(&file.usage_page, 16).map_err(|e| format!("usage-page: {e}"))?;
        let steps = file.steps.into_iter().map(|s| step(s, file.output)).collect::<Result<Vec<_>, _>>()?;
        Ok(Interface { usage_page, input: file.input, output: file.output, source: file.source, steps })
    }
}

fn step(file: StepFile, output: usize) -> Result<Step, String> {
    let at = |e: String| format!("hid step {}: {e}", file.name);
    let mut messages = Vec::new();
    if file.via == Via::Control && file.every_ms.is_some() {
        return Err(at(
            "a control step is sent once: repeated ep0 traffic can wedge the device (flx10-displays.md)".into()
        ));
    }
    for text in &file.messages {
        if file.via == Via::Control {
            messages.push(setup(text).map_err(at)?.packet());
            continue;
        }
        let mut bytes = hex(text).map_err(at)?;
        match file.via {
            Via::Midi => {
                Message::parse(&bytes).map_err(|e| at(format!("{text:?} is not one MIDI message: {e}")))?;
            }
            Via::Hid if bytes.len() > output => return Err(at(format!("{text:?} is over {output} bytes"))),
            Via::Hid => bytes.resize(output, 0),
            Via::Control => unreachable!("parsed above"),
        }
        messages.push(bytes);
    }
    if messages.is_empty() {
        return Err(at("no messages".into()));
    }
    let StepFile { name, via, every_ms, source, observed, .. } = file;
    Ok(Step { name, via, messages, every_ms, source, observed })
}

/// `bmRequestType bRequest wValue wIndex` in hex, direction OUT.
fn setup(text: &str) -> Result<Setup, String> {
    let fields: Vec<&str> = text.split(' ').collect();
    let [request_type, request, value, index] = fields[..] else {
        return Err(format!("{text:?} is not bmRequestType bRequest wValue wIndex"));
    };
    let field = |f: &str, digits| {
        (f.len() == digits)
            .then(|| u16::from_str_radix(f, 16).ok())
            .flatten()
            .ok_or(format!("{text:?}: {f:?} is not {digits} hex digits"))
    };
    let setup = Setup {
        request_type: field(request_type, 2)? as u8,
        request: field(request, 2)? as u8,
        value: field(value, 4)?,
        index: field(index, 4)?,
    };
    if setup.request_type & 0x80 != 0 {
        return Err(format!("{text:?}: bmRequestType bit 7 set, a device-to-host transfer"));
    }
    Ok(setup)
}

fn hex(text: &str) -> Result<Vec<u8>, String> {
    text.split(' ').map(|b| u8::from_str_radix(b, 16).map_err(|e| format!("{text:?}: {e}"))).collect()
}

impl Interface {
    pub fn step(&self, name: &str) -> Option<&Step> {
        self.steps.iter().find(|s| s.name == name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_step_refuses_what_is_not_one_message_or_overflows_the_report() {
        let parse = |via: &str, message: &str| {
            let text = format!(
                r#"{{"usage-page": "FFA0", "input": 64, "output": 4, "source": "", "steps": [{{"name": "s", "via": "{via}", "messages": ["{message}"], "source": ""}}]}}"#
            );
            serde_json::from_str::<Interface>(&text)
        };
        assert!(parse("midi", "F0 01 F7").is_ok());
        assert_eq!(
            parse("control", "40 03 0100 C028").unwrap().steps[0].messages[0],
            [0x40, 3, 0, 1, 0x28, 0xC0, 0, 0]
        );
        assert_eq!(parse("hid", "01 02").unwrap().steps[0].messages[0], [1, 2, 0, 0]);
        for (via, bad) in [("midi", "F0 01"), ("midi", "90 0B 7F 90 0B 00"), ("hid", "01 02 03 04 05"), ("hid", "0G")]
            .into_iter()
            .chain([("control", "C0 03 0100 C028"), ("control", "40 03 01 00 C0 28"), ("control", "40 03 100 C028")])
        {
            assert!(parse(via, bad).is_err(), "{via} {bad}");
        }
    }

    #[test]
    fn a_setup_packet_reads_back_its_fields() {
        let setup = Setup { request_type: 0x40, request: 0x03, value: 0x0200, index: 0xC013 };
        assert_eq!(Setup::of(&setup.packet()), setup);
    }

    #[test]
    fn a_control_step_is_never_repeated() {
        let text = r#"{"usage-page": "FFA0", "input": 64, "output": 4, "source": "", "steps": [{"name": "s", "via": "control", "messages": ["40 03 0100 C028"], "every-ms": 200, "source": ""}]}"#;
        assert!(serde_json::from_str::<Interface>(text).is_err());
    }
}
