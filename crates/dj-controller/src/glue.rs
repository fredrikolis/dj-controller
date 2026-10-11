// Concern: projects the core's typed handles into JS: a class per control kind, feeds and leases a signal ends, events and errors | Non-concern: which controls a model has | IO: handles -> JS
//! The TypeScript for what this hands out is the generator's control interfaces and lib.rs's value
//! types, item for item: `Button<Id>` is the core's `Button<I>`, a `Press<Id>` its `Press<I>`.

use std::cell::{Cell, RefCell};
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Poll, Waker};

use dj_controller_core::controls::{
    Absolute, ColourOut, ColourPad, Identity, LedButton, LedOut, Pad, Play, Relative, Shown, Switch, Telling, ValueOut,
};
use dj_controller_core::controls::{Button, Hit, Press, Released};
use dj_controller_core::error::Error;
use dj_controller_core::lease::{Lease, Pattern};
use dj_controller_core::model::{Model, Palette};
use dj_controller_core::session::Feed;

use futures_lite::{Stream, StreamExt};
use js_sys::{Array, Function, Object, Promise};
use serde::Serialize;
use wasm_bindgen::prelude::*;
use wasm_bindgen::{JsCast, UnwrapThrowExt};
use wasm_bindgen_futures::{future_to_promise, spawn_local};
use web_sys::{AbortSignal, AddEventListenerOptions};

use crate::js::{abortable, object};

#[wasm_bindgen(inline_js = r#"
export function iterable(it) { it[Symbol.asyncIterator] = function () { return this }; return it }
export function lease(dispose, ended) { return Object.freeze({ ended, [Symbol.asyncDispose]: dispose }) }
"#)]
extern "C" {
    fn iterable(it: JsValue) -> JsValue;
    fn lease(dispose: JsValue, ended: Promise) -> JsValue;
}

/// What a value of the core is as JS.
pub trait AsJs {
    fn as_js(&self) -> JsValue;
}

impl<T: AsJs, const N: usize> AsJs for [T; N] {
    fn as_js(&self) -> JsValue {
        let items: Array = self.iter().map(AsJs::as_js).collect();
        Object::freeze(&items).into()
    }
}

macro_rules! tuple {
    ($($t:ident $i:tt),+) => {
        impl<$($t: AsJs),+> AsJs for ($($t,)+) {
            fn as_js(&self) -> JsValue {
                let items = Array::new();
                $(items.push(&self.$i.as_js());)+
                Object::freeze(&items).into()
            }
        }
    };
}
tuple!(A 0, B 1);
tuple!(A 0, B 1, C 2);
tuple!(A 0, B 1, C 2, D 3);
tuple!(A 0, B 1, C 2, D 3, E 4, F 5, G 6, H 7);

/// A value as plain JS: structs as objects, `None` as undefined.
pub fn to_js<T: Serialize + ?Sized>(value: &T) -> JsValue {
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    let js = value.serialize(&serializer).expect_throw("every typed value serializes");
    if js.is_object() {
        Object::freeze(js.unchecked_ref::<Object>());
    }
    js
}

/// A core error as the `ControllerError` it rejects with.
pub fn error(e: Error) -> JsValue {
    crate::js::error(e.code().name(), &e.to_string())
}

fn released(signal: Released) -> Promise {
    future_to_promise(async move { Ok(JsValue::from(signal.await)) })
}

fn with_release<T: Serialize>(event: &T, release: Released) -> JsValue {
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    let js = event.serialize(&serializer).expect_throw("every event serializes");
    js_sys::Reflect::set(&js, &"released".into(), &released(release)).unwrap_throw();
    Object::freeze(js.unchecked_ref::<Object>());
    js
}

fn press_js<I: Identity>(press: Press<I>) -> JsValue {
    with_release(&press, press.released.clone())
}

fn hit_js<I: Identity>(hit: Hit<I>) -> JsValue {
    with_release(&hit, hit.released.clone())
}

