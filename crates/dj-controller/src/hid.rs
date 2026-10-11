// Concern: the experimental WebHID transport: a model's vendor interface opened on request, reports sent and read | Non-concern: report layouts (the core), MIDI | IO: fields -> reports -> sink
//! Sends only when called. WebHID cannot send the ep0 vendor transfers
//! (docs/research/flx10-browser.md): a `control` step goes over WebUSB, `controlStep` (usb.rs).

use dj_controller_core::hid::{self, DeckState, Interface, Via, Waveform};
use dj_controller_core::model::Model;
use dj_controller_core::session::MAX_QUEUED;
use js_sys::{Array, Uint8Array};
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{JsFuture, future_to_promise};
use web_sys::{HidDevice, HidDeviceFilter, HidDeviceRequestOptions, HidInputReportEvent};

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::pin::Pin;
use std::rc::{Rc, Weak};
use std::task::{Context, Poll, Waker};

use futures_lite::Stream;

use crate::glue::Iter;
use crate::js::{now, object, text};

fn js_error(e: JsValue) -> JsError {
    JsError::new(&text(&e))
}

#[wasm_bindgen(typescript_custom_section)]
const HID_TYPES: &str = r#"
/** A model's vendor HID interface as its file states it: the usage page, report sizes in bytes, and the setup steps the sources describe, each sent only when asked: `control` steps with `controlStep` over WebUSB (each message an 8-byte setup packet), `midi` steps with `Inspector.send`, or `Inspector.repeat` where they repeat every `everyMs`, `hid` steps with `Screens.step`; `observed` says what a unit did. */
export type HidInterface = { usagePage: number; inputBytes: number; outputBytes: number; source: string; steps: HidStep[] };
export type HidStep = { name: string; via: "control" | "midi" | "hid"; messages: Uint8Array[]; everyMs?: number; source: string; observed?: string };

/** One report through the interface: `out` once sent, named by what encoded it, or `in` as received, named `ack` where it is the `xx D8` acknowledgement VZ-F reports. `time` is `performance.now()` or the event's timeStamp, in ms. */
export type HidReport = { direction: "in" | "out"; name: string; bytes: Uint8Array; time: number };

/** A deck's state for the `xx 27` report: `bpm` in tenths, `remainingMs` the time shown, `position` in 1/128 s of audio. */
export type HidDeckState = { deck: number; loaded: boolean; bpm: number; remainingMs: number; position: number };
"#;

/// Values pushed to every stream taken from it, from when each was taken until `end`.
#[derive(Clone, Default)]
pub struct Fanout(Rc<RefCell<Subscribers>>);

#[derive(Default)]
struct Subscribers {
    queues: Vec<Weak<RefCell<Queued>>>,
    ended: bool,
}

#[derive(Default)]
struct Queued {
    items: VecDeque<JsValue>,
    waker: Option<Waker>,
    ended: bool,
    dropped: Rc<Cell<u64>>,
}

/// One stream taken from a fanout, holding at most `MAX_QUEUED` unread as a session's feeds do.
pub struct Taken(Rc<RefCell<Queued>>);

impl Taken {
    pub fn dropped(&self) -> Rc<Cell<u64>> {
        self.0.borrow().dropped.clone()
    }
}

impl Fanout {
    pub fn push(&self, value: &JsValue) {
        let queues: Vec<_> = self.0.borrow().queues.iter().filter_map(Weak::upgrade).collect();
        for queue in queues {
            let waker = {
                let mut q = queue.borrow_mut();
                q.items.push_back(value.clone());
                if q.items.len() > MAX_QUEUED {
                    q.items.pop_front();
                    q.dropped.set(q.dropped.get() + 1);
                }
                q.waker.take()
            };
            waker.into_iter().for_each(Waker::wake);
        }
    }

    pub fn end(&self) {
        let queues: Vec<_> = {
            let mut state = self.0.borrow_mut();
            state.ended = true;
            std::mem::take(&mut state.queues)
        };
        for queue in queues.iter().filter_map(Weak::upgrade) {
            let waker = {
                let mut q = queue.borrow_mut();
                q.ended = true;
                q.waker.take()
            };
            waker.into_iter().for_each(Waker::wake);
        }
    }

