// Concern: each controller model as its data file states it: identity, each control's address, kind, source | Non-concern: decoding (decode), encoding outputs (output) | IO: (models/*.json) -> Model
//! A model is one JSON file under `crates/dj-controller-model/models/`, embedded at build time; the format is
//! docs/research/model-format.md.

use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::midi::Message;
use crate::steps::Interface;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Kind {
    Note,
    Cc,
}

/// A Note On or Control Change address, written as its status and data 1 bytes: `"90 0B"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Address {
    pub kind: Kind,
    /// 0-based.
    pub channel: u8,
    pub number: u8,
}

impl Address {
    /// The address and value of a Note On or CC, the only messages the official lists document.
    pub fn of(message: &Message) -> Option<(Address, u8)> {
        match *message {
            Message::NoteOn { channel, note, velocity } => {
                Some((Address { kind: Kind::Note, channel, number: note }, velocity))
            }
            Message::ControlChange { channel, control, value } => {
                Some((Address { kind: Kind::Cc, channel, number: control }, value))
            }
            _ => None,
        }
    }

    pub fn message(self, value: u8) -> Message {
        let Address { kind, channel, number } = self;
        match kind {
            Kind::Note => Message::NoteOn { channel, note: number, velocity: value },
            Kind::Cc => Message::ControlChange { channel, control: number, value },
        }
    }
}

impl fmt::Display for Address {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let status = if self.kind == Kind::Note { 0x90 } else { 0xB0 };
        write!(f, "{:02X} {:02X}", status | self.channel, self.number)
    }
}

impl TryFrom<String> for Address {
    type Error = String;

    fn try_from(text: String) -> Result<Address, String> {
        let bytes: Vec<u8> = text
            .split(' ')
            .map(|b| u8::from_str_radix(b, 16))
            .collect::<Result<_, _>>()
            .map_err(|e| format!("{text:?}: {e}"))?;
        let [status, number] = bytes[..] else { return Err(format!("{text:?} is not a status and a data byte")) };
        let kind = match status & 0xF0 {
            0x90 => Kind::Note,
            0xB0 => Kind::Cc,
            _ => return Err(format!("{text:?} is neither a Note On (9n) nor a CC (Bn)")),
        };
        if number > 0x7F {
            return Err(format!("{text:?}: data byte over 7F"));
        }
        Ok(Address { kind, channel: status & 0x0F, number })
    }
}

impl<'de> Deserialize<'de> for Address {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Address, D::Error> {
        Address::try_from(String::deserialize(d)?).map_err(serde::de::Error::custom)
    }
}

/// What a control sends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Input {
    Button,
    /// One position of a switch, or a state the device reports.
    Switch,
    Absolute,
    Relative,
    Pad,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputKind {
    Led,
    Colour,
    Value,
}

impl OutputKind {
    pub fn name(self) -> &'static str {
        match self {
            OutputKind::Led => "led",
            OutputKind::Colour => "colour",
            OutputKind::Value => "value",
        }
    }
}

/// One entry of a model file's `controls`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Control {
    pub control: String,
    #[serde(default)]
    pub layer: String,
    #[serde(rename = "in")]
    pub input: Option<Input>,
    #[serde(rename = "out")]
    pub output: Option<OutputKind>,
    pub midi: Address,
    /// The CC carrying a 14-bit value's low 7 bits; `midi` carries the high 7.
    pub lsb: Option<Address>,
    pub centre: Option<u8>,
    pub range: Option<[u16; 2]>,
    #[serde(default)]
    pub values: Vec<u16>,
    #[serde(default = "listed")]
    pub listed: bool,
    pub source: String,
    pub observed: Option<String>,
    /// How a unit was seen to show a `value` output, cited in `observed`.
    pub shows: Option<Shows>,
    /// What each value of a `value` output's range stands for, from its low end, as `source` states.
    #[serde(default)]
    pub labels: Vec<String>,
    /// A relative input's ticks a revolution, as `observed` tells how it was measured.
    pub revolution: Option<Revolution>,
    /// The fewest ticks one report of a relative input was seen to carry, cited in `observed`:
    /// slower motion reports nothing.
    #[serde(rename = "least-step")]
    pub least_step: Option<u8>,
    /// Set where the firmware was seen to light this control's LED itself: what was seen. What
    /// the device shows there is then not what the host last told it, if the list gives an output.
    pub firmware: Option<String>,
    /// The bank a press of this row makes its owner show, as the source states.
    pub selects: Option<Selects>,
}

