// Concern: what diagnostics reach through a session: raw sends, outputs by name, syncs, the ledger, outputs, palette, repeating steps | Non-concern: the main API, decoding | IO: (bytes, Output) -> port
use dj_controller_core::hid::Via;
use dj_controller_core::ledger::Told;
use dj_controller_core::model::Model;
use dj_controller_core::output::{Output, Show};
use dj_controller_core::session::{SYNC_GAP_MS, Session};
use js_sys::{Array, Promise, Uint8Array};
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

use futures_lite::StreamExt;

use crate::events::deck_event;
use crate::glue::{Iter, RelativeControl, error, palette_colour, promise, to_js};
use crate::js::object;

/// What `inspect` hands out for a controller: the diagnostics over its session.
#[wasm_bindgen(skip_typescript)]
pub struct Inspector {
    session: Session,
    names: (Option<String>, Option<String>),
}

thread_local! {
    /// Each connected controller's inspector, for `inspect`.
    static INSPECTORS: js_sys::WeakMap = js_sys::WeakMap::new();
}

/// Lets `inspect` find `controller`'s session.
pub fn register(controller: &js_sys::Object, session: &Session, names: (Option<String>, Option<String>)) {
    let inspector = JsValue::from(Inspector { session: session.clone(), names });
    INSPECTORS.with(|map| map.set(controller, &inspector));
}

/// The diagnostics of a controller this entry's `connect` resolved to.
#[wasm_bindgen(skip_typescript)]
pub fn inspect(controller: &JsValue) -> Result<JsValue, JsValue> {
    let found = INSPECTORS.with(|map| controller.dyn_ref::<js_sys::Object>().map(|c| map.get(c)));
    found
        .filter(|i| !i.is_undefined())
        .ok_or_else(|| js_sys::TypeError::new("not a controller dj-controller/diagnostics connected").into())
}

#[wasm_bindgen]
impl Inspector {
    #[wasm_bindgen(getter, js_name = inputName)]
    pub fn input_name(&self) -> Option<String> {
        self.names.0.clone()
    }

