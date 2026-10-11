// Concern: connect over Web MIDI: access, the model's ports awaited and opened, the core session started, unplug and abort closing it | Non-concern: the session's work, the tree | IO: ports <-> session
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll};

use dj_controller_core::error::{CloseReason, Error};
use dj_controller_core::model::Model;
use dj_controller_core::session::{Link, Session};
use js_sys::{Promise, Uint8Array};
use wasm_bindgen::prelude::*;
use wasm_bindgen::{JsCast, UnwrapThrowExt};
use wasm_bindgen_futures::{JsFuture, future_to_promise, spawn_local};
use web_sys::{
    AbortController, AbortSignal, AddEventListenerOptions, MidiAccess, MidiConnectionEvent, MidiInput,
    MidiMessageEvent, MidiOptions, MidiOutput, MidiPort, MidiPortDeviceState,
};

use crate::glue::{PaletteView, error, method, to_js};
use crate::js::{abortable, either, name, navigator, next_event, now, sleep, text};

/// A session's link over a Web MIDI output.
struct WebLink {
    output: MidiOutput,
}

impl Link for WebLink {
    fn send(&self, bytes: &[u8], at: Option<f64>) -> Result<(), String> {
        let data = Uint8Array::from(bytes);
        let sent = match at {
            Some(at) => self.output.send_with_timestamp(&data, at),
            None => self.output.send(&data),
        };
        sent.map_err(|e| text(&e))
    }

    fn now(&self) -> f64 {
        now()
    }

    fn sleep(&self, ms: f64) -> Pin<Box<dyn Future<Output = ()>>> {
        let cancel = AbortController::new().unwrap_throw();
        Box::pin(Sleep { wait: JsFuture::from(sleep(ms, &cancel.signal())), cancel })
    }
}

/// A timer that, dropped before it fires, clears itself, so a lost race leaves no timer behind.
struct Sleep {
    wait: JsFuture,
    cancel: AbortController,
}

impl Future for Sleep {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        // Only its own drop rejects it, and then nothing polls it.
        Pin::new(&mut self.wait).poll(cx).map(|fired| fired.map(drop).unwrap_throw())
    }
}

impl Drop for Sleep {
    fn drop(&mut self) {
        self.cancel.abort();
    }
}

/// The first input of `model` and its output: the one named as it, else any of the model's.
/// Assumed, unobserved: an output named as the input is its pair; Windows' "MIDIIN2 (…)" names never are.
fn ports(access: &MidiAccess, model: &'static Model) -> Option<(MidiInput, MidiOutput)> {
    let all = |values: js_sys::Iterator| -> Vec<MidiPort> {
        values.into_iter().filter_map(Result::ok).map(JsCast::unchecked_into).collect()
    };
    let ours = |p: &MidiPort| p.name().is_some_and(|n| model.owns_port(&n));
    let input = all(access.inputs().values()).into_iter().find(ours)?;
    let outputs: Vec<MidiPort> = all(access.outputs().values()).into_iter().filter(ours).collect();
    let output = outputs.iter().find(|p| p.name() == input.name()).or(outputs.first())?.clone();
    Some((input.unchecked_into(), output.unchecked_into()))
}

/// A connected controller's ports and listeners, released when its session closes.
struct Ports {
    access: MidiAccess,
    input: MidiInput,
    output: MidiOutput,
    _on_message: Closure<dyn FnMut(MidiMessageEvent)>,
    on_state: Closure<dyn FnMut(MidiConnectionEvent)>,
    on_abort: Option<(AbortSignal, Closure<dyn FnMut()>)>,
}

impl Ports {
    fn detach(&self) {
        self.input.set_onmidimessage(None);
        let detach = |target: &web_sys::EventTarget, kind: &str, f: &js_sys::Function| {
            target.remove_event_listener_with_callback(kind, f).unwrap_throw()
        };
        detach(&self.access, "statechange", self.on_state.as_ref().unchecked_ref());
        if let Some((signal, abort)) = &self.on_abort {
            detach(signal, "abort", abort.as_ref().unchecked_ref());
        }
    }

    async fn close(&self) -> Result<(), JsValue> {
        JsFuture::from(self.input.close()).await?;
        JsFuture::from(self.output.close()).await?;
        Ok(())
    }
}