/// The `signal` of a `Listen` options object, if given.
fn signal_of(options: &JsValue) -> Option<AbortSignal> {
    if options.is_undefined() || options.is_null() {
        return None;
    }
    let signal = js_sys::Reflect::get(options, &"signal".into()).unwrap_throw();
    (!signal.is_undefined()).then(|| signal.unchecked_into())
}

type Boxed = Pin<Box<dyn Stream<Item = JsValue>>>;

/// A feed as a JS AsyncIterator: `next` resolves with each item, the signal's abort or `return`
/// drops the feed, and its end takes its listener off the signal.
#[wasm_bindgen(skip_typescript)]
pub struct Iter {
    live: Rc<RefCell<Live>>,
    signal: Option<AbortSignal>,
    dropped: Rc<Cell<u64>>,
}

struct Live {
    stream: Option<Boxed>,
    waker: Option<Waker>,
    abort: Option<(AbortSignal, Closure<dyn FnMut()>)>,
}

impl Live {
    /// Drops the stream and takes the abort listener off its signal, handing back the listener's
    /// closure for the caller to drop outside it.
    fn end(&mut self) -> Option<Closure<dyn FnMut()>> {
        self.stream = None;
        let (signal, abort) = self.abort.take()?;
        signal.remove_event_listener_with_callback("abort", abort.as_ref().unchecked_ref()).unwrap_throw();
        Some(abort)
    }
}

impl Iter {
    pub fn feed<T: 'static>(feed: Feed<T>, map: impl Fn(T) -> JsValue + 'static, options: &JsValue) -> JsValue {
        let dropped = feed.dropped();
        Iter::of(feed, dropped, map, options)
    }

    /// `dropped` counts what the stream dropped unread.
    pub fn of<S: Stream + 'static>(
        stream: S,
        dropped: Rc<Cell<u64>>,
        map: impl Fn(S::Item) -> JsValue + 'static,
        options: &JsValue,
    ) -> JsValue {
        let live = Rc::new(RefCell::new(Live { stream: Some(Box::pin(stream.map(map))), waker: None, abort: None }));
        let signal = signal_of(options);
        if let Some(signal) = &signal {
            let ended = live.clone();
            let abort = Closure::<dyn FnMut()>::new(move || {
                let waker = {
                    let mut live = ended.borrow_mut();
                    live.stream = None;
                    live.waker.take()
                };
                waker.into_iter().for_each(Waker::wake);
            });
            if signal.aborted() {
                live.borrow_mut().stream = None;
            } else {
                let options = AddEventListenerOptions::new();
                options.set_once(true);
                signal
                    .add_event_listener_with_callback_and_add_event_listener_options(
                        "abort",
                        abort.as_ref().unchecked_ref(),
                        &options,
                    )
                    .unwrap_throw();
                live.borrow_mut().abort = Some((signal.clone(), abort));
            }
        }
        iterable(Iter { live, signal, dropped }.into())
    }
}

fn done(value: Option<JsValue>) -> JsValue {
    object(vec![("done", value.is_none().into()), ("value", value.unwrap_or(JsValue::UNDEFINED))]).into()
}

#[wasm_bindgen]
impl Iter {
    pub fn next(&self) -> Promise {
        let live = self.live.clone();
        let next = future_to_promise(async move {
            let item = std::future::poll_fn(|cx| {
                let mut live = live.borrow_mut();
                live.waker = Some(cx.waker().clone());
                match live.stream.as_mut() {
                    Some(stream) => stream.as_mut().poll_next(cx),
                    None => Poll::Ready(None),
                }
            })
            .await;
            if item.is_none() {
                let listener = live.borrow_mut().end();
                drop(listener);
            }
            Ok(done(item))
        });
        match &self.signal {
            Some(signal) => abortable(&next, signal),
            None => next,
        }
    }

    #[wasm_bindgen(js_name = return)]
    pub fn finish(&self) -> Promise {
        let listener = self.live.borrow_mut().end();
        drop(listener);
        Promise::resolve(&done(None))
    }