/// A bank's layer words, a pad mode and maybe a page, and where the device is said to show it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selects {
    pub bank: String,
    pub source: String,
}

/// A relative input's ticks one revolution: `ticks`, and what the measured `laps` summed, least to most.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Revolution {
    pub ticks: u32,
    pub laps: [u32; 2],
}

/// A value shown as `value / divide + add`, with `decimals` digits after the point and `unit`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Shows {
    pub divide: u16,
    #[serde(default)]
    pub add: i32,
    #[serde(default)]
    pub decimals: u8,
    #[serde(default)]
    pub unit: String,
}

impl Shows {
    /// `value` as the unit shows it: `1000` as `0.00%` for `/10 - 100`, two decimals, `%`.
    pub fn text(&self, value: u16) -> String {
        format!("{:.*}{}", usize::from(self.decimals), self.shown(value), self.unit)
    }

    /// `value` as the number the unit shows: `1000` as `0.0` for `/10 - 100`.
    pub fn shown(&self, value: u16) -> f64 {
        f64::from(value) / f64::from(self.divide) + f64::from(self.add)
    }

    /// The value a unit shows as `shown`: the inverse of [`Shows::shown`], where it is a whole number.
    pub fn raw(&self, shown: f64) -> Option<f64> {
        let raw = (shown - f64::from(self.add)) * f64::from(self.divide);
        let whole = raw.round();
        ((raw - whole).abs() < 1e-6).then_some(whole)
    }
}

fn listed() -> bool {
    true
}

impl Control {
    /// The control and its layer as one name: `deck1.play-pause (shift)`.
    pub fn name(&self) -> String {
        if self.layer.is_empty() { self.control.clone() } else { format!("{} ({})", self.control, self.layer) }
    }

    /// Whether a `value` output admits `v`: within its range, or one of its values.
    pub fn admits(&self, v: u16) -> bool {
        let max = if self.lsb.is_some() { 0x3FFF } else { 0x7F };
        v <= max && (self.range.is_some_and(|[lo, hi]| (lo..=hi).contains(&v)) || self.values.contains(&v))
    }

