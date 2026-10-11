// Concern: a virtual controller: a session with no device behind it, its tree, its gestures as JS | Non-concern: which message a gesture is (the core) | IO: (model) -> controller; gestures -> session
use std::cell::RefCell;
use std::future::Future;
use std::pin::Pin;

use dj_controller_core::controls::Leaf;
use dj_controller_core::error::{CloseReason, Error};
use dj_controller_core::model::Model;
use dj_controller_core::session::{Link, Session};
use dj_controller_core::virtual_unit::{Gesture, Layer, VirtualUnit};
use js_sys::{Array, Reflect, TypeError, WeakMap};
use wasm_bindgen::prelude::*;
use wasm_bindgen::{JsCast, UnwrapThrowExt};
use wasm_bindgen_futures::{future_to_promise, spawn_local};
use web_sys::{AbortSignal, AddEventListenerOptions};

use crate::connect::timer;
use crate::glue::{PaletteView, error, method, to_js};
use crate::js::now;

/// A link nothing listens on: every send succeeds and goes nowhere.
struct NoDevice;

impl Link for NoDevice {
    fn send(&self, _: &[u8], _: Option<f64>) -> Result<(), String> {
        Ok(())
    }

    fn now(&self) -> f64 {
        now()
    }

    fn sleep(&self, ms: f64) -> Pin<Box<dyn Future<Output = ()>>> {
        timer(ms)
    }
}

thread_local! {
    /// While a virtual controller's tree is built: its session and each physical control's object by its JS handle.
    static PLACING: RefCell<Option<(Session, WeakMap)>> = const { RefCell::new(None) };
}

/// Notes `handle` as `leaf`'s physical control where a virtual controller's tree is being built.
pub fn place(handle: JsValue, leaf: &Leaf) -> JsValue {
    PLACING.with_borrow(|placing| {
        if let Some((session, places)) = placing
            && leaf.of(session)
            && let Some(object) = leaf.physical()
        {
            places.set(handle.unchecked_ref(), &JsValue::from(object as u32));
        }
    });
    handle
}

/// A controller of `model` with no device behind it: every output told its rest state and every
/// control reported where the model file rests it, before it resolves; `options.signal` closes it.
#[wasm_bindgen(js_name = virtual, skip_typescript)]
pub fn virtual_controller(model: String, options: JsValue) -> Result<JsValue, JsValue> {
    let model = Model::named(&model).ok_or_else(|| JsValue::from(TypeError::new(&format!("no model {model:?}"))))?;
    let signal: Option<AbortSignal> = if options.is_undefined() || options.is_null() {
        None
    } else {
        Reflect::get(&options, &"signal".into())?.dyn_into().ok()
    };
    if let Some(signal) = signal.as_ref().filter(|s| s.aborted()) {
        return Err(signal.reason());
    }
    let session = Session::new(model, NoDevice);
    let unit = VirtualUnit::new(&session).map_err(error)?;
    unit.start().map_err(error)?;
    if let Some(signal) = signal {
        let closing = session.clone();
        let abort = Closure::<dyn FnMut()>::new(move || closing.close(CloseReason::Aborted));
        let once = AddEventListenerOptions::new();
        once.set_once(true);
        signal
            .add_event_listener_with_callback_and_add_event_listener_options(
                "abort",
                abort.as_ref().unchecked_ref(),
                &once,
            )
            .unwrap_throw();
        let ended = session.clone();
        spawn_local(async move {
            ended.closed().await;
            signal.remove_event_listener_with_callback("abort", abort.as_ref().unchecked_ref()).unwrap_throw();
        });
    }
    let places = WeakMap::new();
    let closing = session.clone();
    let closed = future_to_promise(async move { Ok(to_js(&closing.closed().await)) });
    let lifecycle = JsValue::from(VirtualLifecycle(session.clone()));
    let gestures = JsValue::from(VirtualGestures { unit, places: places.clone() });
    PLACING.set(Some((session.clone(), places)));
    let root = crate::projection::controller(
        &session,
        vec![
            ("model", JsValue::from(&model.name)),
            ("palette", PaletteView::of(&model.palette)),
            ("closed", closed.into()),
            ("close", method(&lifecycle, "close").into()),
            ("virtual", gestures),
        ],
    );
    PLACING.set(None);
    Ok(root)
}

#[wasm_bindgen(skip_typescript)]
pub struct VirtualLifecycle(Session);