    /// How many items the feed dropped unread.
    #[wasm_bindgen(getter)]
    pub fn dropped(&self) -> f64 {
        self.dropped.get() as f64
    }
}

/// A future of the core as a promise the signal's abort rejects.
pub fn promise<F>(future: F, options: &JsValue) -> Promise
where
    F: std::future::Future<Output = Result<JsValue, JsValue>> + 'static,
{
    let promise = future_to_promise(future);
    match signal_of(options) {
        Some(signal) => abortable(&promise, &signal),
        None => promise,
    }
}

/// An output's `told`, `base` and their changes, for its class to carry.
#[derive(Clone)]
struct Told {
    told: Rc<dyn Fn() -> JsValue>,
    changes: Rc<dyn Fn(&JsValue) -> JsValue>,
    base: Rc<dyn Fn() -> JsValue>,
    base_changes: Rc<dyn Fn(&JsValue) -> JsValue>,
}

impl Told {
    fn of<T: Telling + Clone + 'static>(output: &T) -> Told
    where
        T::Value: Serialize,
    {
        let [told, changes, base, base_changes] = [0; 4].map(|_| output.clone());
        Told {
            told: Rc::new(move || to_js(&told.told())),
            changes: Rc::new(move |options| Iter::feed(changes.told_changes(), |v| to_js(&v), options)),
            base: Rc::new(move || to_js(&base.base())),
            base_changes: Rc::new(move |options| Iter::feed(base_changes.base_changes(), |v| to_js(&v), options)),
        }
    }
}

macro_rules! told {
    ($class:ident) => {
        #[wasm_bindgen]
        impl $class {
            #[wasm_bindgen(getter)]
            pub fn told(&self) -> JsValue {
                (self.told.told)()
            }
            #[wasm_bindgen(js_name = toldChanges)]
            pub fn told_changes(&self, options: JsValue) -> JsValue {
                (self.told.changes)(&options)
            }
            #[wasm_bindgen(getter)]
            pub fn base(&self) -> JsValue {
                (self.told.base)()
            }
            #[wasm_bindgen(js_name = baseChanges)]
            pub fn base_changes(&self, options: JsValue) -> JsValue {
                (self.told.base_changes)(&options)
            }
        }
    };
}

/// An output's `play` as JS calls it: a pattern of the wrong JS shape rejects with a `TypeError`,
/// a signal already aborted with its reason, every other the core takes or refuses.
type Player = Rc<dyn Fn(JsValue, JsValue) -> Promise>;

fn player<P: Play + Clone + 'static>(output: &P, read: fn(&JsValue) -> Option<P::Value>) -> Player {
    let output = output.clone();
    Rc::new(move |js: JsValue, options: JsValue| {
        let Some(pattern) = pattern(&js, read) else {
            return Promise::reject(&js_sys::TypeError::new("not a pattern this output takes").into());
        };
        let signal = signal_of(&options);
        if let Some(signal) = signal.as_ref().filter(|s| s.aborted()) {
            return Promise::reject(&signal.reason());
        }
        let output = output.clone();
        future_to_promise(async move {
            let lease = output.play(&pattern).await.map_err(error)?;
            match signal.as_ref().filter(|s| s.aborted()) {
                Some(aborted) => {
                    // Aborted while it started: ended at once, so no lease outlives its signal.
                    lease.end().map_err(error)?;
                    Err(aborted.reason())
                }
                None => Ok(lease_js(lease, signal)),
            }
        })
    })
}

