// Concern: the typed handles each model's tree is built of: buttons, pads, faders, switches, encoders, outputs, deck modes | Non-concern: which control is which, the session | IO: (Session) -> streams
use std::marker::PhantomData;

use serde::Serialize;

use crate::decode::Value;
use crate::error::Error;
use crate::lease::{Lease, Pattern};
use crate::output::{Output, Show};
use crate::session::{Feed, Item, Session, Signal, Want, Write};
use crate::state::Turned;

/// A control's identity as its events carry it.
pub trait Identity: Copy + Serialize + 'static {
    fn of(row: usize) -> Self;
}

/// A 0-based index, or a pad mode, from its position.
pub trait Indexed: Copy + Serialize + 'static {
    fn at(index: usize) -> Self;
}

#[derive(Clone)]
pub struct Leaf {
    session: Session,
    object: usize,
    rows: &'static [usize],
    bank: bool,
}

impl Leaf {
    pub fn new(session: &Session, object: usize, rows: &'static [usize], bank: bool) -> Leaf {
        Leaf { session: session.clone(), object, rows, bank }
    }

    /// None for a view of one bank.
    pub fn physical(&self) -> Option<usize> {
        (!self.bank).then_some(self.object)
    }

    pub fn of(&self, session: &Session) -> bool {
        self.session.same(session)
    }

    fn write(&self, value: Write) -> Result<(), Error> {
        self.session.write(self.object, self.bank.then(|| self.rows[0]), value)
    }

    fn play<T: Copy>(&self, pattern: &Pattern<T>, write: fn(T) -> Write) -> Result<Lease, Error> {
        let steps: Vec<(Write, f64)> = pattern.steps.iter().map(|&(value, ms)| (write(value), ms)).collect();
        Lease::start(
            &self.session,
            self.object,
            self.bank.then(|| self.rows[0]),
            &steps,
            pattern.repeat,
            pattern.origin,
        )
    }

    fn told<T>(&self, of: fn(Output) -> T) -> Option<T> {
        self.session.told_on(self.object, self.bank.then(|| self.rows[0])).map(of)
    }

    fn base<T>(&self, of: fn(Output) -> T) -> Option<T> {
        self.session.base_on(self.object, self.bank.then(|| self.rows[0])).map(of)
    }

    /// Each change of `read`, from now on.
    fn changes<T: PartialEq + Clone + 'static>(&self, read: impl Fn(&Leaf) -> Option<T> + 'static) -> Feed<Option<T>> {
        let (leaf, mut last) = (self.clone(), read(self));
        self.session.feed(Want::Telling(self.session.model(), self.rows), move |_, _| {
            let now = read(&leaf);
            (now != last).then(|| {
                last = now.clone();
                now
            })
        })
    }

    fn feed<T: 'static>(
        &self,
        mut map: impl FnMut(usize, Value, f64, Option<Released>) -> Option<T> + 'static,
    ) -> Feed<T> {
        self.session.feed(Want::Rows(self.rows), move |_, item| match item {
            Item::Control { row, value, time, released } => map(row, value, time, released),
            _ => None,
        })
    }
}

/// An output's last telling, as its write takes it: what the device was told, not what it shows,
/// on the unshifted bank showing now or the bank a view names; none until told there. Its base
/// shows there once no lease holds it.
pub trait Telling {
    type Value;
    fn told(&self) -> Option<Self::Value>;
    fn told_changes(&self) -> Feed<Option<Self::Value>>;
    fn base(&self) -> Option<Self::Value>;
    fn base_changes(&self) -> Feed<Option<Self::Value>>;
}

fn led(output: Output) -> bool {
    output.show == Show::Led(true)
}

fn colour(output: Output) -> u8 {
    match output.show {
        Show::Colour(colour) => colour,
        show => unreachable!("{show:?} told a colour output"),
    }
}

fn value(output: Output) -> f64 {
    match output.show {
        Show::Value(raw) => output.control.shows.as_ref().map_or(f64::from(raw), |shows| shows.shown(raw)),
        show => unreachable!("{show:?} told a value output"),
    }
}

