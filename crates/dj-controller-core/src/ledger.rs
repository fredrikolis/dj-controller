// Concern: each output's last telling, base and leases, every telling in order, what a sync tells | Non-concern: encoding, sending, timing | IO: (Output, via, time) -> state, history
//! MIDI gives no LED readback: this is what the device was told, not what it shows; an LED the
//! firmware lights itself goes unseen, and one the model marks `firmware` gets no state.
//! A row's base, set by every telling but a lease's, shows while no lease holds the row.
use std::collections::VecDeque;

use crate::model::{Model, OutputKind};
use crate::output::{Output, Show};

/// The most tellings the history keeps.
pub const MAX_HISTORY: usize = 4096;

/// Which way an output reached the device.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Via {
    Show,
    Send,
    Sync,
    Lease,
}

impl Via {
    pub fn name(self) -> &'static str {
        match self {
            Via::Show => "show",
            Via::Send => "send",
            Via::Sync => "sync",
            Via::Lease => "lease",
        }
    }
}

/// One telling; `at` is on the caller's clock.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Told {
    pub seq: u64,
    pub at: f64,
    pub via: Via,
    pub output: Output,
}

/// The one owner of a model's output state.
pub struct Ledger {
    model: &'static Model,
    /// By row of the model's controls.
    last: Vec<Option<Told>>,
    base: Vec<Option<Show>>,
    /// Each lease's id and step, newest last.
    leases: Vec<Vec<(u64, Show)>>,
    history: VecDeque<Told>,
    seq: u64,
}

impl Ledger {
    pub fn new(model: &'static Model) -> Ledger {
        let rows = model.controls().len();
        Ledger {
            model,
            last: vec![None; rows],
            base: vec![None; rows],
            leases: vec![Vec::new(); rows],
            history: VecDeque::new(),
            seq: 0,
        }
    }

    /// Records a send of `output`, changed or not.
    pub fn told(&mut self, at: f64, via: Via, output: Output) -> Told {
        self.seq += 1;
        let told = Told { seq: self.seq, at, via, output };
        let row = self.model.row(output.control);
        if via != Via::Lease {
            self.base[row] = Some(output.show);
        }
        if output.control.firmware.is_none() {
            self.last[row] = Some(told);
        }
        if self.history.len() == MAX_HISTORY {
            self.history.pop_front();
        }
        self.history.push_back(told);
        told
    }

    /// The last telling of each of `control`'s layers that has one.
    pub fn of(&self, control: &str) -> Vec<Told> {
        let rows = self.model.controls().iter().zip(&self.last).filter(|(c, _)| c.control == control);
        rows.filter_map(|(_, told)| *told).collect()
    }

    pub fn known(&self) -> Vec<Told> {
        self.last.iter().flatten().copied().collect()
    }

    pub fn last(&self, row: usize) -> Option<Told> {
        self.last[row]
    }

    pub fn history(&self) -> impl Iterator<Item = &Told> {
        self.history.iter()
    }

    pub fn base(&self, row: usize) -> Option<Show> {
        self.base[row].filter(|_| self.model.controls()[row].firmware.is_none())
    }

    pub fn leased(&self, row: usize) -> bool {
        !self.leases[row].is_empty()
    }

    pub fn set_base(&mut self, row: usize, show: Show) {
        self.base[row] = Some(show);
    }

    /// Places lease `id` among `row`'s by age; whether it is the newest.
    pub fn lease(&mut self, row: usize, id: u64, show: Show) -> bool {
        let leases = &mut self.leases[row];
        let at = leases.partition_point(|(l, _)| *l < id);
        leases.insert(at, (id, show));
        at + 1 == leases.len()
    }

    /// Lease `id`'s step now on `row`.
    pub fn step_of(&self, row: usize, id: u64) -> Show {
        self.leases[row].iter().find(|(l, _)| *l == id).expect("a live lease has a step").1
    }

    /// Moves lease `id` from `from` to `to`: what `from` is told, as on a release, and the step `to`
    /// is told where the lease is its newest.
    pub fn move_lease(&mut self, from: usize, to: usize, id: u64) -> (Option<(Via, Show)>, Option<Show>) {
        let show = self.step_of(from, id);
        let revealed = self.release(from, id);
        (revealed, self.lease(to, id, show).then_some(show))
    }

    /// Whether lease `id` is the newest, so its step is told.
    pub fn step(&mut self, row: usize, id: u64, show: Show) -> bool {
        let leases = &mut self.leases[row];
        let at = leases.iter().position(|(l, _)| *l == id).expect("a live lease steps");
        leases[at].1 = show;
        at + 1 == leases.len()
    }

