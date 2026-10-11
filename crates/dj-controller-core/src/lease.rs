// Concern: a timed pattern on one output as a lease, its steps timed by a Schedule on the link's clock | Non-concern: which lease shows (ledger), encoding | IO: (Pattern, clock) -> steps told
//! A lease on a view's bank holds that bank's row for its whole life; one on a control object
//! holds the row the object shows, moving with each bank change, as a write lands.

use std::cell::RefCell;

use crate::error::Error;
use crate::hid::Via;
use crate::output::Show;
use crate::schedule::Schedule;
use crate::session::{Either, Session, Signal, Write, race};

/// Values, each shown for its whole number of milliseconds from 1, once through or repeating.
#[derive(Debug, Clone, PartialEq)]
pub struct Pattern<T> {
    pub steps: Vec<(T, f64)>,
    pub repeat: bool,
    /// A time on the link's clock a repeating pattern runs from: a lease starts at the step it would
    /// show had it run since then, so leases sharing one stay in phase. None starts at its first step.
    pub origin: Option<f64>,
}

/// A pattern on one output's row until `end`, a drop, the close, a failed send, or a pattern that
/// does not repeat running out.
pub struct Lease {
    session: Session,
    id: u64,
    ended: Signal,
    timing: RefCell<Timing>,
}

struct Timing {
    schedule: Schedule,
    origin: f64,
    shows: Vec<Show>,
    /// The next step is `popped % shows.len()`.
    popped: usize,
    end_ms: u64,
}

fn duration(ms: f64) -> Result<u32, Error> {
    let whole = ms.fract() == 0.0 && (1.0..=f64::from(u32::MAX)).contains(&ms);
    whole.then_some(ms as u32).ok_or_else(|| Error::Refused(format!("a step lasts {ms} ms, not a whole number from 1")))
}

impl Lease {
    /// Starts on the bank row `bank`, else on the row of `object` showing now (unshifted), following
    /// it; the step showing now told, its first unless `origin` places it.
    pub(crate) fn start(
        session: &Session,
        object: usize,
        bank: Option<usize>,
        steps: &[(Write, f64)],
        repeat: bool,
        origin: Option<f64>,
    ) -> Result<Lease, Error> {
        if steps.is_empty() {
            return Err(Error::Refused("a pattern needs a step".into()));
        }
        let durations = steps.iter().map(|&(_, ms)| duration(ms)).collect::<Result<Vec<_>, _>>()?;
        let period: u64 = durations.iter().copied().map(u64::from).sum();
        let every = match repeat {
            true => Some(u32::try_from(period).map_err(|_| Error::Refused(format!("a {period} ms period")))?),
            false => None,
        };
        let now = session.now();
        // The start of the period showing now, had the pattern run since `origin`.
        let origin = match origin {
            None => now,
            Some(at) if repeat && at.is_finite() && period > 0 => {
                let period = period as f64;
                at + ((now - at) / period).floor() * period
            }
            Some(at) => return Err(Error::Refused(format!("origin {at}: a finite time, on a repeating pattern only"))),
        };
        let mut schedule = Schedule::new();
        let mut at = 0;
        // Times only: each step is encoded for the row the lease holds when it falls due.
        for &ms in &durations {
            schedule.message(at, Via::Midi, Vec::new(), "lease", every);
            at += u64::from(ms);
        }
        let mut popped = 0;
        while schedule.pop_due((now - origin) as u64).is_some() {
            popped += 1;
        }
        let values: Vec<Write> = steps.iter().map(|&(value, _)| value).collect();
        let (id, shows, ended) = session.lease(object, bank, &values, popped - 1)?;
        let timing = Timing { schedule, origin, shows, popped, end_ms: period };
        Ok(Lease { session: session.clone(), id, ended, timing: RefCell::new(timing) })
    }

    /// Completes once the lease has ended, however it ended.
    pub fn ended(&self) -> Signal {
        self.ended.clone()
    }

