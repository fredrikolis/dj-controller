// Concern: one controller for its life over a transport's link: reports as streams, writes, the start's sync and state request | Non-concern: opening ports, the typed tree | IO: (bytes, Link) -> feeds
//! Single-threaded: a transport hands each message to `receive` and drives the futures itself.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, VecDeque};
use std::future::{Future, poll_fn};
use std::pin::{Pin, pin};
use std::rc::{Rc, Weak};
use std::task::{Context, Poll, Waker};

use futures_core::Stream;
use serde::Serialize;

use crate::decode::{Decoder, Event, Value};
use crate::error::{CloseReason, Error};
use crate::hid::Via as StepVia;
use crate::ledger::{Ledger, Told, Via};
use crate::midi::{self, Framer, Message};
use crate::model::{Model, OutputKind};
use crate::models;
use crate::output::{Output, OutputError, Show};
use crate::schedule::Schedule;
use crate::state::{Shown, State, Turned};
use crate::surface::surface;

/// Messages a sync spaces apart: DIN MIDI's rate, about one 3-byte message a ms (MIDI 1.0
/// Electrical Specification, 31.25 kbaud), assumed safe for USB; the FLX10's own limit is unmeasured.
pub const SYNC_GAP_MS: f64 = 1.0;
/// How long a state request waits for its first answer, and how long the answer may pause before
/// it counts as whole: guesses, unobserved; the FLX10's answer came within 4 s of an amidi send
/// (docs/research/flx10-observed.md), its messages' spacing is unmeasured.
const STATE_WAIT_MS: f64 = 5000.0;
const STATE_QUIET_MS: f64 = 150.0;

/// What a transport gives a session: a way to send, its clock, and a timer on that clock.
pub trait Link {
    /// Sends whole messages, at `at` ms on the link's clock where given, else now.
    fn send(&self, bytes: &[u8], at: Option<f64>) -> Result<(), String>;
    fn now(&self) -> f64;
    fn sleep(&self, ms: f64) -> Pin<Box<dyn Future<Output = ()>>>;
}

/// Fires once with a value, completing every wait on it with that value, before or after; a press's
/// release is one, with its time. Each clone waits on its own and, dropped unfired, leaves no waker.
pub struct Signal<T: Copy = ()> {
    shared: Rc<RefCell<Fired<T>>>,
    slot: Option<u64>,
}

struct Fired<T> {
    fired: Option<T>,
    next: u64,
    wakers: Vec<(u64, Waker)>,
}

impl<T: Copy> Default for Signal<T> {
    fn default() -> Signal<T> {
        Signal { shared: Rc::new(RefCell::new(Fired { fired: None, next: 0, wakers: Vec::new() })), slot: None }
    }
}

impl<T: Copy> Clone for Signal<T> {
    fn clone(&self) -> Signal<T> {
        Signal { shared: self.shared.clone(), slot: None }
    }
}

impl<T: Copy> Signal<T> {
    /// Fires with `value`, unless it has fired already.
    pub(crate) fn fire(&self, value: T) {
        let wakers = {
            let mut shared = self.shared.borrow_mut();
            if shared.fired.is_some() {
                return;
            }
            shared.fired = Some(value);
            std::mem::take(&mut shared.wakers)
        };
        wakers.into_iter().for_each(|(_, waker)| waker.wake());
    }
}

impl<T: Copy> Future for Signal<T> {
    type Output = T;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<T> {
        let this = self.get_mut();
        let mut shared = this.shared.borrow_mut();
        if let Some(value) = shared.fired {
            return Poll::Ready(value);
        }
        match this.slot.and_then(|slot| shared.wakers.iter_mut().find(|(id, _)| *id == slot)) {
            Some((_, waker)) => waker.clone_from(cx.waker()),
            None => {
                let id = shared.next;
                shared.next += 1;
                shared.wakers.push((id, cx.waker().clone()));
                this.slot = Some(id);
            }
        }
        Poll::Pending
    }
}

impl<T: Copy> Drop for Signal<T> {
    fn drop(&mut self) {
        if let Some(slot) = self.slot {
            self.shared.borrow_mut().wakers.retain(|(id, _)| *id != slot);
        }
    }
}