macro_rules! telling {
    ($ty:ty, $leaf:ident $(. $field:ident)?, $value:ty, $of:ident $(, $id:ident)?) => {
        impl$(<$id: Identity>)? Telling for $ty {
            type Value = $value;
            fn told(&self) -> Option<$value> {
                self$(.$field)?.$leaf.told($of)
            }
            fn told_changes(&self) -> Feed<Option<$value>> {
                self$(.$field)?.$leaf.changes(|leaf| leaf.told($of))
            }
            fn base(&self) -> Option<$value> {
                self$(.$field)?.$leaf.base($of)
            }
            fn base_changes(&self) -> Feed<Option<$value>> {
                self$(.$field)?.$leaf.changes(|leaf| leaf.base($of))
            }
        }
    };
}

/// A pattern as a lease on the unshifted bank showing, moving as it changes, or a view's: the newest
/// lease shows; a write under one sets the base, shown once all leases end.
pub trait Play {
    type Value: Copy;
    fn play(&self, pattern: &Pattern<Self::Value>) -> impl Future<Output = Result<Lease, Error>>;
}

macro_rules! play {
    ($ty:ty, $leaf:ident $(. $field:ident)?, $value:ty, $write:expr $(, $id:ident)?) => {
        impl$(<$id: Identity>)? Play for $ty {
            type Value = $value;
            fn play(&self, pattern: &Pattern<$value>) -> impl Future<Output = Result<Lease, Error>> {
                std::future::ready(self$(.$field)?.$leaf.play(pattern, $write))
            }
        }
    };
}

play!(LedButton<I>, leaf.button, bool, Write::Led, I);
play!(ColourPad<I>, leaf.pad, f64, Write::Colour, I);
play!(LedOut, leaf, bool, Write::Led);
play!(ColourOut, leaf, f64, Write::Colour);
play!(ValueOut, leaf, f64, Write::Value);

telling!(LedButton<I>, leaf.button, bool, led, I);
telling!(ColourPad<I>, leaf.pad, u8, colour, I);
telling!(LedOut, leaf, bool, led);
telling!(ColourOut, leaf, u8, colour);
telling!(ValueOut, leaf, f64, value);

/// Completes with the time the press is released, or the controller closes, on the link's clock.
pub type Released = Signal<f64>;

/// `time` as a [`Tick`]'s.
#[derive(Clone, Serialize)]
pub struct Press<I> {
    #[serde(flatten)]
    pub id: I,
    pub time: f64,
    #[serde(skip)]
    pub released: Released,
}

#[derive(Clone, Serialize)]
pub struct Hit<I> {
    #[serde(flatten)]
    pub id: I,
    /// 1 to 127.
    pub velocity: u8,
    pub time: f64,
    #[serde(skip)]
    pub released: Released,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct SwitchChange {
    pub on: bool,
    pub time: f64,
}

#[derive(Clone, Copy, Serialize)]
pub struct Turn<I> {
    #[serde(flatten)]
    pub id: I,
    /// Signed, as the device counts them.
    pub ticks: i8,
}

/// A relative control's ticks since the start, summed exactly, and its latest.
#[derive(Clone, Copy, Serialize)]
pub struct Position<I> {
    pub ticks: i64,
    pub latest: Option<Tick<I>>,
}

#[derive(Clone, Copy, Serialize)]
pub struct Tick<I> {
    #[serde(flatten)]
    pub id: I,
    pub time: f64,
}

/// A whole value, or a 14-bit half whose partner did not follow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    Whole(u16),
    Msb(u8),
    Lsb(u8),
}

impl Level {
    pub fn of(value: Value) -> Level {
        match value {
            Value::Msb(msb) => Level::Msb(msb),
            Value::Lsb(lsb) => Level::Lsb(lsb),
            Value::Absolute(v) => Level::Whole(v),
            other => unreachable!("{other:?} is no absolute value"),
        }
    }
}

#[derive(Clone)]
pub struct Button<I> {
    leaf: Leaf,
    id: PhantomData<fn() -> I>,
}

impl<I: Identity> From<Leaf> for Button<I> {
    fn from(leaf: Leaf) -> Self {
        Button { leaf, id: PhantomData }
    }
}

impl<I: Identity> Button<I> {
    pub fn leaf(&self) -> &Leaf {
        &self.leaf
    }

    pub fn pressed(&self) -> bool {
        self.leaf.session.latest(self.leaf.rows) == Some(Value::Button(true))
    }

    pub fn presses(&self) -> Feed<Press<I>> {
        self.leaf.feed(|row, value, time, released| {
            (value == Value::Button(true)).then(|| Press {
                id: I::of(row),
                time,
                released: released.unwrap_or_default(),
            })
        })
    }