    /// Ends the lease once; the error is a failed send of what the row shows next.
    pub fn end(&self) -> Result<(), Error> {
        self.session.end_lease(self.id)
    }

    /// Tells each step as it falls due, timestamped on the link's clock, until the lease ends;
    /// polled by one task.
    pub async fn run(&self) {
        while let Some(wake) = self.advance() {
            let sleep = self.session.sleep((wake - self.session.now()).max(0.0));
            if let Either::Right(()) = race(sleep, self.ended.clone()).await {
                return;
            }
        }
    }

    /// Tells every step due; when the next falls due, none once the lease has ended.
    fn advance(&self) -> Option<f64> {
        let mut timing = self.timing.borrow_mut();
        let t = &mut *timing;
        let due = (self.session.now() - t.origin).max(0.0) as u64;
        while let Some(send) = t.schedule.pop_due(due) {
            let show = t.shows[t.popped % t.shows.len()];
            t.popped += 1;
            if !matches!(self.session.lease_step(self.id, show, t.origin + send.at_ms as f64), Ok(true)) {
                return None;
            }
        }
        match t.schedule.next_at() {
            Some(at) => Some(t.origin + at as f64),
            None if due < t.end_ms => Some(t.origin + t.end_ms as f64),
            None => {
                drop(timing);
                // Its own end, with no caller to hand a failed send to; the next write meets it.
                let _ = self.end();
                None
            }
        }
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        // A drop has no caller to hand a failed send to.
        let _ = self.end();
    }
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::future::{Future, poll_fn};
    use std::pin::Pin;
    use std::rc::Rc;
    use std::task::{Poll, Waker};

    use futures_lite::{StreamExt, future};

    use super::*;
    use crate::controls::{Play, Telling};
    use crate::model::Model;
    use crate::models::ddj_flx10::DdjFlx10;
    use crate::session::Link;

    /// Bytes sent and when they were due, none for now.
    type Sent = (Vec<u8>, Option<f64>);

    /// A link on a clock the test moves, keeping what was sent.
    #[derive(Clone, Default)]
    struct FakeClock {
        now: Rc<Cell<f64>>,
        sleepers: Rc<RefCell<Vec<Waker>>>,
        sent: Rc<RefCell<Vec<Sent>>>,
    }

    impl Link for FakeClock {
        fn send(&self, bytes: &[u8], at: Option<f64>) -> Result<(), String> {
            self.sent.borrow_mut().push((bytes.to_vec(), at));
            Ok(())
        }
        fn now(&self) -> f64 {
            self.now.get()
        }
        fn sleep(&self, ms: f64) -> Pin<Box<dyn Future<Output = ()>>> {
            let (clock, until) = (self.clone(), self.now.get() + ms);
            Box::pin(poll_fn(move |cx| {
                if clock.now.get() >= until {
                    return Poll::Ready(());
                }
                clock.sleepers.borrow_mut().push(cx.waker().clone());
                Poll::Pending
            }))
        }
    }

    impl FakeClock {
        /// What was sent since the last call, each with its due time.
        fn take(&self) -> Vec<Sent> {
            std::mem::take(&mut self.sent.borrow_mut())
        }
    }

    struct Rig {
        clock: FakeClock,
        session: Session,
        flx: DdjFlx10,
    }

    fn rig() -> Rig {
        let clock = FakeClock::default();
        let session = Session::new(Model::named("DDJ-FLX10").unwrap(), clock.clone());
        let flx = DdjFlx10::new(&session);
        Rig { clock, session, flx }
    }

