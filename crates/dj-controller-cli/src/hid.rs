// Concern: `hid`: sends named setup steps and captured frames, prints input reports | Non-concern: what a step holds (the core), OS plumbing | IO: (steps, frames) -> Transport; reports -> stdout
//! Experimental. On Linux the device nodes need the udev rule `dj-controller-cli udev` prints.

use std::io::{self, Write};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use dj_controller_core::capture::{self, Frame, Payload};
use dj_controller_core::hid::{self, Interface, Setup, Step, Via};
use dj_controller_core::model::Model;
use dj_controller_core::schedule::{Schedule, Send};

use crate::transport::{Stream, Transport};

/// What `dj-controller-cli hid` sends, in the order named.
enum Item<'a> {
    Step(&'a Step),
    /// `--replay FILE [--only SPEC]`: the frames of a captured frame list (`dj_controller_core::capture`).
    Replay(Vec<Frame>),
}

/// Sends `args` in order, each repeating step again on its period, and prints input reports,
/// until killed or the device goes.
pub fn run(args: &[String], os: &impl Transport) -> Result<(), String> {
    let mut device = os.hid()?;
    let model = device.model.expect("a HID port belongs to a known model");
    let interface = model.hid.as_ref().expect("a HID port's model has an interface");
    let items = items(args, model, interface)?;
    eprintln!("{} HID at {}", model.name, device.name);
    let mut schedule = Schedule::new();
    let mut midi = None;
    for item in &items {
        let needs_midi = match item {
            Item::Step(step) => {
                schedule.step(0, step);
                if let Some(every) = step.every_ms {
                    eprintln!("{}: every {every} ms until killed", step.name);
                }
                step.via == Via::Midi
            }
            Item::Replay(frames) => {
                schedule.frames(0, frames);
                frames.iter().any(|f| matches!(f.payload, Payload::Midi(_)))
            }
        };
        if needs_midi && midi.is_none() {
            midi = Some(os.midi(None, true)?.stream);
        }
    }
    let (mut reports, name, input) =
        (device.stream.try_clone().map_err(|e| e.to_string())?, device.name.clone(), interface.input);
    let (ended, end) = mpsc::channel();
    std::thread::spawn(move || ended.send(read_reports(&mut reports, input).map_err(|e| format!("{name}: {e}"))));
    let start = Instant::now();
    while let Some(at) = schedule.next_at() {
        match end.recv_timeout(Duration::from_millis(at).saturating_sub(start.elapsed())) {
            Err(RecvTimeoutError::Timeout) => {}
            ended => return ended.map_err(|e| e.to_string())?,
        }
        let due = schedule.pop_due(at).expect("a send falls due at next_at");
        send(&due, model, os, midi.as_mut(), &mut device.stream).map_err(|e| format!("{}: {e}", due.name))?;
    }
    end.recv().map_err(|e| e.to_string())?
}

/// One send, printed on its first round.
fn send(
    send: &Send,
    model: &Model,
    os: &impl Transport,
    midi: Option<&mut Box<dyn Stream>>,
    device: &mut Box<dyn Stream>,
) -> Result<(), String> {
    let printed = match send.via {
        Via::Control => {
            let setup = Setup::of(&send.bytes);
            os.control(model, setup)?;
            let Setup { request_type, request, value, index } = setup;
            format!("(control) {request_type:02X} {request:02X} {value:04X} {index:04X}")
        }
        Via::Midi => {
            midi.expect("a MIDI send opens the port").write_all(&send.bytes).map_err(|e| e.to_string())?;
            format!("(midi) {}", trimmed(&send.bytes))
        }
        Via::Hid => {
            device.write_all(&send.bytes).map_err(|e| e.to_string())?;
            format!("(hid) {}", trimmed(&send.bytes))
        }
    };
    if send.round == 0 {
        println!("out {} {printed}", send.name);
    }
    Ok(())
}

