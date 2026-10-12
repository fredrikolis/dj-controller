// Concern: the JS plumbing the transports share: abortable waits, typed errors, plain objects, the clock, the navigator | Non-concern: any port or device | IO: (ms, signals) -> promises
//! Globals are read off `globalThis`, so the same code runs in a page, a worker and Node.

use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

use js_sys::{Array, Object, Promise};
use wasm_bindgen::prelude::*;
use wasm_bindgen::{JsCast, UnwrapThrowExt};
use wasm_bindgen_futures::JsFuture;
use web_sys::{AbortController, AbortSignal, Navigator};

#[wasm_bindgen(inline_js = r#"
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}
export function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    promise.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value) },
      (error) => { signal.removeEventListener('abort', abort); reject(error) },
    )
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
  })
}
export function nextEvent(target, type, signal) {
  let listener
  return abortable(new Promise((resolve) => { listener = resolve; target.addEventListener(type, listener, { once: true }) }), signal)
    .finally(() => target.removeEventListener(type, listener))
}
export function either(signal, other) {
  return other ? AbortSignal.any([signal, other]) : signal
}
export function now() {
  return performance.now()
}
const pageClock = { now, sleep }
export function clockOf(options) {
  const clock = options?.clock
  if (clock === undefined) return pageClock
  if (typeof clock?.now !== 'function' || typeof clock?.sleep !== 'function') {
    throw new TypeError('options.clock must have now() and sleep(ms, signal)')
  }
  return clock
}
"#)]
extern "C" {
    pub fn abortable(promise: &Promise, signal: &AbortSignal) -> Promise;
    /// The next `type` event `target` dispatches.
    #[wasm_bindgen(js_name = nextEvent)]
    pub fn next_event(target: &web_sys::EventTarget, kind: &str, signal: &AbortSignal) -> Promise;
    pub fn either(signal: &AbortSignal, other: Option<AbortSignal>) -> AbortSignal;
    pub fn now() -> f64;

    /// The clock a controller's waits and lease steps run on: `options.clock`, else the page's.
    #[derive(Clone)]
    pub type Clock;
    #[wasm_bindgen(js_name = clockOf, catch)]
    pub fn clock_of(options: &JsValue) -> Result<Clock, JsValue>;
    #[wasm_bindgen(method)]
    pub fn now(this: &Clock) -> f64;
    #[wasm_bindgen(method)]
    fn sleep(this: &Clock, ms: f64, signal: &AbortSignal) -> Promise;
}

impl Clock {
    pub fn timer(&self, ms: f64) -> Pin<Box<dyn Future<Output = ()>>> {
        let cancel = AbortController::new().unwrap_throw();
        Box::pin(Sleep { wait: JsFuture::from(self.sleep(ms, &cancel.signal())), cancel })
    }
}

/// Dropped before it is over, it aborts the signal its clock was given, so a lost race leaves no timer behind.
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

/// The error every promise of the driver rejects with, but for an abort (the signal's reason) and
/// a caller breaking its types (a `TypeError`); `code` is in the `ControllerError` type.
pub fn error(code: &str, message: &str) -> JsValue {
    let error = js_sys::Error::new(message);
    error.set_name("ControllerError");
    js_sys::Reflect::set(&error, &"code".into(), &code.into()).unwrap_throw();
    error.into()
}

pub fn navigator() -> Navigator {
    js_sys::Reflect::get(&js_sys::global(), &"navigator".into()).unwrap_throw().unchecked_into()
}

pub fn text(e: &JsValue) -> String {
    e.as_string()
        .or_else(|| e.dyn_ref::<js_sys::Error>().map(|e| e.message().into()))
        .unwrap_or_else(|| format!("{e:?}"))
}

/// A DOM exception's or error's `name`.
pub fn name(e: &JsValue) -> String {
    js_sys::Reflect::get(e, &"name".into()).ok().and_then(|n| n.as_string()).unwrap_or_default()
}

pub fn object(fields: Vec<(&str, JsValue)>) -> Object {
    let pairs: Array = fields.into_iter().map(|(k, v)| Array::of2(&k.into(), &v)).collect();
    Object::from_entries(&pairs).expect_throw("every key is a string and every pair two long")
}