    #[wasm_bindgen(getter, js_name = outputName)]
    pub fn output_name(&self) -> Option<String> {
        self.names.1.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn hid(&self) -> JsValue {
        interface(self.session.model())
    }

    pub fn messages(&self, options: JsValue) -> JsValue {
        let received = self.session.received();
        let dropped = received.dropped();
        Iter::of(received.filter(|r| r.message.is_some()), dropped, |r| deck_event(&r).into(), &options)
    }

    pub fn told(&self, options: JsValue) -> JsValue {
        Iter::feed(self.session.told(), |t| told_object(&t), &options)
    }

    /// Each report of `control`, a relative control of a controller this entry connected.
    pub fn turns(&self, control: &RelativeControl, options: JsValue) -> JsValue {
        (control.turns)(&options)
    }

    pub fn send(&self, bytes: Vec<u8>) -> Promise {
        let session = self.session.clone();
        future_to_promise(async move { session.send_raw(&bytes).map(|()| JsValue::UNDEFINED).map_err(error) })
    }

    pub fn show(&self, output: JsValue) -> Promise {
        let (session, model) = (self.session.clone(), self.session.model());
        future_to_promise(async move {
            let output = output_from_js(model, &output).map_err(|e| JsValue::from(js_sys::TypeError::new(&e)))?;
            session.show(output).map(|()| JsValue::UNDEFINED).map_err(error)
        })
    }

    pub fn sync(&self, fill: Option<Array>, gap_ms: Option<f64>) -> Promise {
        let (session, model) = (self.session.clone(), self.session.model());
        future_to_promise(async move {
            let fill = fill.map(|a| a.iter().map(|o| output_from_js(model, &o)).collect::<Result<Vec<_>, _>>());
            let fill = fill.transpose().map_err(|e| JsValue::from(js_sys::TypeError::new(&e)))?.unwrap_or_default();
            let report = session.sync_outputs(&fill, gap_ms.unwrap_or(SYNC_GAP_MS).max(0.0)).await.map_err(error)?;
            Ok(to_js(&report))
        })
    }

    /// Runs until the signal aborts (rejecting with its reason), a send fails or the controller closes.
    pub fn repeat(&self, name: String, options: JsValue) -> Promise {
        let session = self.session.clone();
        promise(async move { Err(error(session.repeat(&name).await)) }, &options)
    }

    #[wasm_bindgen(js_name = outputState)]
    pub fn output_state(&self, control: Option<String>) -> Array {
        self.session.output_state(control.as_deref()).iter().map(told_object).collect()
    }

    pub fn history(&self) -> Array {
        self.session.history().iter().map(told_object).collect()
    }

    pub fn outputs(&self) -> Array {
        Output::all(self.session.model())
            .iter()
            .map(|output| {
                let mut fields: Vec<(&str, JsValue)> =
                    fields_of(output).into_iter().map(|(k, v)| (k, v.into())).collect();
                fields.push(("name", output.control.name().into()));
                fields.push(("source", output.control.source.as_str().into()));
                if let Some([lo, hi]) = output.control.range {
                    fields.push(("range", Array::of2(&lo.into(), &hi.into()).into()));
                }
                if !output.control.values.is_empty() {
                    let values: Array = output.control.values.iter().map(|&v| JsValue::from(v)).collect();
                    fields.push(("values", values.into()));
                }
                if let Some(firmware) = &output.control.firmware {
                    fields.push(("firmware", firmware.as_str().into()));
                }
                if let Some(observed) = &output.control.observed {
                    fields.push(("observed", observed.as_str().into()));
                }
                JsValue::from(object(fields))
            })
            .collect()
    }

    /// A value output's `value` as a unit was seen to show it, where the model file states how.
    pub fn displayed(&self, control: &str, value: f64) -> Result<Option<String>, JsValue> {
        let Some(control) = self.session.model().control(control, "") else { return Ok(None) };
        match Show::raw(control, value).map_err(|e| crate::js::error("refused", &e.to_string()))? {
            Show::Value(raw) => Ok(control.shows.as_ref().map(|s| s.text(raw))),
            show => unreachable!("{show:?} read as a raw value"),
        }
    }

    pub fn colour(&self, colour: f64) -> Result<JsValue, JsValue> {
        palette_colour(self.session.model().palette.as_ref(), colour)
    }
}

/// The vendor HID interface `model` states, or undefined where it states none.
pub fn interface(model: &Model) -> JsValue {
    let Some(hid) = model.hid.as_ref() else { return JsValue::UNDEFINED };
    let steps: Array = hid
        .steps
        .iter()
        .map(|step| {
            let messages: Array = step.messages.iter().map(|m| JsValue::from(Uint8Array::from(&m[..]))).collect();
            let via = match step.via {
                Via::Control => "control",
                Via::Midi => "midi",
                Via::Hid => "hid",
            };
            let mut fields: Vec<(&str, JsValue)> = vec![
                ("name", step.name.as_str().into()),
                ("via", via.into()),
                ("messages", messages.into()),
                ("source", step.source.as_str().into()),
            ];
            if let Some(every) = step.every_ms {
                fields.push(("everyMs", every.into()));
            }
            if let Some(observed) = &step.observed {
                fields.push(("observed", observed.as_str().into()));
            }
            JsValue::from(object(fields))
        })
        .collect();
    object(vec![
        ("usagePage", hid.usage_page.into()),
        ("inputBytes", hid.input.into()),
        ("outputBytes", hid.output.into()),
        ("source", hid.source.as_str().into()),
        ("steps", steps.into()),
    ])
    .into()
}

/// A JS property's value, as `Output` objects spell them.
#[derive(Debug, Clone, PartialEq)]
enum Field {
    Number(f64),
    Text(String),
    Flag(bool),
}

impl From<Field> for JsValue {
    fn from(field: Field) -> JsValue {
        match field {
            Field::Number(n) => n.into(),
            Field::Text(t) => t.into(),
            Field::Flag(b) => b.into(),
        }
    }
}

/// An output as the `Output` type spells it.
fn fields_of(output: &Output) -> Vec<(&'static str, Field)> {
    let mut fields = vec![
        ("control", Field::Text(output.control.control.clone())),
        ("layer", Field::Text(output.control.layer.clone())),
        ("kind", Field::Text(output.show.kind().name().to_owned())),
    ];
    fields.push(match output.show {
        Show::Led(on) => ("on", Field::Flag(on)),
        Show::Colour(colour) => ("colour", Field::Number(colour.into())),
        Show::Value(value) => ("value", Field::Number(value.into())),
    });
    fields
}

/// One telling as the `Told` type declares it.
pub fn told_object(told: &Told) -> JsValue {
    let mut fields: Vec<(&str, JsValue)> = fields_of(&told.output).into_iter().map(|(k, v)| (k, v.into())).collect();
    fields.push(("seq", (told.seq as f64).into()));
    fields.push(("at", told.at.into()));
    fields.push(("via", told.via.name().into()));
    object(fields).into()
}

fn output_from_js(model: &'static Model, output: &JsValue) -> Result<Output, String> {
    output_of(model, |key| {
        let value = js_sys::Reflect::get(output, &key.into()).ok()?;
        value
            .as_f64()
            .map(Field::Number)
            .or_else(|| value.as_string().map(Field::Text))
            .or_else(|| value.as_bool().map(Field::Flag))
    })
}

/// The output `field` spells on `model`, its number read by the core.
fn output_of(model: &'static Model, field: impl Fn(&str) -> Option<Field>) -> Result<Output, String> {
    let text = |key: &str| match field(key) {
        Some(Field::Text(t)) => Ok(t),
        _ => Err(format!("{key} is not a string")),
    };
    let number = |key: &str| match field(key) {
        Some(Field::Number(v)) => Ok(v),
        _ => Err(format!("{key} is not a number")),
    };
    let name = text("control")?;
    let layer = if field("layer").is_some() { text("layer")? } else { String::new() };
    let control =
        model.control(&name, &layer).ok_or(format!("{} has no control {name:?} on layer {layer:?}", model.name))?;
    let show = match text("kind")?.as_str() {
        "led" => match field("on") {
            Some(Field::Flag(on)) => Show::Led(on),
            _ => return Err("on is not a boolean".into()),
        },
        "colour" => Show::colour(control, number("colour")?).map_err(|e| e.to_string())?,
        "value" => Show::raw(control, number("value")?).map_err(|e| e.to_string())?,
        kind => return Err(format!("no output kind {kind:?}")),
    };
    Ok(Output { control, show })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flx10() -> &'static Model {
        Model::named("DDJ-FLX10").unwrap()
    }