/// `{ steps: [[value, ms], …], repeat?, origin? }`, each value as `read` takes it.
fn pattern<T>(js: &JsValue, read: fn(&JsValue) -> Option<T>) -> Option<Pattern<T>> {
    let field = |name: &str| js_sys::Reflect::get(js, &name.into()).ok();
    let steps = field("steps").filter(Array::is_array)?;
    let steps = Array::from(&steps)
        .iter()
        .map(|step| {
            let step = Array::is_array(&step).then(|| Array::from(&step)).filter(|s| s.length() == 2)?;
            Some((read(&step.get(0))?, step.get(1).as_f64()?))
        })
        .collect::<Option<Vec<_>>>()?;
    let repeat = field("repeat")?;
    let repeat = if repeat.is_undefined() { false } else { repeat.as_bool()? };
    let origin = field("origin")?;
    let origin = if origin.is_undefined() { None } else { Some(origin.as_f64()?) };
    Some(Pattern { steps, repeat, origin })
}

/// A lease as the frozen JS object `play` resolves to. Its run's task alone holds it, until it
/// ends, then takes its listener off the signal; the JS side reaches it weakly.
fn lease_js(lease: Lease, signal: Option<AbortSignal>) -> JsValue {
    let lease = Rc::new(lease);
    let abort = signal.map(|signal| {
        let aborted = Rc::downgrade(&lease);
        let abort = Closure::<dyn FnMut()>::new(move || {
            // An abort has no caller to hand a failed send to; the next write meets it.
            let _ = aborted.upgrade().map(|lease| lease.end());
        });
        let options = AddEventListenerOptions::new();
        options.set_once(true);
        signal
            .add_event_listener_with_callback_and_add_event_listener_options(
                "abort",
                abort.as_ref().unchecked_ref(),
                &options,
            )
            .unwrap_throw();
        (signal, abort)
    });
    let ended = lease.ended();
    let (running, lease) = (lease.clone(), Rc::downgrade(&lease));
    spawn_local(async move {
        running.run().await;
        if let Some((signal, abort)) = abort {
            signal.remove_event_listener_with_callback("abort", abort.as_ref().unchecked_ref()).unwrap_throw();
        }
    });
    let ended = future_to_promise(async move {
        ended.await;
        Ok(JsValue::UNDEFINED)
    });
    let dispose = Closure::<dyn FnMut() -> Promise>::new(move || match lease.upgrade().map(|l| l.end()) {
        Some(Err(e)) => Promise::reject(&error(e)),
        _ => Promise::resolve(&JsValue::UNDEFINED),
    });
    self::lease(dispose.into_js_value(), ended)
}

macro_rules! play {
    ($class:ident) => {
        #[wasm_bindgen]
        impl $class {
            pub fn play(&self, pattern: JsValue, options: JsValue) -> Promise {
                (self.play)(pattern, options)
            }
        }
    };
}

trait Pressing {
    fn pressed(&self) -> bool;
    fn presses(&self, options: &JsValue) -> JsValue;
    fn next_press(&self, options: &JsValue) -> Promise;
}

impl<I: Identity> Pressing for Button<I> {
    fn pressed(&self) -> bool {
        Button::pressed(self)
    }
    fn presses(&self, options: &JsValue) -> JsValue {
        Iter::feed(Button::presses(self), press_js, options)
    }
    fn next_press(&self, options: &JsValue) -> Promise {
        let button = self.clone();
        promise(async move { button.next_press().await.map(press_js).map_err(error) }, options)
    }
}

macro_rules! button {
    ($class:ident) => {
        #[wasm_bindgen]
        impl $class {
            #[wasm_bindgen(getter)]
            pub fn pressed(&self) -> bool {
                self.button.pressed()
            }
            pub fn presses(&self, options: JsValue) -> JsValue {
                self.button.presses(&options)
            }
            #[wasm_bindgen(js_name = nextPress)]
            pub fn next_press(&self, options: JsValue) -> Promise {
                self.button.next_press(&options)
            }
        }
    };
}

#[wasm_bindgen(skip_typescript)]
pub struct ButtonControl {
    button: Rc<dyn Pressing>,
}
button!(ButtonControl);

#[wasm_bindgen(skip_typescript)]
pub struct LedButtonControl {
    button: Rc<dyn Pressing>,
    led: Setter,
    told: Told,
    play: Player,
}
button!(LedButtonControl);
told!(LedButtonControl);
play!(LedButtonControl);

