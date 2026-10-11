// Concern: one received message as the diagnostics' JS object: raw, as MIDI, and as its control events | Non-concern: decoding (the core), the typed events (glue.rs) | IO: (Received) -> DeckEvent
use dj_controller_core::decode::{Event, Value};
use dj_controller_core::midi::Message;
use dj_controller_core::session::Received;
use js_sys::{Array, Object, Uint8Array};
use wasm_bindgen::prelude::*;

use crate::js::object;

/// One message as the `DeckEvent` type declares it.
pub fn deck_event(received: &Received) -> Object {
    let Received { bytes, time, message, events } = received;
    let parsed = message.as_ref().expect("the inspector sees received messages only");
    let (bytes, time) = (&bytes[..], *time);
    let controls: Array = events.iter().map(control).collect();
    let mut fields: Vec<(&str, JsValue)> =
        vec![("bytes", Uint8Array::from(bytes).into()), ("time", time.into()), ("controls", controls.into())];
    let n = |v: u8| JsValue::from(v);
    let mut channel = |kind: &str, channel: u8, rest: &[(&'static str, JsValue)]| {
        fields.push(("type", kind.into()));
        fields.push(("channel", n(channel)));
        fields.extend_from_slice(rest);
    };
    match parsed.clone() {
        Ok(Message::NoteOff { channel: c, note, velocity }) => {
            channel("noteOff", c, &[("note", n(note)), ("velocity", n(velocity))])
        }
        Ok(Message::NoteOn { channel: c, note, velocity }) => {
            channel("noteOn", c, &[("note", n(note)), ("velocity", n(velocity))])
        }
        Ok(Message::PolyPressure { channel: c, note, pressure }) => {
            channel("polyPressure", c, &[("note", n(note)), ("pressure", n(pressure))])
        }
        Ok(Message::ControlChange { channel: c, control, value }) => {
            channel("controlChange", c, &[("control", n(control)), ("value", n(value))])
        }
        Ok(Message::ProgramChange { channel: c, program }) => channel("programChange", c, &[("program", n(program))]),
        Ok(Message::ChannelPressure { channel: c, pressure }) => {
            channel("channelPressure", c, &[("pressure", n(pressure))])
        }
        Ok(Message::PitchBend { channel: c, value }) => channel("pitchBend", c, &[("value", value.into())]),
        Ok(Message::SysEx(body)) => {
            fields.push(("type", "sysex".into()));
            fields.push(("body", Uint8Array::from(&body[..]).into()));
        }
        Ok(Message::System { status, data }) => {
            fields.push(("type", "system".into()));
            fields.push(("status", n(status)));
            fields.push(("data", Uint8Array::from(&data[..]).into()));
        }
        Err(e) => {
            fields.push(("type", "malformed".into()));
            fields.push(("error", e.to_string().into()));
        }
    }
    object(fields)
}

/// One control event as the `ControlEvent` type declares it.
fn control(event: &Event) -> JsValue {
    let text = ("text", JsValue::from(event.to_string()));
    let Event::Control { control, value, midi } = event else {
        return object(vec![("kind", "unmapped".into()), text]).into();
    };
    let bytes: Vec<u8> = midi.iter().flat_map(|m| m.encode().expect("every decoded message encodes")).collect();
    let mut fields: Vec<(&str, JsValue)> = vec![
        ("control", control.control.as_str().into()),
        ("layer", control.layer.as_str().into()),
        ("source", control.source.as_str().into()),
        ("bytes", Uint8Array::from(&bytes[..]).into()),
        text,
    ];
    let bits = || ("bits", JsValue::from(if control.lsb.is_some() { 14 } else { 7 }));
    let (kind, rest): (&str, Vec<(&str, JsValue)>) = match *value {
        Value::Button(pressed) => ("button", vec![("pressed", pressed.into())]),
        Value::Switch(on) => ("switch", vec![("on", on.into())]),
        Value::Absolute(v) => ("absolute", vec![bits(), ("value", v.into())]),
        Value::Msb(msb) => ("absolute", vec![bits(), ("msb", msb.into())]),
        Value::Lsb(lsb) => ("absolute", vec![bits(), ("lsb", lsb.into())]),
        Value::Relative(step) => ("relative", vec![("step", step.into())]),
        Value::Pad(velocity) => ("pad", vec![("velocity", velocity.into())]),
    };
    fields.push(("kind", kind.into()));
    fields.extend(rest);
    object(fields).into()
}