    fn check(&self) -> Result<(), String> {
        let path = |s: &str| {
            !s.is_empty()
                && s.split('.').all(|p| {
                    !p.is_empty() && p.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
                })
        };
        if !path(&self.control) {
            return Err("control is not a dotted lowercase path".into());
        }
        if !self.layer.is_empty() && !self.layer.split(' ').all(|w| path(w) && !w.contains('.')) {
            return Err("layer is not lowercase words".into());
        }
        if self.input.is_none() && self.output.is_none() {
            return Err("neither in nor out".into());
        }
        if (self.input == Some(Input::Relative)) != self.centre.is_some() {
            return Err("centre belongs to a relative input, and only there".into());
        }
        if self.centre.is_some_and(|c| c > 0x7F) {
            return Err("centre over 7F".into());
        }
        let wide =
            matches!(self.input, Some(Input::Absolute) | None) && matches!(self.output, Some(OutputKind::Value) | None);
        if self.lsb.is_some_and(|lsb| !wide || lsb.kind != Kind::Cc || self.midi.kind != Kind::Cc) {
            return Err("lsb belongs to a CC absolute input or value output".into());
        }
        let value = self.output == Some(OutputKind::Value);
        if value != (self.range.is_some() || !self.values.is_empty()) {
            return Err("range and values belong to a value output, which needs one".into());
        }
        if self.shows.as_ref().is_some_and(|s| !value || s.divide == 0 || self.observed.is_none()) {
            return Err("shows belongs to a value output, divides by more than 0 and cites observed".into());
        }
        let counted = self.range.map(|[lo, hi]| usize::from(hi.saturating_sub(lo)) + 1);
        if !self.labels.is_empty() && (self.shows.is_some() || counted != Some(self.labels.len())) {
            return Err("labels belong to a value output with a range and no shows, one for each value".into());
        }
        let relative = self.input == Some(Input::Relative) && self.observed.is_some();
        if self.revolution.is_some_and(|r| !relative || r.laps[0] == 0 || !(r.laps[0]..=r.laps[1]).contains(&r.ticks)) {
            return Err("revolution belongs to a relative input, cites observed and lies within its laps".into());
        }
        if self.least_step.is_some_and(|n| !relative || n == 0) {
            return Err("least-step belongs to a relative input, cites observed and is more than 0".into());
        }
        if self.selects.is_some() && self.input != Some(Input::Button) {
            return Err("selects belongs to a button".into());
        }
        Ok(())
    }
}

/// Which part of a control's value an address carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Part {
    Whole,
    Msb,
    Lsb,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    model: String,
    usb: Usb,
    hardware: String,
    sources: BTreeMap<String, String>,
    #[serde(rename = "state-request")]
    state_request: Option<StateRequest>,
    hid: Option<Interface>,
    palette: Option<Palette>,
    #[serde(rename = "start-bank")]
    start_bank: Option<StartBank>,
    controls: Vec<Control>,
}

/// The bank each owner of pad modes is taken to show when a session starts, where the device
/// reports none: a layer of a pad mode and, where that mode has pages, a page.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StartBank {
    pub layer: String,
    pub source: String,
    pub observed: Option<String>,
}

/// A model file's `palette`: what each colour number shows, where a source measured it.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Palette {
    pub source: String,
    pub colours: Vec<Colour>,
}

/// The colour `numbers`, lowest and highest, show, written `number` or `numbers` in the file;
/// `rgb` `#rrggbb` where known, `hue` in degrees where measured.
#[derive(Debug, Deserialize, Serialize)]
#[serde(try_from = "ColourFile")]
pub struct Colour {
    pub numbers: [u8; 2],
    pub name: String,
    pub rgb: Option<String>,
    pub hue: Option<u16>,
    pub source: String,
    pub verified: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ColourFile {
    number: Option<u8>,
    numbers: Option<[u8; 2]>,
    name: String,
    rgb: Option<String>,
    hue: Option<u16>,
    source: String,
    verified: bool,
}

impl TryFrom<ColourFile> for Colour {
    type Error = String;

    fn try_from(file: ColourFile) -> Result<Colour, String> {
        let at = |e: &str| format!("palette colour {}: {e}", file.name);
        let numbers = match (file.number, file.numbers) {
            (Some(n), None) => [n, n],
            (None, Some([from, to])) if from <= to => [from, to],
            _ => return Err(at("one number, or numbers [from, to] in order")),
        };
        if numbers[1] > 0x7F {
            return Err(at("numbers are 0 to 127"));
        }
        if file.source.is_empty() {
            return Err(at("no source"));
        }
        let hex = |c: &str| c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|d| d.is_ascii_hexdigit());
        if file.rgb.as_deref().is_some_and(|c| !hex(c)) {
            return Err(at("rgb is #rrggbb"));
        }
        let ColourFile { name, rgb, hue, source, verified, .. } = file;
        Ok(Colour { numbers, name, rgb, hue, source, verified })
    }
}

impl Palette {
    /// The colour number `number` shows, if the palette names it.
    pub fn colour(&self, number: u8) -> Option<&Colour> {
        self.colours.iter().find(|c| (c.numbers[0]..=c.numbers[1]).contains(&number))
    }