    pub async fn next_press(&self) -> Result<Press<I>, Error> {
        let mut presses = self.presses();
        let next =
            std::future::poll_fn(|cx| futures_core::Stream::poll_next(std::pin::Pin::new(&mut presses), cx)).await;
        next.ok_or_else(|| Error::Closed(self.leaf.session.reason().expect("a feed ends at the close")))
    }
}

/// A button with an LED.
#[derive(Clone)]
pub struct LedButton<I> {
    pub button: Button<I>,
}

impl<I: Identity> From<Leaf> for LedButton<I> {
    fn from(leaf: Leaf) -> Self {
        LedButton { button: Button::from(leaf) }
    }
}

impl<I> std::ops::Deref for LedButton<I> {
    type Target = Button<I>;
    fn deref(&self) -> &Button<I> {
        &self.button
    }
}

impl<I: Identity> LedButton<I> {
    /// Writes its unshifted layer, or the bank a view names; a held shift never moves it.
    pub async fn led(&self, on: bool) -> Result<(), Error> {
        self.button.leaf.write(Write::Led(on))
    }
}

#[derive(Clone)]
pub struct Pad<I> {
    leaf: Leaf,
    id: PhantomData<fn() -> I>,
}

impl<I: Identity> From<Leaf> for Pad<I> {
    fn from(leaf: Leaf) -> Self {
        Pad { leaf, id: PhantomData }
    }
}

impl<I: Identity> Pad<I> {
    pub fn leaf(&self) -> &Leaf {
        &self.leaf
    }

    pub fn hits(&self) -> Feed<Hit<I>> {
        self.leaf.feed(|row, value, time, released| match value {
            Value::Pad(velocity) if velocity > 0 => {
                Some(Hit { id: I::of(row), velocity, time, released: released.unwrap_or_default() })
            }
            _ => None,
        })
    }
}

/// A pad that takes a colour.
#[derive(Clone)]
pub struct ColourPad<I> {
    pub pad: Pad<I>,
}

impl<I: Identity> From<Leaf> for ColourPad<I> {
    fn from(leaf: Leaf) -> Self {
        ColourPad { pad: Pad::from(leaf) }
    }
}

impl<I> std::ops::Deref for ColourPad<I> {
    type Target = Pad<I>;
    fn deref(&self) -> &Pad<I> {
        &self.pad
    }
}

impl<I: Identity> ColourPad<I> {
    /// Writes the unshifted bank showing now, or the bank a view names; 0 to 127, the model's palette, any
    /// other number refused.
    pub async fn colour(&self, colour: f64) -> Result<(), Error> {
        self.pad.leaf.write(Write::Colour(colour))
    }
}

/// One position of a selector, or a state the device reports.
#[derive(Clone)]
pub struct Switch {
    leaf: Leaf,
}

impl From<Leaf> for Switch {
    fn from(leaf: Leaf) -> Self {
        Switch { leaf }
    }
}

impl Switch {
    pub fn leaf(&self) -> &Leaf {
        &self.leaf
    }

    /// None until the device reports it.
    pub fn on(&self) -> Option<bool> {
        match self.leaf.session.latest(self.leaf.rows) {
            Some(Value::Switch(on)) => Some(on),
            _ => None,
        }
    }

    pub fn changes(&self) -> Feed<SwitchChange> {
        self.leaf.feed(|_, value, time, _| Some(SwitchChange { on: value == Value::Switch(true), time }))
    }
}

/// A fader or knob at full resolution, 0 to `max`.
#[derive(Clone)]
pub struct Absolute {
    leaf: Leaf,
}

impl From<Leaf> for Absolute {
    fn from(leaf: Leaf) -> Self {
        Absolute { leaf }
    }
}

impl Absolute {
    pub fn leaf(&self) -> &Leaf {
        &self.leaf
    }

    /// None until the device reports it; a lone 14-bit half keeps the other half last reported.
    pub fn value(&self) -> Option<u16> {
        match self.leaf.session.latest(self.leaf.rows) {
            Some(Value::Absolute(v)) => Some(v),
            _ => None,
        }
    }

    pub fn max(&self) -> u16 {
        let wide = self.leaf.session.model().controls()[self.leaf.rows[0]].lsb.is_some();
        if wide { 0x3FFF } else { 0x7F }
    }

    /// The latest value, read after each report of it.
    pub fn changes(&self) -> Feed<u16> {
        let rows = self.leaf.rows;
        self.leaf.session.feed(Want::Latest(rows), move |session, _| match session.latest(rows) {
            Some(Value::Absolute(v)) => Some(v),
            _ => None,
        })
    }
}