    pub fn take(&self) -> Taken {
        let queue = Rc::new(RefCell::new(Queued { ended: self.0.borrow().ended, ..Queued::default() }));
        self.0.borrow_mut().queues.push(Rc::downgrade(&queue));
        Taken(queue)
    }
}

impl Stream for Taken {
    type Item = JsValue;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<JsValue>> {
        let mut q = self.0.borrow_mut();
        match q.items.pop_front() {
            Some(v) => Poll::Ready(Some(v)),
            None if q.ended => Poll::Ready(None),
            None => {
                q.waker = Some(cx.waker().clone());
                Poll::Pending
            }
        }
    }
}

/// A model's vendor HID interface, opened through WebHID.
#[wasm_bindgen(skip_typescript)]
pub struct Screens {
    hid: &'static Interface,
    device: HidDevice,
    reports: Fanout,
    // Held so the device's listener lives as long as the screens.
    _listener: Closure<dyn FnMut(HidInputReportEvent)>,
}

/// Shows the device chooser (call it from a click) and opens the device. Sends nothing.
#[wasm_bindgen(js_name = openScreens, skip_typescript)]
pub async fn open_screens(model: String) -> Result<Screens, JsError> {
    let model = Model::named(&model).ok_or_else(|| JsError::new(&format!("no model {model:?}")))?;
    let hid = model.hid.as_ref().ok_or_else(|| JsError::new(&format!("{} states no HID interface", model.name)))?;
    let window = web_sys::window().ok_or_else(|| JsError::new("no window"))?;
    let filter = HidDeviceFilter::new();
    filter.set_vendor_id(model.usb_vendor.into());
    filter.set_product_id(model.usb_product);
    filter.set_usage_page(hid.usage_page);
    let chosen = JsFuture::from(window.navigator().hid().request_device(&HidDeviceRequestOptions::new(&[filter])))
        .await
        .map_err(js_error)?;
    let device: HidDevice =
        chosen.unchecked_into::<Array>().get(0).dyn_into().map_err(|_| JsError::new("no device chosen"))?;
    if !device.opened() {
        JsFuture::from(device.open()).await.map_err(js_error)?;
    }
    let reports = Fanout::default();
    let received = reports.clone();
    let listener = Closure::<dyn FnMut(HidInputReportEvent)>::new(move |event: HidInputReportEvent| {
        let data = event.data();
        let bytes = Uint8Array::new_with_byte_offset_and_length(
            &data.buffer(),
            data.byte_offset() as u32,
            data.byte_length() as u32,
        )
        .to_vec();
        let name = if hid::is_ack(&bytes) { "ack" } else { "" };
        received.push(&report("in", name, &bytes, event.time_stamp()));
    });
    device.set_oninputreport(Some(listener.as_ref().unchecked_ref()));
    Ok(Screens { hid, device, reports, _listener: listener })
}

pub(crate) fn report(direction: &str, name: &str, bytes: &[u8], time: f64) -> JsValue {
    let fields = vec![
        ("direction", direction.into()),
        ("name", name.into()),
        ("bytes", Uint8Array::from(bytes).into()),
        ("time", time.into()),
    ];
    object(fields).into()
}

#[wasm_bindgen]
impl Screens {
    #[wasm_bindgen(getter, js_name = productName)]
    pub fn product_name(&self) -> String {
        self.device.product_name()
    }

    /// Sends the model's `hid` setup step `name`, its reports in order.
    #[wasm_bindgen(unchecked_return_type = "Promise<number>")]
    pub fn step(&self, name: &str) -> Result<js_sys::Promise, JsError> {
        let step = self.hid.step(name).ok_or_else(|| JsError::new(&format!("no HID step {name:?}")))?;
        if step.via != Via::Hid {
            return Err(JsError::new(&format!("{name} is not a HID step: send it over MIDI or with controlStep")));
        }
        Ok(self.send(name, step.messages.clone()))
    }