    fn check(&self) -> Result<(), String> {
        for number in 0..=0x7F {
            if self.colours.iter().filter(|c| (c.numbers[0]..=c.numbers[1]).contains(&number)).count() > 1 {
                return Err(format!("palette: colour number {number} twice"));
            }
        }
        Ok(())
    }
}

/// One message that makes the device report every control's current position as ordinary input.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateRequest {
    #[serde(deserialize_with = "message")]
    pub bytes: Vec<u8>,
    pub source: String,
    pub observed: Option<String>,
}

/// A `hid` endpoint needs the file's `hid`.
fn endpoints(file: &BTreeMap<String, Carries>, hid: bool) -> Result<BTreeMap<u8, Carries>, String> {
    let mut out = BTreeMap::new();
    for (key, &carries) in file {
        let number = u8::from_str_radix(key, 16)
            .ok()
            .filter(|n| (1..=15).contains(n))
            .ok_or(format!("out-endpoints: {key:?} is not an endpoint number 01 to 0F"))?;
        if carries == Carries::Hid && !hid {
            return Err(format!("out-endpoints: {key} carries hid, but the file has no hid"));
        }
        out.insert(number, carries);
    }
    Ok(out)
}

/// Hex bytes that must make exactly one whole MIDI message.
fn message<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
    let text = String::deserialize(d)?;
    let bytes: Vec<u8> = text
        .split(' ')
        .map(|b| u8::from_str_radix(b, 16))
        .collect::<Result<_, _>>()
        .map_err(|e| serde::de::Error::custom(format!("{text:?}: {e}")))?;
    Message::parse(&bytes).map_err(|e| serde::de::Error::custom(format!("{text:?} is not one MIDI message: {e}")))?;
    Ok(bytes)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Usb {
    vendor: String,
    product: String,
    source: String,
    #[serde(default, rename = "out-endpoints")]
    out_endpoints: BTreeMap<String, Carries>,
}

/// What a host-to-device endpoint carries (`usb.out-endpoints`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Carries {
    /// USB-MIDI event packets (`crate::usb_midi`).
    Midi,
    /// Reports of the model's `hid` interface.
    Hid,
}

#[derive(Debug)]
pub struct Model {
    pub name: String,
    pub usb_vendor: u16,
    pub usb_product: u16,
    pub usb_source: String,
    pub out_endpoints: BTreeMap<u8, Carries>,
    pub hardware: String,
    pub sources: BTreeMap<String, String>,
    pub state_request: Option<StateRequest>,
    /// The vendor HID interface and its setup steps, where the sources describe one.
    pub hid: Option<Interface>,
    pub palette: Option<Palette>,
    pub start_bank: Option<StartBank>,
    controls: Vec<Control>,
    inputs: HashMap<Address, (usize, Part)>,
    outputs: HashMap<Address, (usize, Part)>,
    names: HashMap<(String, String), usize>,
}

impl PartialEq for Model {
    fn eq(&self, other: &Model) -> bool {
        self.name == other.name
    }
}

/// Every model file, read once; one that fails its checks panics, as the tests catch first.
pub fn models() -> &'static [Model] {
    static MODELS: OnceLock<Vec<Model>> = OnceLock::new();
    MODELS.get_or_init(|| FILES.iter().map(|text| Model::parse(text).unwrap_or_else(|e| panic!("{e}"))).collect())
}

const FILES: &[&str] = include!(concat!(env!("OUT_DIR"), "/models.rs"));