#[wasm_bindgen]
impl VirtualLifecycle {
    pub fn close(&self) -> js_sys::Promise {
        self.0.close(CloseReason::Closed);
        js_sys::Promise::resolve(&JsValue::UNDEFINED)
    }
}

/// What `virtual` is on a virtual controller.
#[wasm_bindgen(skip_typescript)]
pub struct VirtualGestures {
    unit: VirtualUnit,
    places: WeakMap,
}

fn mistyped(what: &str) -> JsValue {
    TypeError::new(what).into()
}

fn layer(options: &JsValue) -> Result<Layer, JsValue> {
    if options.is_undefined() {
        return Ok(Layer::default());
    }
    let rest = Reflect::get(options, &"layer".into())?;
    let index = Reflect::get(options, &"index".into())?;
    Ok(Layer {
        rest: match rest.is_undefined() {
            true => String::new(),
            false => rest.as_string().ok_or_else(|| mistyped("a gesture's layer is a string"))?,
        },
        index: match index.is_undefined() {
            true => None,
            false => Some(whole(&index, "a gesture's index")? as usize),
        },
    })
}

fn whole(value: &JsValue, what: &str) -> Result<f64, JsValue> {
    value.as_f64().filter(|n| n.fract() == 0.0).ok_or_else(|| mistyped(&format!("{what} is a whole number")))
}

impl VirtualGestures {
    fn object(&self, control: &JsValue) -> Result<usize, JsValue> {
        let placed = control.is_object().then(|| self.places.get(control.unchecked_ref())).and_then(|o| o.as_f64());
        let refused = "no physical control of this virtual controller: a gesture takes a control of its own tree, never a bank view or another controller's";
        placed.map(|o| o as usize).ok_or_else(|| error(Error::Refused(refused.into())))
    }

    fn act(&self, control: &JsValue, gesture: Gesture) -> Result<(), JsValue> {
        self.unit.act(self.object(control)?, &gesture).map_err(error)
    }
}

#[wasm_bindgen]
impl VirtualGestures {
    pub fn press(&self, control: JsValue, options: JsValue) -> Result<(), JsValue> {
        self.act(&control, Gesture::Press(layer(&options)?))
    }

    pub fn release(&self, control: JsValue) -> Result<(), JsValue> {
        self.act(&control, Gesture::Release)
    }

    pub fn hit(&self, control: JsValue, velocity: JsValue) -> Result<(), JsValue> {
        let velocity = whole(&velocity, "a hit's velocity")?;
        if !(1.0..=127.0).contains(&velocity) {
            return Err(error(Error::Refused(format!("a hit's velocity is 1 to 127, not {velocity}"))));
        }
        self.act(&control, Gesture::Hit(velocity as u8))
    }

    pub fn lift(&self, control: JsValue) -> Result<(), JsValue> {
        self.act(&control, Gesture::Lift)
    }

    #[wasm_bindgen(js_name = move)]
    pub fn move_to(&self, control: JsValue, value: JsValue) -> Result<(), JsValue> {
        let value = whole(&value, "a move's value")?;
        if !(0.0..=f64::from(u16::MAX)).contains(&value) {
            return Err(error(Error::Refused(format!("a move's value is 0 to the control's max, not {value}"))));
        }
        self.act(&control, Gesture::Move(value as u16))
    }

    pub fn turn(&self, control: JsValue, ticks: JsValue, options: JsValue) -> Result<(), JsValue> {
        let ticks = whole(&ticks, "a turn's ticks")?;
        self.act(&control, Gesture::Turn(ticks as i64, layer(&options)?))
    }

    pub fn flip(&self, control: JsValue, on: JsValue) -> Result<(), JsValue> {
        let on = on.as_bool().ok_or_else(|| mistyped("a flip is true or false"))?;
        self.act(&control, Gesture::Flip(on))
    }

    pub fn flips(&self, control: JsValue) -> Result<JsValue, JsValue> {
        Ok(match self.unit.selects(self.object(&control)?) {
            Some(true) => "selector".into(),
            Some(false) => "toggle".into(),
            None => JsValue::UNDEFINED,
        })
    }

    pub fn layers(&self, control: JsValue) -> Result<Array, JsValue> {
        Ok(self.unit.layers(self.object(&control)?).iter().map(|l| JsValue::from(l.as_str())).collect())
    }
}
