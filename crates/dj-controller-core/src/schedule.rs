// Concern: when each send of setup steps and replayed frames falls due, repeats included | Non-concern: the clock and sending (transports) | IO: (steps, frames, ms) -> timed sends
//! Times are milliseconds on the caller's clock; a transport waits for each send's `at_ms`.

use crate::capture::{Frame, Payload};
use crate::hid::{Step, Via};

/// One message or report, due at `at_ms`; `round` counts a repeating step's rounds from 0.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Send {
    pub at_ms: u64,
    pub via: Via,
    pub bytes: Vec<u8>,
    /// The step's name, `replay <frame index>`, or `lease <id>`.
    pub name: String,
    pub round: u32,
}

#[derive(Default)]
pub struct Schedule {
    /// With each its repeat period and the order it was queued in.
    pending: Vec<(Send, Option<u32>, u64)>,
    queued: u64,
}

impl Schedule {
    pub fn new() -> Schedule {
        Schedule::default()
    }

    /// `step`'s messages at `at_ms`, again every `every_ms` after where it has one.
    pub fn step(&mut self, at_ms: u64, step: &Step) {
        for bytes in &step.messages {
            self.message(at_ms, step.via, bytes.clone(), &step.name, step.every_ms);
        }
    }

    /// `bytes` at `at_ms` named `name`, again every `every_ms` after where given.
    pub fn message(&mut self, at_ms: u64, via: Via, bytes: Vec<u8>, name: &str, every_ms: Option<u32>) {
        self.queue(Send { at_ms, via, bytes, name: name.to_owned(), round: 0 }, every_ms);
    }

    /// Each frame's messages or report at `at_ms`, in capture order.
    pub fn frames(&mut self, at_ms: u64, frames: &[Frame]) {
        for frame in frames {
            let name = format!("replay {}", frame.index);
            let sends: Vec<(Via, Vec<u8>)> = match &frame.payload {
                Payload::Midi(messages) => {
                    messages.iter().map(|m| (Via::Midi, m.encode().expect("a parsed message encodes"))).collect()
                }
                Payload::Report(report) => vec![(Via::Hid, report.clone())],
            };
            for (via, bytes) in sends {
                self.queue(Send { at_ms, via, bytes, name: name.clone(), round: 0 }, None);
            }
        }
    }

    /// Drops every send still due of the step or replay named `name`.
    pub fn stop(&mut self, name: &str) {
        self.pending.retain(|(send, _, _)| send.name != name);
    }

    fn queue(&mut self, send: Send, every_ms: Option<u32>) {
        self.pending.push((send, every_ms, self.queued));
        self.queued += 1;
    }

    /// When the next send falls due; none once nothing repeats and all is sent.
    pub fn next_at(&self) -> Option<u64> {
        self.pending.iter().map(|(send, _, _)| send.at_ms).min()
    }

    /// The earliest send due by `now_ms`, ties in the order queued; a repeating step's next
    /// round is queued as its send leaves.
    pub fn pop_due(&mut self, now_ms: u64) -> Option<Send> {
        let (at, _) = self
            .pending
            .iter()
            .enumerate()
            .filter(|(_, (send, _, _))| send.at_ms <= now_ms)
            .min_by_key(|(_, (send, _, order))| (send.at_ms, *order))?;
        let (send, every_ms, _) = self.pending.remove(at);
        if let Some(every) = every_ms {
            let next = Send { at_ms: send.at_ms + u64::from(every), round: send.round + 1, ..send.clone() };
            self.queue(next, every_ms);
        }
        Some(send)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Model;

    fn flx10_step(name: &str) -> &'static Step {
        Model::named("DDJ-FLX10").unwrap().hid.as_ref().unwrap().step(name).unwrap()
    }

    fn drain(schedule: &mut Schedule, until_ms: u64) -> Vec<(u64, String, u32)> {
        std::iter::from_fn(|| schedule.pop_due(until_ms)).map(|s| (s.at_ms, s.name, s.round)).collect()
    }

    #[test]
    fn sends_leave_in_the_order_queued_and_none_early() {
        let wake = flx10_step("wake");
        let mut schedule = Schedule::new();
        schedule.step(0, wake);
        schedule.step(5, wake);
        assert_eq!(schedule.next_at(), Some(0));
        let first: Vec<Vec<u8>> = std::iter::from_fn(|| schedule.pop_due(4)).map(|s| s.bytes).collect();
        assert_eq!(first, wake.messages);
        assert_eq!(schedule.next_at(), Some(5));
        assert_eq!(drain(&mut schedule, 5).len(), wake.messages.len());
        assert_eq!(schedule.next_at(), None);
    }

    #[test]
    fn a_repeating_step_comes_back_every_period_interleaved_with_later_sends() {
        let keepalive = flx10_step("keepalive");
        let every = u64::from(keepalive.every_ms.unwrap());
        let wake = flx10_step("wake");
        let mut schedule = Schedule::new();
        schedule.step(0, keepalive);
        schedule.step(every, wake);
        let sends = drain(&mut schedule, 2 * every);
        let per_round = keepalive.messages.len();
        let keepalive_at = |round: u32| vec![(u64::from(round) * every, "keepalive".to_owned(), round); per_round];
        let wake_at = vec![(every, "wake".to_owned(), 0); wake.messages.len()];
        assert_eq!(sends, [keepalive_at(0), wake_at, keepalive_at(1), keepalive_at(2)].concat());
        assert_eq!(schedule.next_at(), Some(3 * every));
    }

    #[test]
    fn a_stopped_step_sends_no_more_rounds() {
        let (keepalive, handshake) = (flx10_step("keepalive"), flx10_step("handshake"));
        let mut schedule = Schedule::new();
        schedule.step(0, keepalive);
        schedule.step(1000, handshake);
        assert_eq!(drain(&mut schedule, 0).len(), keepalive.messages.len());
        schedule.stop("keepalive");
        assert!(drain(&mut schedule, 1000).iter().all(|(_, name, _)| name == "handshake"));
        assert_eq!(schedule.next_at(), None);
    }

    #[test]
    fn replayed_frames_send_each_midi_message_and_report_in_capture_order() {
        let model = Model::named("DDJ-FLX10").unwrap();
        let fixture = include_str!("../fixtures/ddj-flx10-rekordbox-connect.json");
        let frames = crate::capture::parse(model, fixture).unwrap();
        let mut schedule = Schedule::new();
        schedule.frames(0, &[frames[0].clone(), frames[1].clone(), frames[323].clone()]);
        let sends: Vec<(String, Via, Vec<u8>)> =
            std::iter::from_fn(|| schedule.pop_due(0)).map(|s| (s.name, s.via, s.bytes)).collect();
        let keepalive = vec![0xF0, 0x00, 0x40, 0x05, 0x00, 0x00, 0x04, 0x01, 0x00, 0x50, 0x00, 0xF7];
        assert_eq!(
            sends[..2],
            [("replay 0".into(), Via::Midi, keepalive), ("replay 1".into(), Via::Midi, vec![0x9F, 0x70, 0x00])]
        );
        assert_eq!((&sends[2].0[..], sends[2].1, &sends[2].2[..2]), ("replay 323", Via::Hid, &[0x30, 0x21][..]));
        assert_eq!(sends.len(), 3);
    }
}