impl Model {
    /// Reads and checks one model file: every entry well formed, no two sharing a name or an address.
    pub fn parse(text: &str) -> Result<Model, String> {
        let file: File = serde_json::from_str(text).map_err(|e| format!("model file: {e}"))?;
        let at = |e: String| format!("{}: {e}", file.model);
        let hex = |s: &str| u16::from_str_radix(s, 16).map_err(|e| at(format!("usb id {s:?}: {e}")));
        let mut model = Model {
            name: file.model.clone(),
            usb_vendor: hex(&file.usb.vendor)?,
            usb_product: hex(&file.usb.product)?,
            usb_source: file.usb.source,
            out_endpoints: endpoints(&file.usb.out_endpoints, file.hid.is_some()).map_err(at)?,
            hardware: file.hardware,
            sources: file.sources,
            state_request: file.state_request,
            hid: file.hid,
            palette: file.palette,
            start_bank: file.start_bank,
            controls: file.controls,
            inputs: HashMap::new(),
            outputs: HashMap::new(),
            names: HashMap::new(),
        };
        model.palette.as_ref().map_or(Ok(()), Palette::check).map_err(at)?;
        for (i, c) in model.controls.iter().enumerate() {
            c.check().map_err(|e| at(format!("{}: {e}", c.name())))?;
            if model.names.insert((c.control.clone(), c.layer.clone()), i).is_some() {
                return Err(at(format!("{} twice", c.name())));
            }
            let other = |o: &Control| o.control == c.control && o.revolution.is_some();
            if c.revolution.is_some() && model.controls[..i].iter().any(|o| other(o) && o.revolution != c.revolution) {
                return Err(at(format!("{}: a revolution its other layers' differs from", c.name())));
            }
            let parts = match c.lsb {
                Some(lsb) => vec![(c.midi, Part::Msb), (lsb, Part::Lsb)],
                None => vec![(c.midi, Part::Whole)],
            };
            for (address, part) in parts {
                for (on, index) in [(c.input.is_some(), &mut model.inputs), (c.output.is_some(), &mut model.outputs)] {
                    if on && index.insert(address, (i, part)).is_some() {
                        return Err(at(format!("{address} names two controls, one of them {}", c.name())));
                    }
                }
            }
        }
        Ok(model)
    }

    /// The model whose ports these are. Platforms wrap the USB product name ("DDJ-FLX10 MIDI 1",
    /// "2- DDJ-FLX10", docs/research/flx10-browser.md), so it matches anywhere, ignoring case and
    /// punctuation, but not before a digit.
    pub fn owns_port(&self, port_name: &str) -> bool {
        let fold = |s: &str| s.chars().filter(char::is_ascii_alphanumeric).map(|c| c.to_ascii_lowercase()).collect();
        let (port, name): (Vec<char>, Vec<char>) = (fold(port_name), fold(&self.name));
        let mut cut = Vec::new();
        for c in port_name.chars() {
            match cut.last_mut() {
                _ if c.is_ascii_alphanumeric() => cut.push(false),
                Some(last) => *last = true,
                None => {}
            }
        }
        !name.is_empty()
            && (0..port.len()).filter(|&i| port[i..].starts_with(&name)).any(|i| {
                let end = i + name.len();
                end == port.len() || cut[end - 1] || !port[end].is_ascii_digit()
            })
    }