#[wasm_bindgen]
impl LedButtonControl {
    pub fn led(&self, on: JsValue) -> Promise {
        (self.led)(on)
    }
}

impl<I: Identity> AsJs for Button<I> {
    fn as_js(&self) -> JsValue {
        ButtonControl { button: Rc::new(self.clone()) }.into()
    }
}

impl<I: Identity> AsJs for LedButton<I> {
    fn as_js(&self) -> JsValue {
        let this = self.clone();
        let led = setter(JsValue::as_bool, move |on| {
            let this = this.clone();
            async move { this.led(on).await }
        });
        let play = player(self, JsValue::as_bool);
        LedButtonControl { button: Rc::new(self.button.clone()), led, told: Told::of(self), play }.into()
    }
}

#[wasm_bindgen(skip_typescript)]
pub struct PadControl {
    hits: Rc<dyn Fn(&JsValue) -> JsValue>,
}

#[wasm_bindgen]
impl PadControl {
    pub fn hits(&self, options: JsValue) -> JsValue {
        (self.hits)(&options)
    }
}

#[wasm_bindgen(skip_typescript)]
pub struct ColourPadControl {
    pad: PadControl,
    colour: Setter,
    told: Told,
    play: Player,
}
told!(ColourPadControl);
play!(ColourPadControl);

#[wasm_bindgen]
impl ColourPadControl {
    pub fn hits(&self, options: JsValue) -> JsValue {
        self.pad.hits(options)
    }
    pub fn colour(&self, colour: JsValue) -> Promise {
        (self.colour)(colour)
    }
}

fn pad<I: Identity>(pad: &Pad<I>) -> PadControl {
    let pad = pad.clone();
    PadControl { hits: Rc::new(move |options| Iter::feed(pad.hits(), hit_js, options)) }
}

impl<I: Identity> AsJs for Pad<I> {
    fn as_js(&self) -> JsValue {
        pad(self).into()
    }
}

impl<I: Identity> AsJs for ColourPad<I> {
    fn as_js(&self) -> JsValue {
        let this = self.clone();
        let colour = setter(JsValue::as_f64, move |c| {
            let this = this.clone();
            async move { this.colour(c).await }
        });
        ColourPadControl { pad: pad(&self.pad), colour, told: Told::of(self), play: player(self, JsValue::as_f64) }
            .into()
    }
}

#[wasm_bindgen(skip_typescript)]
pub struct SwitchControl(Switch);

#[wasm_bindgen]
impl SwitchControl {
    #[wasm_bindgen(getter)]
    pub fn on(&self) -> Option<bool> {
        self.0.on()
    }
    pub fn changes(&self, options: JsValue) -> JsValue {
        Iter::feed(self.0.changes(), |c| to_js(&c), &options)
    }
}

impl AsJs for Switch {
    fn as_js(&self) -> JsValue {
        SwitchControl(self.clone()).into()
    }
}

#[wasm_bindgen(skip_typescript)]
pub struct AbsoluteControl(Absolute);

#[wasm_bindgen]
impl AbsoluteControl {
    #[wasm_bindgen(getter)]
    pub fn value(&self) -> Option<u16> {
        self.0.value()
    }
    #[wasm_bindgen(getter)]
    pub fn max(&self) -> u16 {
        self.0.max()
    }
    pub fn changes(&self, options: JsValue) -> JsValue {
        Iter::feed(self.0.changes(), JsValue::from, &options)
    }
}

impl AsJs for Absolute {
    fn as_js(&self) -> JsValue {
        AbsoluteControl(self.clone()).into()
    }
}

#[wasm_bindgen(skip_typescript)]
pub struct RelativeControl {
    position: Rc<dyn Fn() -> JsValue>,
    revolution: Option<u32>,
    positions: Rc<dyn Fn(&JsValue) -> JsValue>,
    /// Each report as the device sent it, for the diagnostics' `turns`.
    #[cfg(feature = "diagnostics")]
    pub(crate) turns: Rc<dyn Fn(&JsValue) -> JsValue>,
}