    /// Each lease's run, polled as a transport's timer would wake it; none once it is over.
    struct Runs<'a>(Vec<Option<Pin<Box<dyn Future<Output = ()> + 'a>>>>);

    impl<'a> Runs<'a> {
        fn of(leases: &[&'a Lease]) -> Runs<'a> {
            Runs(leases.iter().map(|l| Some(Box::pin(l.run()) as Pin<Box<dyn Future<Output = ()>>>)).collect())
        }

        /// Moves the clock to `ms` and polls each run still going once.
        fn at(&mut self, rig: &Rig, ms: f64) {
            rig.clock.now.set(ms);
            rig.clock.sleepers.borrow_mut().clear();
            for slot in &mut self.0 {
                if let Some(run) = slot
                    && future::block_on(future::poll_once(run.as_mut())).is_some()
                {
                    *slot = None;
                }
            }
        }

        fn over(&self) -> bool {
            self.0.iter().all(Option::is_none)
        }
    }

    fn blink<T>(a: T, b: T, half_ms: f64) -> Pattern<T> {
        Pattern { steps: vec![(a, half_ms), (b, half_ms)], repeat: true, origin: None }
    }

    // Deck 1 PLAY's LED, 90 0B (MML p.2 D1); deck 1 pad 1 in HOT CUE page 1, 97 00 (MML p.3 P1).
    const PLAY: [u8; 2] = [0x90, 0x0B];
    const PAD1: [u8; 2] = [0x97, 0x00];

    fn sent(at: &[u8; 2], value: u8, due: Option<f64>) -> Sent {
        (vec![at[0], at[1], value], due)
    }

    #[test]
    fn a_blink_toggles_at_each_step_on_the_clock_each_send_timestamped_when_due() {
        let rig = rig();
        let play = &rig.flx.decks[0].play_pause;
        let lease = future::block_on(play.play(&blink(true, false, 250.0))).unwrap();
        assert_eq!(rig.clock.take(), [sent(&PLAY, 0x7F, None)], "the first step is told on the call");
        assert_eq!(play.told(), Some(true));
        let mut runs = Runs::of(&[&lease]);
        runs.at(&rig, 249.0);
        assert!(rig.clock.take().is_empty());
        runs.at(&rig, 250.0);
        assert_eq!(rig.clock.take(), [sent(&PLAY, 0x00, Some(250.0))]);
        assert_eq!(play.told(), Some(false));
        // A wake that comes late sends every step it missed, each due at its own time.
        runs.at(&rig, 1010.0);
        let late = [(0x7F, 500.0), (0x00, 750.0), (0x7F, 1000.0)].map(|(v, due)| sent(&PLAY, v, Some(due)));
        assert_eq!(rig.clock.take(), late);
    }

    #[test]
    fn the_newest_lease_shows_and_ending_it_reveals_the_older_then_the_base() {
        let rig = rig();
        let pad = &rig.flx.decks[0].pads[0];
        future::block_on(pad.colour(5.0)).unwrap();
        let older = future::block_on(pad.play(&blink(1.0, 2.0, 100.0))).unwrap();
        let newer =
            future::block_on(pad.play(&Pattern { steps: vec![(9.0, 1000.0)], repeat: true, origin: None })).unwrap();
        assert_eq!(rig.clock.take(), [sent(&PAD1, 5, None), sent(&PAD1, 1, None), sent(&PAD1, 9, None)]);
        let mut runs = Runs::of(&[&older, &newer]);
        runs.at(&rig, 100.0);
        assert!(rig.clock.take().is_empty(), "the older lease steps unseen");
        future::block_on(pad.colour(7.0)).unwrap();
        assert!(rig.clock.take().is_empty(), "a write under a lease sets the base only");
        assert_eq!(pad.told(), Some(9));
        newer.end().unwrap();
        assert_eq!(rig.clock.take(), [sent(&PAD1, 2, None)], "the older lease at its step now");
        runs.at(&rig, 200.0);
        assert_eq!(rig.clock.take(), [sent(&PAD1, 1, Some(200.0))]);
        older.end().unwrap();
        assert_eq!(rig.clock.take(), [sent(&PAD1, 7, None)], "the base the write set");
        assert_eq!(pad.told(), Some(7));
        assert_eq!(rig.session.live_leases(), 0);
    }

    #[test]
    fn leases_started_on_one_clock_tick_toggle_in_phase() {
        // Deck 1 LOOP IN 90 10 and LOOP OUT 90 11 (MML p.2 D14, D15).
        const LOOP_IN: [u8; 2] = [0x90, 0x10];
        const LOOP_OUT: [u8; 2] = [0x90, 0x11];
        let rig = rig();
        let deck = &rig.flx.decks[0];
        rig.clock.now.set(40.0);
        let pattern = blink(true, false, 250.0);
        let leases = [
            future::block_on(deck.loop_in.play(&pattern)).unwrap(),
            future::block_on(deck.loop_out.play(&pattern)).unwrap(),
        ];
        rig.clock.take();
        let mut runs = Runs::of(&[&leases[0], &leases[1]]);
        runs.at(&rig, 540.0);
        let steps = |at: &[u8; 2]| [sent(at, 0x00, Some(290.0)), sent(at, 0x7F, Some(540.0))];
        assert_eq!(rig.clock.take(), [steps(&LOOP_IN), steps(&LOOP_OUT)].concat(), "each due at the same times");
    }

    #[test]
    fn leases_on_one_origin_started_apart_toggle_in_phase() {
        // Deck 1 LOOP IN 90 10 and LOOP OUT 90 11 (MML p.2 D14, D15).
        const LOOP_IN: [u8; 2] = [0x90, 0x10];
        const LOOP_OUT: [u8; 2] = [0x90, 0x11];
        let rig = rig();
        let deck = &rig.flx.decks[0];
        let pattern = Pattern { origin: Some(0.0), ..blink(true, false, 250.0) };
        rig.clock.now.set(40.0);
        let early = future::block_on(deck.loop_in.play(&pattern)).unwrap();
        rig.clock.now.set(300.0);
        let late = future::block_on(deck.loop_out.play(&pattern)).unwrap();
        assert_eq!(rig.clock.take(), [sent(&LOOP_IN, 0x7F, None), sent(&LOOP_OUT, 0x00, None)], "each at its step now");
        let mut runs = Runs::of(&[&early, &late]);
        runs.at(&rig, 500.0);
        let toggled =
            [sent(&LOOP_IN, 0x00, Some(250.0)), sent(&LOOP_IN, 0x7F, Some(500.0)), sent(&LOOP_OUT, 0x7F, Some(500.0))];
        assert_eq!(rig.clock.take(), toggled);
    }

    #[test]
    fn a_held_shift_leaves_a_controls_writes_and_leases_on_its_own_layer_and_a_shifted_views_on_shift() {
        // Deck 1 SHIFT, 90 3F (MML p.2 D25); deck 1 LOOP IN 90 10, its SHIFT layer 90 4C (MML p.2 D14).
        const LOOP_IN: [u8; 2] = [0x90, 0x10];
        const SHIFT_LOOP_IN: [u8; 2] = [0x90, 0x4C];
        let rig = rig();
        let deck = &rig.flx.decks[0];
        rig.session.receive(&[0x90, 0x3F, 0x7F], 0.0);
        future::block_on(deck.loop_in.led(true)).unwrap();
        future::block_on(deck.shifted.loop_in.led(true)).unwrap();
        assert_eq!(rig.clock.take(), [sent(&LOOP_IN, 0x7F, None), sent(&SHIFT_LOOP_IN, 0x7F, None)]);
        let lease = future::block_on(deck.loop_in.play(&blink(false, true, 100.0))).unwrap();
        let mut runs = Runs::of(&[&lease]);
        rig.session.receive(&[0x90, 0x3F, 0x00], 50.0);
        runs.at(&rig, 100.0);
        drop(runs);
        lease.end().unwrap();
        let steps = [(0x00, None), (0x7F, Some(100.0)), (0x7F, None)];
        assert_eq!(rig.clock.take(), steps.map(|(v, due)| sent(&LOOP_IN, v, due)), "started under SHIFT, on LOOP IN");
        assert_eq!((deck.loop_in.told(), deck.shifted.loop_in.told()), (Some(true), Some(true)));
    }

    // Deck 1 PAGE ▶ in HOT CUE, 90 2C (MML p.6 P14; p.7 *1); pad 1 in HOT CUE page 2, 97 08 (MML p.3 P1).
    const PAGE_RIGHT: [u8; 3] = [0x90, 0x2C, 0x7F];
    const PAGE2_PAD1: [u8; 2] = [0x97, 0x08];

    #[test]
    fn a_lease_on_a_physical_pad_moves_to_each_bank_shown_and_ends_there() {
        let rig = rig();
        let deck = &rig.flx.decks[0];
        let pad = &deck.pads[0];
        future::block_on(pad.colour(5.0)).unwrap();
        future::block_on(deck.modes.hot_cue.pages[1].pads[0].colour(7.0)).unwrap();
        let lease = future::block_on(pad.play(&blink(1.0, 2.0, 100.0))).unwrap();
        let mut runs = Runs::of(&[&lease]);
        rig.clock.take();
        rig.session.receive(&PAGE_RIGHT, 50.0);
        let moved = [sent(&PAD1, 5, None), sent(&PAGE2_PAD1, 1, None)];
        assert_eq!(rig.clock.take(), moved, "the bank left shows its base, the bank shown the lease");
        assert_eq!(pad.told(), Some(1));
        runs.at(&rig, 100.0);
        assert_eq!(rig.clock.take(), [sent(&PAGE2_PAD1, 2, Some(100.0))]);
        lease.end().unwrap();
        assert_eq!(rig.clock.take(), [sent(&PAGE2_PAD1, 7, None)], "the shown bank's base");
        assert_eq!(rig.session.live_leases(), 0);
    }

    #[test]
    fn a_lease_on_a_paged_view_stays_on_its_bank_when_another_is_shown() {
        let rig = rig();
        let page1 = &rig.flx.decks[0].modes.hot_cue.pages[0].pads[0];
        future::block_on(page1.colour(5.0)).unwrap();
        let lease = future::block_on(page1.play(&blink(1.0, 2.0, 100.0))).unwrap();
        let mut runs = Runs::of(&[&lease]);
        rig.clock.take();
        rig.session.receive(&PAGE_RIGHT, 50.0);
        assert!(rig.clock.take().is_empty());
        runs.at(&rig, 100.0);
        lease.end().unwrap();
        assert_eq!(rig.clock.take(), [sent(&PAD1, 2, Some(100.0)), sent(&PAD1, 5, None)]);
        assert_eq!(rig.flx.decks[0].pads[0].told(), None, "nothing was told on the bank shown");
    }

    #[test]
    fn a_write_under_a_lease_streams_the_base_and_a_views_base_is_its_banks() {
        let rig = rig();
        let deck = &rig.flx.decks[0];
        let (pad, page2) = (&deck.pads[0], &deck.modes.hot_cue.pages[1].pads[0]);
        future::block_on(pad.colour(5.0)).unwrap();
        future::block_on(page2.colour(7.0)).unwrap();
        assert_eq!((pad.base(), page2.base()), (Some(5), Some(7)));
        let mut bases = pad.base_changes();
        let lease = future::block_on(pad.play(&blink(1.0, 2.0, 100.0))).unwrap();
        future::block_on(pad.colour(9.0)).unwrap();
        assert_eq!(future::block_on(bases.next()), Some(Some(9)));
        lease.end().unwrap();
        assert_eq!((pad.told(), pad.base()), (Some(9), Some(9)));
        assert!(future::block_on(future::poll_once(bases.next())).is_none(), "the lease's end leaves the base");
    }

    #[test]
    fn ending_an_older_lease_sends_nothing_and_the_newer_keeps_showing() {
        let rig = rig();
        let play = &rig.flx.decks[0].play_pause;
        future::block_on(play.led(false)).unwrap();
        let older = future::block_on(play.play(&blink(true, false, 100.0))).unwrap();
        let newer = future::block_on(play.play(&blink(false, true, 300.0))).unwrap();
        rig.clock.take();
        older.end().unwrap();
        drop(older);
        assert!(rig.clock.take().is_empty());
        assert_eq!(play.told(), Some(false));
        drop(newer);
        assert_eq!(rig.clock.take(), [sent(&PLAY, 0x00, None)], "a drop ends it, revealing the base");
        assert_eq!(rig.session.live_leases(), 0);
    }

    #[test]
    fn a_pattern_that_does_not_repeat_ends_once_its_last_step_is_up() {
        let rig = rig();
        let play = &rig.flx.decks[0].play_pause;
        future::block_on(play.led(false)).unwrap();
        let flash = Pattern { steps: vec![(true, 100.0), (false, 50.0), (true, 100.0)], repeat: false, origin: None };
        let lease = future::block_on(play.play(&flash)).unwrap();
        let mut runs = Runs::of(&[&lease]);
        runs.at(&rig, 150.0);
        let mut ended = lease.ended();
        assert!(future::block_on(future::poll_once(&mut ended)).is_none());
        runs.at(&rig, 250.0);
        assert!(runs.over(), "its run is over");
        let steps = [(0x7F, None), (0x00, Some(100.0)), (0x7F, Some(150.0)), (0x00, None)];
        assert_eq!(rig.clock.take()[1..], steps.map(|(v, due)| sent(&PLAY, v, due)));
        future::block_on(ended);
        assert_eq!(rig.session.live_leases(), 0);
    }

    #[test]
    fn the_close_ends_every_lease_and_its_run_sending_nothing_more() {
        let rig = rig();
        let leases = [&rig.flx.decks[0].play_pause, &rig.flx.decks[1].play_pause]
            .map(|button| future::block_on(button.play(&blink(true, false, 100.0))).unwrap());
        let mut runs = Runs::of(&[&leases[0], &leases[1]]);
        rig.clock.take();
        rig.session.close(crate::error::CloseReason::Closed);
        runs.at(&rig, 1000.0);
        assert!(runs.over());
        assert!(rig.clock.take().is_empty());
        leases.iter().for_each(|l| future::block_on(l.ended()));
        assert_eq!(rig.session.live_leases(), 0);
        assert!(matches!(
            future::block_on(rig.flx.decks[0].play_pause.play(&blink(true, false, 100.0))),
            Err(Error::Closed(_))
        ));
    }

    #[test]
    fn a_pattern_is_refused_whole_before_anything_is_sent() {
        let rig = rig();
        let pad = &rig.flx.decks[0].pads[0];
        let refused_from = |steps: Vec<(f64, f64)>, repeat, origin| {
            matches!(future::block_on(pad.play(&Pattern { steps, repeat, origin })), Err(Error::Refused(_)))
        };
        let refused = |steps| refused_from(steps, true, None);
        assert!(refused_from(vec![(1.0, 100.0)], false, Some(0.0)), "an origin on a pattern run once");
        assert!(refused_from(vec![(1.0, 100.0)], true, Some(f64::NAN)));
        assert!(refused(vec![]));
        assert!(refused(vec![(1.0, 0.0)]));
        assert!(refused(vec![(1.0, 1.5)]));
        assert!(refused(vec![(1.0, f64::INFINITY)]));
        assert!(refused(vec![(1.0, 100.0), (200.0, 100.0)]));
        assert!(refused(vec![(1.0, f64::from(u32::MAX)), (2.0, 1.0)]), "a period past the schedule's");
        assert!(rig.clock.take().is_empty());
        assert_eq!(rig.session.live_leases(), 0);
    }
}