    pub fn of_port(port_name: &str) -> Option<&'static Model> {
        models().iter().find(|m| m.owns_port(port_name))
    }

    pub fn of_usb(vendor: u16, product: u16) -> Option<&'static Model> {
        models().iter().find(|m| m.usb_vendor == vendor && m.usb_product == product)
    }

    pub fn named(name: &str) -> Option<&'static Model> {
        models().iter().find(|m| m.name == name)
    }

    /// The message that asks the device for every control's current position, if the model has
    /// one; the reply is ordinary input, decoded like any other.
    pub fn request_state(&self) -> Option<&[u8]> {
        self.state_request.as_ref().map(|r| &r.bytes[..])
    }

    /// Every control entry, in the file's order.
    pub fn controls(&self) -> &[Control] {
        &self.controls
    }

    /// Where `control`, one of this model's entries, sits in [`Model::controls`].
    pub fn row(&self, control: &Control) -> usize {
        let at = (control as *const Control as usize).wrapping_sub(self.controls.as_ptr() as usize);
        let row = at / std::mem::size_of::<Control>();
        assert!(
            self.controls.get(row).is_some_and(|c| std::ptr::eq(c, control)),
            "{} is not {}'s",
            control.name(),
            self.name
        );
        row
    }

    /// The revolution the controls on `rows` state, which the file keeps one per control.
    pub fn revolution(&self, rows: &[usize]) -> Option<Revolution> {
        rows.iter().find_map(|&r| self.controls[r].revolution)
    }

    /// The least step the controls on `rows` state, the least of them where they differ.
    pub fn least_step(&self, rows: &[usize]) -> Option<u8> {
        rows.iter().filter_map(|&r| self.controls[r].least_step).min()
    }

    pub fn control(&self, control: &str, layer: &str) -> Option<&Control> {
        self.names.get(&(control.to_owned(), layer.to_owned())).map(|&i| &self.controls[i])
    }

    /// The control that sends on `address`, and which part of its value the address carries.
    pub fn input_at(&self, address: Address) -> Option<(&Control, Part)> {
        self.inputs.get(&address).map(|&(i, part)| (&self.controls[i], part))
    }

    /// The control that takes `address`, and which part of its value the address carries.
    pub fn output_at(&self, address: Address) -> Option<(&Control, Part)> {
        self.outputs.get(&address).map(|&(i, part)| (&self.controls[i], part))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flx10() -> &'static Model {
        Model::named("DDJ-FLX10").unwrap()
    }

    #[test]
    fn every_model_file_reads() {
        for text in FILES {
            Model::parse(text).unwrap();
        }
        assert_eq!(models().len(), FILES.len());
    }

    #[test]
    fn the_name_matches_in_the_forms_reported_for_other_models_none_yet_seen_from_an_flx10() {
        for name in [
            "DDJ-FLX10",
            "DDJ-FLX10 MIDI 1",
            "2- DDJ-FLX10",
            "MIDIIN2 (DDJ-FLX10)",
            "DDJ-FLX10 (2)",
            "Pioneer DJ DDJ-FLX10",
            "ddj flx10",
        ] {
            assert_eq!(Model::of_port(name), Some(flx10()), "{name}");
        }
        for name in ["Midi Through Port-0", "DDJ-FLX100", "DDJ-FLX1", "DDJ-FLX4 MIDI 1"] {
            assert_eq!(Model::of_port(name), None, "{name}");
        }
    }

    #[test]
    fn usb_ids_find_the_flx10() {
        assert_eq!(Model::of_usb(0x2b73, 0x0041), Some(flx10()));
        assert_eq!(Model::of_usb(0x2b73, 0x0042), None);
    }

    #[test]
    fn an_address_reads_as_status_and_data_1() {
        let play = Address::try_from("90 0B".to_owned()).unwrap();
        assert_eq!(play, Address { kind: Kind::Note, channel: 0, number: 0x0B });
        assert_eq!(play.to_string(), "90 0B");
        for bad in ["80 0B", "90 80", "90", "B0 0B 00", "9G 0B"] {
            assert!(Address::try_from(bad.to_owned()).is_err(), "{bad}");
        }
    }

    fn file(controls: &str) -> String {
        format!(
            r#"{{"model": "T", "usb": {{"vendor": "0000", "product": "0001", "source": "test"}}, "hardware": "none", "sources": {{}}, "controls": [{controls}]}}"#
        )
    }

    #[test]
    fn a_model_file_refuses_what_would_be_ambiguous_or_incomplete() {
        let bad = [
            r#"{"control": "a", "in": "button", "midi": "90 00", "source": ""}, {"control": "b", "in": "button", "midi": "90 00", "source": ""}"#,
            r#"{"control": "a", "in": "button", "midi": "90 00", "source": ""}, {"control": "a", "in": "button", "midi": "90 01", "source": ""}"#,
            r#"{"control": "a", "in": "relative", "midi": "B0 00", "source": ""}"#,
            r#"{"control": "a", "in": "button", "lsb": "B0 20", "midi": "B0 00", "source": ""}"#,
            r#"{"control": "a", "out": "value", "midi": "B0 00", "source": ""}"#,
            r#"{"control": "a", "midi": "B0 00", "source": ""}"#,
            r#"{"control": "Deck 1", "in": "button", "midi": "90 00", "source": ""}"#,
            r#"{"control": "a", "in": "button", "midi": "90 00", "source": "", "colour": 1}"#,
            r#"{"control": "a", "out": "led", "midi": "90 00", "source": "", "observed": "x", "shows": {"divide": 10}}"#,
            r#"{"control": "a", "out": "value", "range": [0, 9], "midi": "B0 00", "source": "", "shows": {"divide": 10}}"#,
            r#"{"control": "a", "out": "value", "range": [0, 9], "midi": "B0 00", "source": "", "observed": "x", "shows": {"divide": 0}}"#,
            r#"{"control": "a", "in": "relative", "centre": 64, "midi": "B0 00", "source": "", "revolution": {"ticks": 10, "laps": [9, 11]}}"#,
            r#"{"control": "a", "in": "relative", "centre": 64, "midi": "B0 00", "source": "", "observed": "x", "revolution": {"ticks": 12, "laps": [9, 11]}}"#,
            r#"{"control": "a", "in": "button", "midi": "90 00", "source": "", "observed": "x", "revolution": {"ticks": 10, "laps": [9, 11]}}"#,
            r#"{"control": "a", "in": "relative", "centre": 64, "midi": "B0 00", "source": "", "observed": "x", "revolution": {"ticks": 10, "laps": [9, 11]}}, {"control": "a", "layer": "shift", "in": "relative", "centre": 64, "midi": "B0 01", "source": "", "observed": "x", "revolution": {"ticks": 11, "laps": [9, 11]}}"#,
            r#"{"control": "a", "in": "relative", "centre": 64, "midi": "B0 00", "source": "", "least-step": 3}"#,
            r#"{"control": "a", "out": "value", "range": [0, 2], "midi": "B0 00", "source": "", "labels": ["x", "y"]}"#,
            r#"{"control": "a", "out": "value", "values": [0, 2], "midi": "B0 00", "source": "", "labels": ["x", "y"]}"#,
            r#"{"control": "a", "out": "value", "range": [0, 1], "midi": "B0 00", "source": "", "observed": "x", "shows": {"divide": 10}, "labels": ["x", "y"]}"#,
            r#"{"control": "a", "in": "relative", "centre": 64, "midi": "B0 00", "source": "", "observed": "x", "least-step": 0}"#,
        ];
        for controls in bad {
            assert!(Model::parse(&file(controls)).is_err(), "{controls}");
        }
        let fine = r#"{"control": "a", "in": "button", "midi": "90 00", "source": ""}, {"control": "a", "layer": "shift", "in": "button", "out": "led", "midi": "90 01", "source": ""}, {"control": "b", "out": "value", "range": [1, 2], "midi": "B0 01", "source": "", "labels": ["x", "y"]}"#;
        assert!(Model::parse(&file(fine)).is_ok());
    }

    #[test]
    fn the_flx10_screens_show_bpm_and_playing_speed_as_observed() {
        let shown = |control: &str, v| flx10().control(control, "").and_then(|c| c.shows.as_ref()).unwrap().text(v);
        // docs/research/flx10-observed.md, 2026-10-08: 1280 showed 128.00, 1000 showed 0.00%.
        assert_eq!(shown("deck1.display.bpm", 1280), "128.00");
        assert_eq!(shown("deck1.display.playing-speed", 1000), "0.00%");
        let shows = |control: &str| flx10().control(control, "").and_then(|c| c.shows.clone()).unwrap();
        assert_eq!(shows("deck1.display.bpm").raw(128.0), Some(1280.0));
        assert_eq!(shows("deck1.display.playing-speed").raw(-100.0), Some(0.0));
        assert_eq!(shows("deck1.display.bpm").raw(128.05), None);
    }

    #[test]
    fn the_flx10_key_values_stand_for_the_keys_and_amounts_its_list_states() {
        let labels = |control: &str| flx10().control(control, "").unwrap().labels.clone();
        // MML p.7 *3 (an image in the list): 0x00 none, then C, Am, Db, Bbm ... B, Abm.
        let keys = labels("deck1.display.key");
        assert_eq!(keys.len(), 25);
        assert_eq!([&keys[0], &keys[1], &keys[2], &keys[12], &keys[24]], ["---", "C", "Am", "Dm", "Abm"]);
        // MML p.7 Key change amount: 0x01-0x0C -12 to -1, 0x0D 0, 0x0E-0x19 +1 to +12.
        let changes = labels("deck1.display.key-change");
        assert_eq!([&changes[0], &changes[12], &changes[24]], ["-12", "0", "+12"]);
        for deck in 1..=4 {
            assert_eq!(labels(&format!("deck{deck}.display.key")), keys);
            assert_eq!(labels(&format!("deck{deck}.display.key-change")), changes);
        }
    }

    #[test]
    fn a_state_request_is_one_whole_message_and_optional() {
        let with = |request: &str| {
            file("").replacen(
                r#""controls""#,
                &format!(r#""state-request": {{"bytes": "{request}", "source": "test"}}, "controls""#),
                1,
            )
        };
        assert_eq!(Model::parse(&with("F0 01 02 F7")).unwrap().request_state(), Some(&[0xF0, 0x01, 0x02, 0xF7][..]));
        for bad in ["F0 01 02", "F0 01 F7 F0 02 F7", "90 0B", "90 0B 7F 90", "F0 0G F7", ""] {
            assert!(Model::parse(&with(bad)).is_err(), "{bad}");
        }
        assert_eq!(Model::parse(&file("")).unwrap().request_state(), None);
        let request = [0xF0, 0x00, 0x40, 0x05, 0x00, 0x00, 0x04, 0x01, 0x00, 0x03, 0x01, 0xF7];
        assert_eq!(flx10().request_state(), Some(&request[..]));
    }

    #[test]
    fn a_palette_names_each_colour_number_once_with_its_source() {
        let with = |colours: &str| {
            let palette = format!(r#""palette": {{"source": "test", "colours": [{colours}]}}, "controls""#);
            Model::parse(&file("").replacen(r#""controls""#, &palette, 1))
        };
        let fine = r##"{"number": 0, "name": "off", "source": "s", "verified": false}, {"numbers": [1, 127], "rgb": "#9500ff", "name": "purple", "source": "s", "verified": true}"##;
        let palette = with(fine).unwrap().palette.unwrap();
        assert_eq!(palette.colour(64).map(|c| c.name.as_str()), Some("purple"));
        let bad = [
            r#"{"number": 1, "name": "a", "source": "s", "verified": false}, {"numbers": [0, 1], "name": "b", "source": "s", "verified": false}"#,
            r#"{"numbers": [2, 1], "name": "a", "source": "s", "verified": false}"#,
            r#"{"number": 1, "numbers": [1, 1], "name": "a", "source": "s", "verified": false}"#,
            r#"{"number": 128, "name": "a", "source": "s", "verified": false}"#,
            r#"{"number": 1, "name": "a", "source": "", "verified": false}"#,
            r#"{"number": 1, "name": "a", "source": "s"}"#,
            r#"{"number": 1, "rgb": "9500ff", "name": "a", "source": "s", "verified": false}"#,
        ];
        for colours in bad {
            assert!(with(colours).is_err(), "{colours}");
        }
        assert!(flx10().palette.is_some());
    }
}