#[wasm_bindgen]
impl RelativeControl {
    #[wasm_bindgen(getter)]
    pub fn position(&self) -> JsValue {
        (self.position)()
    }
    #[wasm_bindgen(getter)]
    pub fn revolution(&self) -> Option<u32> {
        self.revolution
    }
    pub fn positions(&self, options: JsValue) -> JsValue {
        (self.positions)(&options)
    }
}

impl<I: Identity> AsJs for Relative<I> {
    fn as_js(&self) -> JsValue {
        let (now, latest) = (self.clone(), self.clone());
        #[cfg(feature = "diagnostics")]
        let each = self.clone();
        RelativeControl {
            position: Rc::new(move || to_js(&now.position())),
            revolution: self.revolution(),
            positions: Rc::new(move |options| Iter::feed(latest.positions(), |p| to_js(&p), options)),
            #[cfg(feature = "diagnostics")]
            turns: Rc::new(move |options| Iter::feed(each.turns(), |t| to_js(&t), options)),
        }
        .into()
    }
}

#[wasm_bindgen(skip_typescript)]
pub struct OutputControl {
    set: Setter,
    told: Told,
    play: Player,
}
told!(OutputControl);
play!(OutputControl);

#[wasm_bindgen]
impl OutputControl {
    pub fn set(&self, value: JsValue) -> Promise {
        (self.set)(value)
    }
}

/// A write as JS calls it: a value of the wrong JS type rejects with a `TypeError`, every other
/// the core takes or refuses.
type Setter = Rc<dyn Fn(JsValue) -> Promise>;

fn setter<T: 'static, F>(read: fn(&JsValue) -> Option<T>, write: impl Fn(T) -> F + 'static) -> Setter
where
    F: std::future::Future<Output = Result<(), Error>> + 'static,
{
    Rc::new(move |v: JsValue| match read(&v) {
        Some(v) => {
            let written = write(v);
            future_to_promise(async move { written.await.map(|()| JsValue::UNDEFINED).map_err(error) })
        }
        None => Promise::reject(&js_sys::TypeError::new("not a value this output takes").into()),
    })
}

impl AsJs for LedOut {
    fn as_js(&self) -> JsValue {
        let this = self.clone();
        let set = setter(JsValue::as_bool, move |on| {
            let this = this.clone();
            async move { this.set(on).await }
        });
        OutputControl { set, told: Told::of(self), play: player(self, JsValue::as_bool) }.into()
    }
}

impl AsJs for ColourOut {
    fn as_js(&self) -> JsValue {
        let this = self.clone();
        let set = setter(JsValue::as_f64, move |c| {
            let this = this.clone();
            async move { this.set(c).await }
        });
        OutputControl { set, told: Told::of(self), play: player(self, JsValue::as_f64) }.into()
    }
}

/// A value output: an output with its model file's range.
#[wasm_bindgen(skip_typescript)]
pub struct ValueControl {
    set: Setter,
    told: Told,
    play: Player,
    range: Option<[f64; 2]>,
    labels: Vec<String>,
}
told!(ValueControl);
play!(ValueControl);

#[wasm_bindgen]
impl ValueControl {
    pub fn set(&self, value: JsValue) -> Promise {
        (self.set)(value)
    }
    #[wasm_bindgen(getter)]
    pub fn range(&self) -> JsValue {
        self.range.map_or(JsValue::UNDEFINED, |range| to_js(&range))
    }
    #[wasm_bindgen(getter)]
    pub fn labels(&self) -> JsValue {
        if self.labels.is_empty() { JsValue::UNDEFINED } else { to_js(&self.labels) }
    }
}