#[derive(Clone)]
pub struct Relative<I> {
    leaf: Leaf,
    id: PhantomData<fn() -> I>,
}

impl<I: Identity> From<Leaf> for Relative<I> {
    fn from(leaf: Leaf) -> Self {
        Relative { leaf, id: PhantomData }
    }
}

impl<I: Identity> Relative<I> {
    pub fn leaf(&self) -> &Leaf {
        &self.leaf
    }

    pub fn position(&self) -> Position<I> {
        position(self.leaf.session.turned(self.leaf.rows))
    }

    pub fn revolution(&self) -> Option<u32> {
        self.leaf.session.model().revolution(self.leaf.rows).map(|r| r.ticks)
    }

    /// The latest position of each run of ticks on one layer.
    pub fn positions(&self) -> Feed<Position<I>> {
        self.leaf.session.feed(Want::Turned(self.leaf.rows), |_, item| match item {
            Item::Turned(turned) => Some(position(turned)),
            _ => None,
        })
    }

    pub fn turns(&self) -> Feed<Turn<I>> {
        self.leaf.feed(|row, value, _, _| Some(Turn { id: I::of(row), ticks: value.ticks() }))
    }
}

fn position<I: Identity>(turned: Turned) -> Position<I> {
    Position { ticks: turned.ticks, latest: turned.latest.map(|(row, time)| Tick { id: I::of(row), time }) }
}

/// An LED with no button of its own.
#[derive(Clone)]
pub struct LedOut {
    leaf: Leaf,
}

impl From<Leaf> for LedOut {
    fn from(leaf: Leaf) -> Self {
        LedOut { leaf }
    }
}

impl LedOut {
    pub async fn set(&self, on: bool) -> Result<(), Error> {
        self.leaf.write(Write::Led(on))
    }
}

/// A colour with no pad of its own.
#[derive(Clone)]
pub struct ColourOut {
    leaf: Leaf,
}

impl From<Leaf> for ColourOut {
    fn from(leaf: Leaf) -> Self {
        ColourOut { leaf }
    }
}

impl ColourOut {
    pub async fn set(&self, colour: f64) -> Result<(), Error> {
        self.leaf.write(Write::Colour(colour))
    }
}

/// A value the device shows, as a jog screen's BPM: written as the unit shows it where the model
/// file says how, else raw.
#[derive(Clone)]
pub struct ValueOut {
    leaf: Leaf,
}

impl From<Leaf> for ValueOut {
    fn from(leaf: Leaf) -> Self {
        ValueOut { leaf }
    }
}

impl ValueOut {
    pub async fn set(&self, value: f64) -> Result<(), Error> {
        self.leaf.write(Write::Value(value))
    }

    /// The model file's `range`, as `set` takes and `told` gives it: shown where the file says how,
    /// else raw. None where the file lists only `values`.
    pub fn range(&self) -> Option<[f64; 2]> {
        let control = &self.leaf.session.model().controls()[self.leaf.rows[0]];
        let shown = |raw: u16| control.shows.as_ref().map_or(f64::from(raw), |shows| shows.shown(raw));
        control.range.map(|[lo, hi]| [shown(lo), shown(hi)])
    }
    pub fn labels(&self) -> &[String] {
        &self.leaf.session.model().controls()[self.leaf.rows[0]].labels
    }
}

/// What an owner of pad modes shows: its pad mode and page where the device has told them, and shift.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shown<M, P> {
    pub mode: Option<M>,
    pub page: Option<P>,
    /// The page is taken, not told, until a pad or PAGE press names it.
    pub page_assumed: bool,
    pub shift: bool,
}

#[derive(Clone)]
pub struct Owner {
    session: Session,
    index: usize,
}

impl Owner {
    pub fn new(session: &Session, index: usize) -> Owner {
        Owner { session: session.clone(), index }
    }

    pub fn shown<M: Indexed, P: Indexed>(&self) -> Shown<M, P> {
        let shown = self.session.shown(self.index);
        Shown {
            mode: shown.mode.map(M::at),
            page: shown.page.map(P::at),
            page_assumed: shown.page_assumed,
            shift: shown.shift,
        }
    }

    pub fn changes<M: Indexed, P: Indexed>(&self) -> Feed<Shown<M, P>> {
        let owner = self.clone();
        self.session.feed(Want::Owner(self.index), move |_, _| Some(owner.shown()))
    }
}