/// One message as received: its bytes, the link's time, the MIDI it parsed as and its decoded
/// events; `message` is none where the close released a held 14-bit half.
#[derive(Debug)]
pub struct Received {
    pub bytes: Vec<u8>,
    pub time: f64,
    pub message: Option<Result<Message, midi::Error>>,
    pub events: Vec<Event>,
}

#[derive(Clone)]
pub(crate) enum Item {
    Control { row: usize, value: Value, time: f64, released: Option<Signal<f64>> },
    Mode(usize),
    Received(Rc<Received>),
    Told(Told),
    Based(usize),
    Input(models::Input),
    Turned(Turned),
}

pub(crate) enum Want {
    Rows(&'static [usize]),
    /// Reports of `rows`, read off the state: a level.
    Latest(&'static [usize]),
    /// A relative control's position per run of ticks on one row, so no read spans two layers.
    Turned(&'static [usize]),
    Owner(usize),
    Received,
    Told,
    Inputs,
    /// Tellings and bases of `rows`, and every bank change.
    Telling(&'static Model, &'static [usize]),
}

impl Want {
    fn takes(&self, item: &Item) -> bool {
        match (self, item) {
            (Want::Rows(rows) | Want::Latest(rows) | Want::Turned(rows), Item::Control { row, .. }) => {
                rows.contains(row)
            }
            (Want::Owner(o), Item::Mode(m)) => o == m,
            (Want::Telling(_, _), Item::Mode(_)) => true,
            (Want::Telling(model, rows), Item::Told(told)) => rows.contains(&model.row(told.output.control)),
            (Want::Telling(_, rows), Item::Based(row)) => rows.contains(row),
            (Want::Received, Item::Received(_)) | (Want::Told, Item::Told(_)) | (Want::Inputs, Item::Input(_)) => true,
            _ => false,
        }
    }

    /// Whether its feed reads the state rather than the items, so one pending stands for any.
    fn latest(&self) -> bool {
        matches!(self, Want::Latest(_) | Want::Owner(_) | Want::Telling(..))
    }
}

/// The most items a feed holds unread; past it the oldest go, each counted in `dropped`.
pub const MAX_QUEUED: usize = 4096;

struct Queue {
    want: Want,
    items: VecDeque<Item>,
    waker: Option<Waker>,
    ended: bool,
    dropped: Rc<Cell<u64>>,
}

/// What the session reports from its creation on, until it closes: the latest level, bank or
/// telling, read when taken; a relative position per layer run; else every item, in order, up to
/// [`MAX_QUEUED`] unread.
pub struct Feed<T> {
    session: Session,
    queue: Rc<RefCell<Queue>>,
    map: Box<Map<T>>,
}

type Map<T> = dyn FnMut(&Session, Item) -> Option<T>;

impl<T> Feed<T> {
    pub fn dropped(&self) -> Rc<Cell<u64>> {
        self.queue.borrow().dropped.clone()
    }
}

impl<T> Stream for Feed<T> {
    type Item = T;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<T>> {
        let this = self.get_mut();
        loop {
            let item = {
                let mut queue = this.queue.borrow_mut();
                match queue.items.pop_front() {
                    Some(item) => item,
                    None if queue.ended => return Poll::Ready(None),
                    None => {
                        queue.waker = Some(cx.waker().clone());
                        return Poll::Pending;
                    }
                }
            };
            if let Some(value) = (this.map)(&this.session, item) {
                return Poll::Ready(Some(value));
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Write {
    Led(bool),
    Colour(f64),
    /// As the unit shows it where the model file says how (`shows`), else raw.
    Value(f64),
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub outputs: usize,
    pub gap_ms: f64,
    pub span_ms: f64,
}

/// Cloning shares it.
#[derive(Clone)]
pub struct Session(Rc<Inner>);

struct Inner {
    model: &'static Model,
    link: Box<dyn Link>,
    core: RefCell<Core>,
    closed: Signal,
    heard: RefCell<Signal>,
}

struct Core {
    decoder: Decoder,
    state: State,
    ledger: Ledger,
    queues: Vec<Weak<RefCell<Queue>>>,
    held: HashMap<usize, Signal<f64>>,
    leases: HashMap<u64, Leased>,
    next_lease: u64,
    reason: Option<CloseReason>,
}

/// A live lease: the row it holds, its end, and the control object whose shown bank it follows,
/// none for a lease on a view's bank.
struct Leased {
    row: usize,
    ended: Signal,
    follows: Option<usize>,
}

pub(crate) enum Either<A, B> {
    Left(A),
    Right(B),
}

pub(crate) async fn race<A: Future, B: Future>(a: A, b: B) -> Either<A::Output, B::Output> {
    let (mut a, mut b) = (pin!(a), pin!(b));
    poll_fn(|cx| {
        if let Poll::Ready(v) = a.as_mut().poll(cx) {
            return Poll::Ready(Either::Left(v));
        }
        b.as_mut().poll(cx).map(Either::Right)
    })
    .await
}

impl Session {
    pub fn new(model: &'static Model, link: impl Link + 'static) -> Session {
        let core = Core {
            decoder: Decoder::new(model),
            state: State::new(surface(model)),
            ledger: Ledger::new(model),
            queues: Vec::new(),
            held: HashMap::new(),
            leases: HashMap::new(),
            next_lease: 0,
            reason: None,
        };
        Session(Rc::new(Inner {
            model,
            link: Box::new(link),
            core: RefCell::new(core),
            closed: Signal::default(),
            heard: RefCell::new(Signal::default()),
        }))
    }

    pub fn model(&self) -> &'static Model {
        self.0.model
    }

    pub fn receive(&self, bytes: &[u8], time: f64) {
        self.take(bytes.to_vec(), Message::parse(bytes), time);
    }

    /// Takes what a transport's own framer made of the bytes: a message, or why they are none.
    pub fn receive_framed(&self, framed: Result<Message, midi::Error>, time: f64) {
        let bytes = framed.as_ref().map_or_else(|_| Vec::new(), |m| m.encode().expect("a framed message encodes"));
        self.take(bytes, framed, time);
    }

    fn take(&self, bytes: Vec<u8>, message: Result<Message, midi::Error>, time: f64) {
        let (wake, moved) = {
            let mut core = self.0.core.borrow_mut();
            if core.reason.is_some() {
                return;
            }
            let events = match &message {
                Ok(m) => core.decoder.feed(m),
                Err(_) => Vec::new(),
            };
            let mut items = core.items(self.0.model, &events, time);
            items.push(Item::Received(Rc::new(Received { bytes, time, message: Some(message), events })));
            let moved: Vec<usize> = items
                .iter()
                .filter_map(|i| match i {
                    Item::Mode(owner) => Some(*owner),
                    _ => None,
                })
                .collect();
            (core.deliver(&items), moved)
        };
        self.follow_banks(&moved);
        self.0.heard.replace(Signal::default()).fire(());
        wake.into_iter().for_each(Waker::wake);
    }

    /// Ends the session once: every stream ends, every press is released at the close's time, every
    /// lease ends, `closed` completes.
    pub fn close(&self, reason: CloseReason) {
        let time = self.0.link.now();
        let (queues, held, leases, flushed) = {
            let mut core = self.0.core.borrow_mut();
            if core.reason.is_some() {
                return;
            }
            // A held 14-bit half goes out alone.
            let flushed: Vec<Event> = core.decoder.flush().into_iter().collect();
            let mut items = core.items(self.0.model, &flushed, time);
            if !flushed.is_empty() {
                items.push(Item::Received(Rc::new(Received {
                    bytes: Vec::new(),
                    time,
                    message: None,
                    events: flushed,
                })));
            }
            let flushed = core.deliver(&items);
            core.reason = Some(reason);
            core.ledger.end_leases();
            let leases = std::mem::take(&mut core.leases);
            (std::mem::take(&mut core.queues), std::mem::take(&mut core.held), leases, flushed)
        };
        flushed.into_iter().for_each(Waker::wake);
        for queue in queues.iter().filter_map(Weak::upgrade) {
            let waker = {
                let mut queue = queue.borrow_mut();
                queue.ended = true;
                queue.waker.take()
            };
            waker.into_iter().for_each(Waker::wake);
        }
        held.into_values().for_each(|press| press.fire(time));
        leases.into_values().for_each(|leased| leased.ended.fire(()));
        self.0.closed.fire(());
    }

    pub fn reason(&self) -> Option<CloseReason> {
        self.0.core.borrow().reason
    }

    pub async fn closed(&self) -> CloseReason {
        self.0.closed.clone().await;
        self.reason().expect("closed once a reason is set")
    }

    async fn alive<F: Future>(&self, f: F) -> Result<F::Output, Error> {
        match race(f, self.0.closed.clone()).await {
            Either::Left(v) => Ok(v),
            Either::Right(()) => Err(Error::Closed(self.reason().expect("closed once a reason is set"))),
        }
    }

    async fn within<F: Future>(&self, f: F, ms: f64) -> Result<bool, Error> {
        let raced = race(f, self.0.link.sleep(ms));
        Ok(matches!(self.alive(raced).await?, Either::Left(_)))
    }

    fn heard(&self) -> Signal {
        self.0.heard.borrow().clone()
    }

    /// Tells every output its rest state, then asks for the device's state and waits out the
    /// answer, so every control it reports has its value once this resolves.
    pub async fn start(&self) -> Result<(), Error> {
        let span = self.sync(&[], SYNC_GAP_MS)?;
        self.alive(self.0.link.sleep(span)).await?;
        let Some(request) = self.0.model.request_state() else { return Ok(()) };
        let answered = self.heard();
        self.send(request, None)?;
        if !self.within(answered, STATE_WAIT_MS).await? {
            let message = format!("{} did not answer its state request within {STATE_WAIT_MS} ms", self.0.model.name);
            return Err(Error::Timeout(message));
        }
        while self.within(self.heard(), STATE_QUIET_MS).await? {}
        Ok(())
    }

    pub(crate) fn feed<T>(&self, want: Want, map: impl FnMut(&Session, Item) -> Option<T> + 'static) -> Feed<T> {
        let dropped = Rc::new(Cell::new(0));
        let queue = Rc::new(RefCell::new(Queue { want, items: VecDeque::new(), waker: None, ended: false, dropped }));
        let mut core = self.0.core.borrow_mut();
        queue.borrow_mut().ended = core.reason.is_some();
        core.queues.push(Rc::downgrade(&queue));
        Feed { session: self.clone(), queue, map: Box::new(map) }
    }

    pub(crate) fn latest(&self, rows: &[usize]) -> Option<Value> {
        self.0.core.borrow().state.latest(rows)
    }

    pub(crate) fn turned(&self, rows: &[usize]) -> Turned {
        self.0.core.borrow().state.turned(rows)
    }

    pub(crate) fn shown(&self, owner: usize) -> Shown {
        self.0.core.borrow().state.shown(owner)
    }

    /// The last telling of `row`, else of the row of `object` showing now (unshifted).
    pub(crate) fn told_on(&self, object: usize, row: Option<usize>) -> Option<Output> {
        let core = self.0.core.borrow();
        let row = row.or_else(|| core.state.showing(object).ok())?;
        core.ledger.last(row).map(|told| told.output)
    }

    /// As `told_on`, the base.
    pub(crate) fn base_on(&self, object: usize, row: Option<usize>) -> Option<Output> {
        let core = self.0.core.borrow();
        let row = row.or_else(|| core.state.showing(object).ok())?;
        core.ledger.base(row).map(|show| Output { control: &self.0.model.controls()[row], show })
    }

    fn alive_now(&self) -> Result<(), Error> {
        self.reason().map_or(Ok(()), |reason| Err(Error::Closed(reason)))
    }

    fn send(&self, bytes: &[u8], at: Option<f64>) -> Result<(), Error> {
        self.alive_now()?;
        self.0.link.send(bytes, at).map_err(Error::Send)
    }

    fn tell(&self, at: f64, via: Via, output: Output) {
        let wake = {
            let mut core = self.0.core.borrow_mut();
            let told = core.ledger.told(at, via, output);
            core.deliver(&[Item::Told(told)])
        };
        wake.into_iter().for_each(Waker::wake);
    }

    /// Tells every output once, as in `fill` else its rest state, `gap` ms apart on the link's
    /// clock; returns the span they were scheduled over.
    fn sync(&self, fill: &[Output], gap: f64) -> Result<f64, Error> {
        let plan = Ledger::sync_plan(self.0.model, fill);
        let start = self.0.link.now();
        for (n, output) in plan.iter().enumerate() {
            let at = start + n as f64 * gap;
            self.send(&output.bytes().map_err(|e| Error::Refused(e.to_string()))?, Some(at))?;
            self.tell(at, Via::Sync, *output);
        }
        Ok(plan.len().saturating_sub(1) as f64 * gap)
    }

    fn row(&self, object: usize, row: Option<usize>) -> Result<usize, Error> {
        match row {
            Some(row) => Ok(row),
            None => self.0.core.borrow().state.showing(object).map_err(|e| Error::Unshown(e.to_string())),
        }
    }

    fn output(&self, row: usize, value: Write) -> Result<Output, Error> {
        let control = &self.0.model.controls()[row];
        let refuse = |e: OutputError| Error::Refused(e.to_string());
        let show = match (control.output, value) {
            (Some(OutputKind::Led), Write::Led(on)) => Show::Led(on),
            (Some(OutputKind::Colour), Write::Colour(n)) => Show::colour(control, n).map_err(refuse)?,
            (Some(OutputKind::Value), Write::Value(n)) => Show::shown(control, n).map_err(refuse)?,
            _ => return Err(Error::Refused(format!("{} takes no {value:?}", control.name()))),
        };
        Ok(Output { control, show })
    }

    /// Writes `value` to the bank row `row`, or, without one, to the row of `object` showing now (unshifted).
    /// Under a lease it sets only the row's base, shown once every lease on it has ended.
    pub(crate) fn write(&self, object: usize, row: Option<usize>, value: Write) -> Result<(), Error> {
        self.alive_now()?;
        let output = self.output(self.row(object, row)?, value)?;
        let row = self.0.model.row(output.control);
        if self.0.core.borrow().ledger.leased(row) {
            let wake = {
                let mut core = self.0.core.borrow_mut();
                core.ledger.set_base(row, output.show);
                core.deliver(&[Item::Based(row)])
            };
            wake.into_iter().for_each(Waker::wake);
            return Ok(());
        }
        self.show(output)
    }

    /// Starts a lease at `values[first]`, told, on the bank row `bank`, else following `object`'s
    /// row showing; its id, shown values and end.
    pub(crate) fn lease(
        &self,
        object: usize,
        bank: Option<usize>,
        values: &[Write],
        first: usize,
    ) -> Result<(u64, Vec<Show>, Signal), Error> {
        self.alive_now()?;
        let row = self.row(object, bank)?;
        let outputs = values.iter().map(|&v| self.output(row, v)).collect::<Result<Vec<_>, _>>()?;
        let first = &outputs[first];
        let bytes = first.bytes().map_err(|e| Error::Refused(e.to_string()))?;
        self.send(&bytes, None)?;
        let (id, ended) = {
            let mut core = self.0.core.borrow_mut();
            let id = core.next_lease;
            core.next_lease += 1;
            let ended = Signal::default();
            core.leases.insert(id, Leased { row, ended: ended.clone(), follows: bank.is_none().then_some(object) });
            core.ledger.lease(row, id, first.show);
            (id, ended)
        };
        self.tell(self.0.link.now(), Via::Lease, *first);
        Ok((id, outputs.iter().map(|o| o.show).collect(), ended))
    }

    /// Sends a step on the row lease `id` holds now, where it is the row's newest; false once it
    /// has ended, as a failed send ends it.
    pub(crate) fn lease_step(&self, id: u64, show: Show, at: f64) -> Result<bool, Error> {
        let (output, shows) = {
            let mut core = self.0.core.borrow_mut();
            let Some(&Leased { row, .. }) = core.leases.get(&id) else { return Ok(false) };
            (Output { control: &self.0.model.controls()[row], show }, core.ledger.step(row, id, show))
        };
        if shows {
            let sent = output.bytes().map_err(|e| Error::Refused(e.to_string())).and_then(|b| self.send(&b, Some(at)));
            if let Err(e) = sent {
                self.end_lease(id)?;
                return Err(e);
            }
            self.tell(at, Via::Lease, output);
        }
        Ok(true)
    }

    /// Ends lease `id` once, telling its row what shows next.
    pub(crate) fn end_lease(&self, id: u64) -> Result<(), Error> {
        let (shown, ended) = {
            let mut core = self.0.core.borrow_mut();
            let Some(Leased { row, ended, .. }) = core.leases.remove(&id) else { return Ok(()) };
            let shown = core
                .ledger
                .release(row, id)
                .map(|(via, show)| (via, Output { control: &self.0.model.controls()[row], show }));
            (shown, ended)
        };
        ended.fire(());
        let Some((via, output)) = shown else { return Ok(()) };
        self.send(&output.bytes().map_err(|e| Error::Refused(e.to_string()))?, None)?;
        self.tell(self.0.link.now(), via, output);
        Ok(())
    }

    /// Moves each lease following an object of an owner in `moved` to the row it shows now, telling
    /// the row left what shows next; one stays where that row is unknown or refuses its step.
    fn follow_banks(&self, moved: &[usize]) {
        if moved.is_empty() {
            return;
        }
        let surface = surface(self.0.model);
        let output = |row: usize, show| Output { control: &self.0.model.controls()[row], show };
        let tells = {
            let mut core = self.0.core.borrow_mut();
            let core = &mut *core;
            let mut ids: Vec<u64> = core.leases.keys().copied().collect();
            ids.sort_unstable();
            let mut tells = Vec::new();
            for id in ids {
                let leased = core.leases.get_mut(&id).expect("a live lease");
                let Some(object) = leased.follows.filter(|&o| moved.contains(&surface.objects[o].owner)) else {
                    continue;
                };
                let (from, step) = (leased.row, core.ledger.step_of(leased.row, id));
                let Some(to) = core.state.showing(object).ok().filter(|&to| to != from) else { continue };
                if output(to, step).encode().is_err() {
                    continue;
                }
                leased.row = to;
                let (revealed, shown) = core.ledger.move_lease(from, to, id);
                tells.extend(revealed.map(|(via, show)| (via, output(from, show))));
                tells.extend(shown.map(|show| (Via::Lease, output(to, show))));
            }
            tells
        };
        for (via, output) in tells {
            // No caller to hand a failed send to; the next write meets it.
            if self.send(&output.bytes().expect("checked to encode"), None).is_ok() {
                self.tell(self.0.link.now(), via, output);
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn live_leases(&self) -> usize {
        let core = self.0.core.borrow();
        let rows = (0..self.0.model.controls().len()).filter(|&r| core.ledger.leased(r)).count();
        core.leases.len() + rows
    }

    pub(crate) fn now(&self) -> f64 {
        self.0.link.now()
    }

    pub(crate) fn sleep(&self, ms: f64) -> Pin<Box<dyn Future<Output = ()>>> {
        self.0.link.sleep(ms)
    }

    pub fn received(&self) -> Feed<Rc<Received>> {
        self.feed(Want::Received, |_, item| match item {
            Item::Received(r) => Some(r),
            _ => None,
        })
    }

    pub fn inputs(&self) -> Feed<models::Input> {
        self.feed(Want::Inputs, |_, item| match item {
            Item::Input(input) => Some(input),
            _ => None,
        })
    }

    pub fn told(&self) -> Feed<Told> {
        self.feed(Want::Told, |_, item| match item {
            Item::Told(told) => Some(told),
            _ => None,
        })
    }

    /// Sends one whole MIDI message; told as `send` where it decodes to an output.
    pub fn send_raw(&self, bytes: &[u8]) -> Result<(), Error> {
        Message::parse(bytes).map_err(|e| Error::Refused(e.to_string()))?;
        self.send(bytes, None)?;
        let messages: Result<Vec<Message>, _> = Framer::new().feed(bytes).into_iter().collect();
        if let Some(output) = messages.ok().and_then(|m| Output::decode(self.0.model, &m)) {
            self.tell(self.0.link.now(), Via::Send, output);
        }
        Ok(())
    }

    /// Sends what shows `output`, named as its model file names it.
    pub fn show(&self, output: Output) -> Result<(), Error> {
        self.send(&output.bytes().map_err(|e| Error::Refused(e.to_string()))?, None)?;
        self.tell(self.0.link.now(), Via::Show, output);
        Ok(())
    }

    /// Tells every output, as in `fill` else its rest state, `gap_ms` apart; completes once the last is due.
    pub async fn sync_outputs(&self, fill: &[Output], gap_ms: f64) -> Result<SyncReport, Error> {
        let outputs = Ledger::sync_plan(self.0.model, fill).len();
        let span_ms = self.sync(fill, gap_ms)?;
        self.alive(self.0.link.sleep(span_ms)).await?;
        Ok(SyncReport { outputs, gap_ms, span_ms })
    }

    pub fn output_state(&self, control: Option<&str>) -> Vec<Told> {
        let core = self.0.core.borrow();
        control.map_or_else(|| core.ledger.known(), |c| core.ledger.of(c))
    }

    pub fn history(&self) -> Vec<Told> {
        self.0.core.borrow().ledger.history().copied().collect()
    }

    /// Sends the model's repeating MIDI setup step `name` until a send fails or the session
    /// closes, which is what it returns; dropping it stops it.
    pub async fn repeat(&self, name: &str) -> Error {
        let step = self.0.model.hid.as_ref().and_then(|h| h.step(name));
        let Some(step) = step.filter(|s| s.via == StepVia::Midi && s.every_ms.is_some()) else {
            return Error::Refused(format!("{} has no repeating MIDI step {name:?}", self.0.model.name));
        };
        let (mut schedule, origin) = (Schedule::new(), self.0.link.now());
        schedule.step(0, step);
        loop {
            while let Some(send) = schedule.pop_due((self.0.link.now() - origin).max(0.0) as u64) {
                if let Err(e) = self.send(&send.bytes, None) {
                    return e;
                }
            }
            let next = schedule.next_at().expect("a repeating step stays scheduled") as f64;
            if let Err(e) = self.alive(self.0.link.sleep((origin + next - self.0.link.now()).max(0.0))).await {
                return e;
            }
        }
    }
}

impl Core {
    /// The items `events`, received at `time`, make: values with releases, typed inputs, moved modes.
    fn items(&mut self, model: &'static Model, events: &[Event], time: f64) -> Vec<Item> {
        let surface = surface(model);
        let mut items = Vec::new();
        for event in events {
            let moved = self.state.feed(event, time);
            if let Event::Control { control, value, .. } = event {
                let row = model.row(control);
                let object = surface.row_object[row];
                let down = match value {
                    Value::Button(pressed) => Some(*pressed),
                    Value::Pad(velocity) => Some(*velocity > 0),
                    _ => None,
                };
                let mut released = None;
                if let Some(down) = down {
                    if let Some(press) = self.held.remove(&object) {
                        press.fire(time);
                    }
                    if down {
                        let press = Signal::default();
                        self.held.insert(object, press.clone());
                        released = Some(press);
                    }
                }
                items.push(Item::Control { row, value: *value, time, released });
                items.push(Item::Input(models::input(model, row, *value)));
            }
            if let Some(owner) = moved.filter(|o| !items.iter().any(|i| matches!(i, Item::Mode(m) if m == o))) {
                items.push(Item::Mode(owner));
            }
        }
        items
    }

    /// Queues `items` with the streams taking them; the wakers to wake once unborrowed.
    fn deliver(&mut self, items: &[Item]) -> Vec<Waker> {
        self.queues.retain(|q| q.strong_count() > 0);
        let mut wake = Vec::new();
        for queue in self.queues.iter().filter_map(Weak::upgrade) {
            let mut queue = queue.borrow_mut();
            let mut taken: Vec<Item> = items.iter().filter(|i| queue.want.takes(i)).cloned().collect();
            if taken.is_empty() {
                continue;
            }
            if let Want::Turned(rows) = queue.want {
                let turned = self.state.turned(rows);
                if let Some(Item::Turned(last)) = queue.items.back()
                    && last.latest.map(|(row, _)| row) == turned.latest.map(|(row, _)| row)
                {
                    queue.items.pop_back();
                }
                taken = vec![Item::Turned(turned)];
            } else if queue.want.latest() {
                taken.truncate(usize::from(queue.items.is_empty()));
            }
            queue.items.extend(taken);
            let over = queue.items.len().saturating_sub(MAX_QUEUED);
            queue.items.drain(..over);
            queue.dropped.set(queue.dropped.get() + over as u64);
            wake.extend(queue.waker.take());
        }
        wake
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_lite::{StreamExt, future};

    struct Silent;

    impl Link for Silent {
        fn send(&self, _: &[u8], _: Option<f64>) -> Result<(), String> {
            Ok(())
        }
        fn now(&self) -> f64 {
            0.0
        }
        fn sleep(&self, _: f64) -> Pin<Box<dyn Future<Output = ()>>> {
            Box::pin(future::ready(()))
        }
    }

    #[test]
    fn a_wait_that_loses_a_race_leaves_no_waker_on_its_signal() {
        let signal: Signal = Signal::default();
        for _ in 0..3 {
            future::block_on(race(signal.clone(), future::ready(())));
        }
        assert!(signal.shared.borrow().wakers.is_empty());
    }

    #[test]
    fn an_unread_feed_keeps_the_newest_items_and_counts_the_rest() {
        let session = Session::new(Model::named("DDJ-FLX10").unwrap(), Silent);
        let mut received = session.received();
        // Deck 1 PLAY, 90 0B (MML p.2 D1).
        for n in 0..MAX_QUEUED + 3 {
            session.receive(&[0x90, 0x0B, (n % 2) as u8 * 0x7F], n as f64);
        }
        assert_eq!(received.dropped().get(), 3);
        future::block_on(async { assert_eq!(received.next().await.unwrap().time, 3.0) });
    }

    #[test]
    fn a_half_held_at_the_close_goes_out_alone_with_no_message() {
        let session = Session::new(Model::named("DDJ-FLX10").unwrap(), Silent);
        let mut received = session.received();
        // Channel 1 fader MSB, B0 13 (MML p.2 M2), its LSB never sent.
        session.receive_framed(Ok(Message::ControlChange { channel: 0, control: 0x13, value: 0x40 }), 0.0);
        session.close(CloseReason::Unplugged);
        future::block_on(async {
            let first = received.next().await.unwrap();
            assert!(first.message.is_some() && first.events.is_empty(), "the MSB waits for its partner");
            let flushed = received.next().await.unwrap();
            assert!(flushed.message.is_none());
            assert!(matches!(flushed.events[..], [Event::Control { value: Value::Msb(0x40), .. }]));
            assert!(received.next().await.is_none());
        });
    }

    #[test]
    fn touches_read_and_released_leave_no_press_record_waiter_or_queued_item() {
        let session = Session::new(Model::named("DDJ-FLX10").unwrap(), Silent);
        let flx = crate::models::ddj_flx10::DdjFlx10::new(&session);
        let mut presses = flx.decks[0].jog.touch.presses();
        let mut releases = Vec::new();
        // Deck 1 jog touch, 90 36: 0x7F touched, 0x00 released (MML p.2 D3; docs/research/flx10-observed.md).
        for _ in 0..1000 {
            session.receive(&[0x90, 0x36, 0x7F], 0.0);
            let mut released = future::block_on(presses.next()).unwrap().released;
            assert!(future::block_on(future::poll_once(&mut released)).is_none(), "held until released");
            session.receive(&[0x90, 0x36, 0x00], 0.0);
            future::block_on(&mut released);
            releases.push(released);
        }
        assert!(future::block_on(future::poll_once(presses.next())).is_none(), "a release is no press");
        let core = session.0.core.borrow();
        assert!(core.held.is_empty(), "no press is held");
        assert!(core.queues.iter().filter_map(Weak::upgrade).all(|q| q.borrow().items.is_empty()));
        for released in &releases {
            assert_eq!(Rc::strong_count(&released.shared), 1, "only the reader's own handle is left");
            assert!(released.shared.borrow().wakers.is_empty());
        }
    }

    #[test]
    fn a_value_outputs_range_is_its_model_files_as_its_write_takes_it() {
        let session = Session::new(Model::named("DDJ-FLX10").unwrap(), Silent);
        let flx = crate::models::ddj_flx10::DdjFlx10::new(&session);
        assert_eq!(flx.mixer.channels.0.level_meter.range(), Some([0.0, 127.0]));
        // deck1.display.bpm: 0 to 9999 in the file, shown in tenths.
        assert_eq!(flx.decks[0].display.bpm.range(), Some([0.0, 999.9]));
        // deck1.jog.ring: values 0 and 1 only.
        assert_eq!(flx.decks[0].jog.ring.range(), None);
    }
}