    /// What `row` is told where lease `id` was the newest: the next newest's step, else the base.
    pub fn release(&mut self, row: usize, id: u64) -> Option<(Via, Show)> {
        let leases = &mut self.leases[row];
        let at = leases.iter().position(|(l, _)| *l == id).expect("a live lease ends once");
        leases.remove(at);
        if at < leases.len() {
            return None;
        }
        match leases.last() {
            Some(&(_, show)) => Some((Via::Lease, show)),
            None => self.base[row].map(|show| (Via::Show, show)),
        }
    }

    pub fn end_leases(&mut self) {
        self.leases.iter_mut().for_each(Vec::clear);
    }

    /// Every output once, as in `fill`, else unlit, colour 0 or its lowest value.
    pub fn sync_plan(model: &'static Model, fill: &[Output]) -> Vec<Output> {
        model
            .controls()
            .iter()
            .filter_map(|control| {
                let given = fill.iter().find(|o| std::ptr::eq(o.control, control)).map(|o| o.show);
                let show = given.or_else(|| match control.output? {
                    OutputKind::Led => Some(Show::Led(false)),
                    OutputKind::Colour => Some(Show::Colour(0)),
                    OutputKind::Value => (0..=0x3FFF).find(|&v| control.admits(v)).map(Show::Value),
                })?;
                Some(Output { control, show })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flx10() -> &'static Model {
        Model::named("DDJ-FLX10").unwrap()
    }

    fn led(control: &str, layer: &str, on: bool) -> Output {
        Output { control: flx10().control(control, layer).unwrap(), show: Show::Led(on) }
    }

    #[test]
    fn the_last_telling_of_each_layer_is_the_state_and_every_telling_is_history() {
        let mut ledger = Ledger::new(flx10());
        ledger.told(1.0, Via::Show, led("deck1.play-pause", "", true));
        ledger.told(2.0, Via::Send, led("deck1.play-pause", "shift", true));
        ledger.told(3.0, Via::Show, led("deck1.play-pause", "", false));
        let state = ledger.of("deck1.play-pause");
        assert_eq!(
            state.iter().map(|t| (t.output.show, t.via, t.seq)).collect::<Vec<_>>(),
            [(Show::Led(false), Via::Show, 3), (Show::Led(true), Via::Send, 2)]
        );
        assert_eq!(ledger.history().count(), 3);
        assert!(ledger.of("deck1.cue").is_empty());
    }

    #[test]
    fn an_output_the_firmware_drives_is_history_but_no_state() {
        let mut ledger = Ledger::new(flx10());
        ledger.told(1.0, Via::Show, led("deck1.pad-mode.hot-cue", "", true));
        assert!(ledger.of("deck1.pad-mode.hot-cue").is_empty());
        assert_eq!(ledger.history().count(), 1);
    }

    #[test]
    fn the_history_keeps_the_latest_tellings_only() {
        let mut ledger = Ledger::new(flx10());
        for n in 0..MAX_HISTORY + 5 {
            ledger.told(n as f64, Via::Sync, led("deck1.cue", "", n % 2 == 0));
        }
        assert_eq!(ledger.history().count(), MAX_HISTORY);
        assert_eq!(ledger.history().next().unwrap().seq, 6);
    }

    #[test]
    fn a_moved_lease_shows_on_its_new_row_only_where_it_is_the_newest_there() {
        let mut ledger = Ledger::new(flx10());
        let (from, to) =
            (flx10().row(led("deck1.cue", "", true).control), flx10().row(led("deck2.cue", "", true).control));
        ledger.told(0.0, Via::Show, led("deck1.cue", "", false));
        ledger.lease(from, 1, Show::Led(true));
        ledger.lease(to, 2, Show::Led(false));
        assert_eq!(ledger.move_lease(from, to, 1), (Some((Via::Show, Show::Led(false))), None), "lease 2 is newer");
        assert_eq!(ledger.release(to, 2), Some((Via::Lease, Show::Led(true))), "lease 1 shows once 2 ends");
        ledger.lease(from, 3, Show::Led(true));
        assert_eq!(ledger.move_lease(to, from, 1), (None, None));
        assert_eq!(ledger.move_lease(from, to, 3), (Some((Via::Lease, Show::Led(true))), Some(Show::Led(true))));
    }

    #[test]
    fn a_sync_plan_tells_every_output_once_each_within_its_range() {
        let model = flx10();
        let fill = [led("deck2.cue", "shift", true)];
        let plan = Ledger::sync_plan(model, &fill);
        assert_eq!(plan.len(), Output::all(model).len());
        assert!(plan.iter().all(|o| o.encode().is_ok()), "every planned output encodes");
        assert!(plan.contains(&fill[0]));
        assert!(plan.contains(&led("deck2.cue", "", false)));
    }
}