fn items<'a>(args: &[String], model: &Model, interface: &'a Interface) -> Result<Vec<Item<'a>>, String> {
    let mut items = Vec::new();
    let mut args = args.iter().peekable();
    while let Some(arg) = args.next() {
        let item = match arg.as_str() {
            "--replay" => {
                let path = args.next().ok_or("--replay takes a frame list file")?;
                let frames = capture::parse(model, &crate::read(path)?).map_err(|e| format!("{path}: {e}"))?;
                match args.next_if(|a| *a == "--only") {
                    Some(_) => {
                        let spec = args.next().ok_or("--only takes frames: indices, a-b ranges, groups")?;
                        let only = capture::select(&frames, spec)?;
                        Item::Replay(only.into_iter().cloned().collect())
                    }
                    None => Item::Replay(frames),
                }
            }
            "--only" => return Err("--only follows --replay FILE".into()),
            name => Item::Step(
                interface
                    .step(name)
                    .ok_or_else(|| format!("no step {name:?}; {} has {}", model.name, list(interface)))?,
            ),
        };
        items.push(item);
    }
    Ok(items)
}

fn read_reports(device: &mut Box<dyn Stream>, size: usize) -> io::Result<()> {
    let mut buf = vec![0u8; size];
    let mut out = io::stdout().lock();
    loop {
        let n = device.read(&mut buf)?;
        if n == 0 {
            return Ok(());
        }
        let ack = if hid::is_ack(&buf[..n]) { "  ack" } else { "" };
        writeln!(out, "in  {}{ack}", trimmed(&buf[..n]))?;
        out.flush()?;
    }
}

fn list(interface: &Interface) -> String {
    interface.steps.iter().map(|s| s.name.as_str()).collect::<Vec<_>>().join(", ")
}

/// Hex without trailing zeros, with the length where cut.
fn trimmed(bytes: &[u8]) -> String {
    let end = bytes.iter().rposition(|&b| b != 0).map_or(0, |i| i + 1);
    let hex = crate::hex(&bytes[..end]);
    if end == bytes.len() { hex } else { format!("{hex} … ({} B)", bytes.len()).trim_start().to_owned() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Vec<Item<'static>>, String> {
        let model = Model::named("DDJ-FLX10").unwrap();
        let args: Vec<String> = args.iter().map(|a| a.replace("FIXTURE", FIXTURE)).collect();
        items(&args, model, model.hid.as_ref().unwrap())
    }

    const FIXTURE: &str =
        concat!(env!("CARGO_MANIFEST_DIR"), "/../dj-controller-core/fixtures/ddj-flx10-rekordbox-connect.json");

    #[test]
    fn steps_and_replays_keep_the_order_named() {
        let items = parse(&["wake", "--replay", "FIXTURE", "--only", "sysex,1", "keepalive"]).unwrap();
        let shape: Vec<String> = items
            .iter()
            .map(|item| match item {
                Item::Step(step) => step.name.clone(),
                Item::Replay(frames) => format!("replay {}", frames.len()),
            })
            .collect();
        assert_eq!(shape, ["wake", "replay 27", "keepalive"]);
        assert!(matches!(&parse(&["--replay", "FIXTURE"]).unwrap()[..], [Item::Replay(f)] if f.len() == 324));
    }

    #[test]
    fn a_misplaced_or_unknown_argument_is_refused() {
        for args in [&["--only", "1"][..], &["--replay"], &["--replay", "FIXTURE", "--only"], &["wakeup"]] {
            assert!(parse(args).is_err(), "{args:?}");
        }
    }

    #[test]
    fn a_report_prints_without_its_trailing_zeros() {
        assert_eq!(trimmed(&[0x30, 0x21, 0, 0x18, 0, 0]), "30 21 00 18 … (6 B)");
        assert_eq!(trimmed(&[0xF0, 0xF7]), "F0 F7");
        assert_eq!(trimmed(&[0, 0]), "… (2 B)");
    }
}