    /// Sends the `xx 27` state report for one deck.
    #[wasm_bindgen(js_name = deckState, unchecked_return_type = "Promise<number>")]
    pub fn deck_state(
        &self,
        #[wasm_bindgen(unchecked_param_type = "HidDeckState")] state: &JsValue,
    ) -> Result<js_sys::Promise, JsError> {
        let number = |key: &str| {
            let v = js_sys::Reflect::get(state, &key.into()).ok().and_then(|v| v.as_f64());
            v.filter(|v| v.fract() == 0.0 && *v >= 0.0 && *v <= f64::from(u32::MAX))
                .map(|v| v as u32)
                .ok_or_else(|| JsError::new(&format!("{key} is not a whole number from 0")))
        };
        let loaded = js_sys::Reflect::get(state, &"loaded".into()).ok().and_then(|v| v.as_bool());
        let state = DeckState {
            deck: u8::try_from(number("deck")?).unwrap_or(u8::MAX),
            loaded: loaded.ok_or_else(|| JsError::new("loaded is not a boolean"))?,
            bpm_tenths: u16::try_from(number("bpm")?).unwrap_or(u16::MAX),
            remaining_ms: number("remainingMs")?,
            position: number("position")?,
        };
        Ok(self.send("deck-state", vec![hid::deck_state(state).map_err(|e| JsError::new(&e))?]))
    }

    /// Sends `00 3D <page>`, 1 to 5.
    #[wasm_bindgen(js_name = displayPage, unchecked_return_type = "Promise<number>")]
    pub fn display_page(&self, page: u8) -> Result<js_sys::Promise, JsError> {
        Ok(self.send("display-page", vec![hid::display_page(page).map_err(|e| JsError::new(&e))?]))
    }

    /// Sends one deck's `xx 39` pad-mode label: printable ASCII.
    #[wasm_bindgen(js_name = padLabel, unchecked_return_type = "Promise<number>")]
    pub fn pad_label(&self, deck: u8, text: &str) -> Result<js_sys::Promise, JsError> {
        Ok(self.send("pad-label", vec![hid::pad_label(deck, text).map_err(|e| JsError::new(&e))?]))
    }

    /// Uploads one waveform to a deck: `kind` `overview` (`xx 37`) or `detail` (`xx 38`),
    /// `columns` flat `[high, low, mid]` triples; resolves to the number of reports sent.
    #[wasm_bindgen(unchecked_return_type = "Promise<number>")]
    pub fn waveform(
        &self,
        deck: u8,
        #[wasm_bindgen(unchecked_param_type = "\"overview\" | \"detail\"")] kind: &str,
        columns: &[u8],
    ) -> Result<js_sys::Promise, JsError> {
        let (kind, name) = match kind {
            "overview" => (Waveform::Overview, "waveform-overview"),
            "detail" => (Waveform::Detail, "waveform-detail"),
            _ => return Err(JsError::new(&format!("no waveform kind {kind:?}"))),
        };
        if !columns.len().is_multiple_of(3) {
            return Err(JsError::new("columns are 3 bytes each"));
        }
        let columns: Vec<[u8; 3]> = columns.chunks(3).map(|c| [c[0], c[1], c[2]]).collect();
        Ok(self.send(name, hid::waveform(deck, kind, &columns).map_err(|e| JsError::new(&e))?))
    }

    fn send(&self, name: &str, reports: Vec<Vec<u8>>) -> js_sys::Promise {
        let (device, fanout, name) = (self.device.clone(), self.reports.clone(), name.to_owned());
        future_to_promise(async move { Ok(send_all(&device, &fanout, &name, reports).await?.into()) })
    }

    /// Every report through the interface from now on, in and out, until it closes.
    pub fn reports(&self, options: JsValue) -> JsValue {
        let reports = self.reports.take();
        let dropped = reports.dropped();
        Iter::of(reports, dropped, |r| r, &options)
    }

    /// Stops reading and closes the device; the screens are spent.
    pub fn close(self) -> js_sys::Promise {
        self.reports.end();
        self.device.set_oninputreport(None);
        self.device.close().unchecked_into()
    }
}

/// Sends each report, id 0 as there are none (docs/research/flx10-browser.md), one at a time.
async fn send_all(device: &HidDevice, fanout: &Fanout, name: &str, reports: Vec<Vec<u8>>) -> Result<u32, JsValue> {
    let mut sent = 0;
    for bytes in reports {
        JsFuture::from(device.send_report_with_u8_array(0, &Uint8Array::from(&bytes[..]))?).await?;
        sent += 1;
        fanout.push(&report("out", name, &bytes, now()));
    }
    Ok(sent)
}