    fn read(fields: &[(&str, Field)]) -> Result<Output, String> {
        output_of(flx10(), |key| fields.iter().find(|(k, _)| *k == key).map(|(_, v)| v.clone()))
    }

    #[test]
    fn every_output_of_every_model_reads_back_from_its_fields() {
        for model in dj_controller_core::model::models() {
            for output in dj_controller_core::ledger::Ledger::sync_plan(model, &[]) {
                let fields = fields_of(&output);
                let back = output_of(model, |key| fields.iter().find(|(k, _)| *k == key).map(|(_, v)| v.clone()));
                assert_eq!(back, Ok(output));
            }
        }
    }

    #[test]
    fn a_number_gets_the_cores_range_message() {
        let meter = |level: f64| {
            let fields = [
                ("control", Field::Text("mixer.channel2.level-meter".into())),
                ("kind", Field::Text("value".into())),
                ("value", Field::Number(level)),
            ];
            read(&fields).and_then(|o| o.bytes().map_err(|e| e.to_string()))
        };
        assert_eq!(meter(127.0), Ok(vec![0xB1, 0x02, 127]));
        for level in [128.0, 300.0, -1.0, 70000.0] {
            assert!(meter(level).unwrap_err().ends_with("is out of range"), "{level}");
        }
        assert!(meter(1.5).unwrap_err().ends_with("is not a whole number"));
    }
}