/// Asks for MIDI access with sysex, waits for `model`'s ports, opens them, tells every output its
/// rest state and resolves once the device has answered its state request; `options.signal`
/// cancels it, and once connected closes the controller.
#[wasm_bindgen(js_name = connect, skip_typescript)]
pub async fn connect(model: String, options: JsValue) -> Result<JsValue, JsValue> {
    let model =
        Model::named(&model).ok_or_else(|| JsValue::from(js_sys::TypeError::new(&format!("no model {model:?}"))))?;
    let signal: Option<AbortSignal> = if options.is_undefined() || options.is_null() {
        None
    } else {
        js_sys::Reflect::get(&options, &"signal".into())?.dyn_into().ok()
    };
    let life = AbortController::new()?;
    let wait = either(&life.signal(), signal.clone());
    let navigator = navigator();
    if !js_sys::Reflect::has(&navigator, &"requestMIDIAccess".into())? {
        return Err(error(Error::Unsupported("this browser has no Web MIDI".into())));
    }
    let midi = MidiOptions::new();
    midi.set_sysex(true);
    let asked = navigator.request_midi_access_with_options(&midi)?;
    let refused = |e: JsValue| {
        if wait.aborted() { e } else { error(Error::Permission(format!("MIDI access: {}", text(&e)))) }
    };
    let access: MidiAccess = JsFuture::from(abortable(&asked, &wait)).await.map_err(refused)?.unchecked_into();
    let (input, output) = loop {
        if let Some(found) = ports(&access, model) {
            break found;
        }
        JsFuture::from(next_event(&access, "statechange", &wait)).await?;
    };
    for port in [input.unchecked_ref::<MidiPort>(), output.unchecked_ref()] {
        JsFuture::from(abortable(&port.open(), &wait)).await.map_err(|e| {
            if wait.aborted() {
                return e;
            }
            // Web MIDI API, MIDIPort.open(): InvalidAccessError where the port is unavailable, as another program holding it.
            let why = format!("{}: {}", port.name().unwrap_or_default(), text(&e));
            error(if name(&e) == "InvalidAccessError" { Error::Busy(why) } else { Error::Gone(why) })
        })?;
    }
    let session = Session::new(model, WebLink { output: output.clone() });
    let ports = Rc::new(listen(&session, access, input, output, signal.clone()));
    let lifetime = (session.clone(), ports.clone());
    spawn_local(async move {
        let (session, ports) = lifetime;
        let reason = session.closed().await;
        ports.detach();
        if reason != CloseReason::Unplugged {
            // A close nobody awaits has no one to report a port that fails to close to.
            let _ = ports.close().await;
        }
    });
    if let Err(e) = session.start().await {
        session.close(CloseReason::Closed);
        return Err(match &signal {
            Some(signal) if signal.aborted() => signal.reason(),
            _ => error(e),
        });
    }
    Ok(controller(&session, ports))
}

fn listen(
    session: &Session,
    access: MidiAccess,
    input: MidiInput,
    output: MidiOutput,
    signal: Option<AbortSignal>,
) -> Ports {
    let s = session.clone();
    let on_message =
        Closure::new(move |event: MidiMessageEvent| s.receive(&event.data().unwrap_or_default(), event.time_stamp()));
    input.set_onmidimessage(Some(on_message.as_ref().unchecked_ref()));
    let (s, ids) = (session.clone(), [input.id(), output.id()]);
    let on_state = Closure::new(move |event: MidiConnectionEvent| {
        let Some(port) = event.port() else { return };
        if ids.contains(&port.id()) && port.state() == MidiPortDeviceState::Disconnected {
            s.close(CloseReason::Unplugged);
        }
    });
    access.add_event_listener_with_callback("statechange", on_state.as_ref().unchecked_ref()).unwrap_throw();
    let on_abort = signal.map(|signal| {
        let s = session.clone();
        let abort = Closure::<dyn FnMut()>::new(move || s.close(CloseReason::Aborted));
        let once = AddEventListenerOptions::new();
        once.set_once(true);
        signal
            .add_event_listener_with_callback_and_add_event_listener_options(
                "abort",
                abort.as_ref().unchecked_ref(),
                &once,
            )
            .unwrap_throw();
        if signal.aborted() {
            session.close(CloseReason::Aborted);
        }
        (signal, abort)
    });
    Ports { access, input, output, _on_message: on_message, on_state, on_abort }
}

/// What `close` and `closed` are on a controller.
#[wasm_bindgen(skip_typescript)]
pub struct Lifecycle {
    session: Session,
    ports: Rc<Ports>,
}

#[wasm_bindgen]
impl Lifecycle {
    pub fn close(&self) -> Promise {
        let (session, ports) = (self.session.clone(), self.ports.clone());
        future_to_promise(async move {
            if session.reason().is_none() {
                session.close(CloseReason::Closed);
                ports.close().await?;
            }
            Ok(JsValue::UNDEFINED)
        })
    }
}

/// The controller object: the model's tree, `model`, `palette`, `closed`, `close`.
fn controller(session: &Session, ports: Rc<Ports>) -> JsValue {
    let closing = session.clone();
    let closed = future_to_promise(async move { Ok(to_js(&closing.closed().await)) });
    #[cfg(feature = "diagnostics")]
    let names = (ports.input.name(), ports.output.name());
    let lifecycle = JsValue::from(Lifecycle { session: session.clone(), ports });
    let root = crate::projection::controller(
        session,
        vec![
            ("model", JsValue::from(&session.model().name)),
            ("palette", PaletteView::of(&session.model().palette)),
            ("closed", closed.into()),
            ("close", method(&lifecycle, "close").into()),
        ],
    );
    #[cfg(feature = "diagnostics")]
    crate::inspect::register(root.unchecked_ref(), session, names);
    root
}