impl AsJs for ValueOut {
    fn as_js(&self) -> JsValue {
        let this = self.clone();
        let set = setter(JsValue::as_f64, move |v| {
            let this = this.clone();
            async move { this.set(v).await }
        });
        ValueControl {
            set,
            told: Told::of(self),
            play: player(self, JsValue::as_f64),
            range: self.range(),
            labels: self.labels().to_vec(),
        }
        .into()
    }
}

/// An owner's `mode` and `modeChanges`, for a group to carry.
#[wasm_bindgen(skip_typescript)]
pub struct Moded {
    mode: Rc<dyn Fn() -> JsValue>,
    changes: Rc<dyn Fn(&JsValue) -> JsValue>,
}

impl Moded {
    pub fn of<G, M, P>(group: G, mode: fn(&G) -> Shown<M, P>, changes: fn(&G) -> Feed<Shown<M, P>>) -> Moded
    where
        G: Clone + 'static,
        M: Serialize + 'static,
        P: Serialize + 'static,
    {
        let again = group.clone();
        Moded {
            mode: Rc::new(move || to_js(&mode(&group))),
            changes: Rc::new(move |options| Iter::feed(changes(&again), |s| to_js(&s), options)),
        }
    }
}

#[wasm_bindgen]
impl Moded {
    pub fn mode(&self) -> JsValue {
        (self.mode)()
    }
    #[wasm_bindgen(js_name = modeChanges)]
    pub fn mode_changes(&self, options: JsValue) -> JsValue {
        (self.changes)(&options)
    }
}

/// The model's palette, its lookup the model's own.
#[wasm_bindgen(skip_typescript, js_name = Palette)]
pub struct PaletteView(&'static Palette);

impl PaletteView {
    pub fn of(palette: &'static Option<Palette>) -> JsValue {
        palette.as_ref().map_or(JsValue::UNDEFINED, |p| PaletteView(p).into())
    }
}

#[wasm_bindgen(js_class = Palette)]
impl PaletteView {
    #[wasm_bindgen(getter)]
    pub fn source(&self) -> String {
        self.0.source.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn colours(&self) -> JsValue {
        to_js(&self.0.colours)
    }
    pub fn colour(&self, number: f64) -> Result<JsValue, JsValue> {
        palette_colour(Some(self.0), number)
    }
}

/// The palette of the model named `model`, read with no connection: undefined where its file states
/// none, a `TypeError` for a name no model has.
#[wasm_bindgen(js_name = palette, skip_typescript)]
pub fn model_palette(model: &str) -> Result<JsValue, JsValue> {
    let named = Model::named(model).ok_or_else(|| js_sys::TypeError::new(&format!("no model {model:?}")))?;
    Ok(PaletteView::of(&named.palette))
}

/// What colour `number` shows on `palette`: none where the palette names none, a `refused`
/// error where it is no colour number.
pub fn palette_colour(palette: Option<&Palette>, number: f64) -> Result<JsValue, JsValue> {
    let refused = |unfit| crate::js::error("refused", &format!("colour {number} {unfit}"));
    let number = dj_controller_core::output::colour(number).map_err(refused)?;
    Ok(to_js(&palette.and_then(|p| p.colour(number))))
}

/// `instance`'s `name` method, bound to it.
pub fn method(instance: &JsValue, name: &str) -> Function {
    let f: Function = js_sys::Reflect::get(instance, &name.into()).unwrap_throw().unchecked_into();
    f.bind0(instance)
}

/// A group of the tree: its members, and an owner's `mode` getter and `modeChanges`.
pub fn group(members: Vec<(&str, JsValue)>, moded: Option<Moded>) -> JsValue {
    let group = object(members);
    if let Some(moded) = moded {
        let moded = JsValue::from(moded);
        let getter = object(vec![("get", method(&moded, "mode").into()), ("enumerable", true.into())]);
        Object::define_property(&group, &"mode".into(), &getter);
        js_sys::Reflect::set(&group, &"modeChanges".into(), &method(&moded, "modeChanges")).unwrap_throw();
    }
    Object::freeze(&group).into()
}
