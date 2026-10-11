// Concern: prints a controller's messages raw and as typed inputs, after a state request if asked, or a frame list; routes hid, udev, package | Non-concern: decoding, OS | IO: (Transport) -> stdout
//! Platform-free: every device goes through `transport::Transport`, whose OS backend is its own module.

use std::io::{self, Write};
use std::process::ExitCode;

use dj_controller_core::capture::Payload;
use std::time::Instant;

use dj_controller_core::decode::Event;
use dj_controller_core::error::CloseReason;
use dj_controller_core::midi::Message;
use dj_controller_core::model::{Address, Model};
use dj_controller_core::models;
use dj_controller_core::session::{Received, Session};
use futures_lite::{StreamExt, future};

use crate::transport::{Port, Transport};

mod device;
mod hid;
#[cfg(target_os = "linux")]
mod linux;
mod package;
mod transport;

const USAGE: &str = "usage: dj-controller-cli [--state] [PORT]\n\
       dj-controller-cli hid [STEP | --replay FILE [--only FRAMES]]...\n\
       dj-controller-cli capture MODEL FILE [--only FRAMES]\n\
       dj-controller-cli udev [--install]\n\
       dj-controller-cli package [--dev] OUT\n\
    With no PORT (Linux: /dev/snd/midiC<card>D<device>), opens the first known model's MIDI\n\
    port, found by its USB ids.\n\
    --state sends the model's state request once at start, so the device reports every\n\
    control's current position.\n\
    hid (experimental) opens the first known model's vendor HID interface, sends each named\n\
    setup step in order (control steps as USB control transfers, MIDI steps to the MIDI port,\n\
    HID steps as reports; a repeating step keeps repeating), then prints every input report.\n\
    With no step it only reads.\n\
    --replay sends a captured frame list (JSON [[\"ep<N>\", hex], ...], one USB transfer each)\n\
    in its order: frames on the model's MIDI endpoint as the MIDI messages they decode to,\n\
    frames on its HID endpoint as reports. --only keeps the frames named: 0-based indices,\n\
    a-b ranges and groups (sysex, outputs, unlisted, hid), comma-separated.\n\
    capture prints each frame of a frame list as MODEL reads it, its group and the output\n\
    each message addresses, and sends nothing.\n\
    udev prints the udev rule that opens each known model's HID and USB device nodes to the\n\
    logged-in user, from the model files' USB ids; --install, run as root, writes it to\n\
    /etc/udev/rules.d and reloads udev. Linux only.\n\
    package builds the dj-controller npm package into OUT, as npm publishes it:\n\
    release wasms unless --dev. Needs this checkout, wasm-pack and npx.\n\
    dj-controller-cli writes nothing to a device but the state request and the steps and frames named.";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        println!("{USAGE}");
        return ExitCode::SUCCESS;
    }
    let os = transport::os();
    let result = match args.first().map(String::as_str) {
        Some("hid") => hid::run(&args[1..], &os),
        Some("capture") => capture(&args[1..]),
        Some("package") => package::run(&args[1..]),
        Some("udev") => match &args[1..] {
            [] => os.access(false).map(|rule| print!("{rule}")),
            [flag] if flag == "--install" => os.access(true).map(|rule| print!("{rule}")),
            _ => Err(USAGE.into()),
        },
        _ => monitor_args(&args, &os),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}

/// Prints a frame list as `capture` in USAGE.
fn capture(args: &[String]) -> Result<(), String> {
    let (name, path, spec) = match args {
        [name, path] => (name, path, None),
        [name, path, only, spec] if only == "--only" => (name, path, Some(spec)),
        _ => return Err(USAGE.into()),
    };
    let model = Model::named(name).ok_or_else(|| format!("no model {name:?}"))?;
    let frames = dj_controller_core::capture::parse(model, &read(path)?).map_err(|e| format!("{path}: {e}"))?;
    let frames = match spec {
        Some(spec) => dj_controller_core::capture::select(&frames, spec)?,
        None => frames.iter().collect(),
    };
    for frame in frames {
        let head = format!("{:>4} ep{} {:<8}", frame.index, frame.endpoint, frame.group.name());
        match &frame.payload {
            Payload::Report(report) => println!("{head} {}", hex(report)),
            Payload::Midi(messages) => {
                for message in messages {
                    let raw = message.encode().expect("a parsed message encodes");
                    let named = Address::of(message).and_then(|(address, value)| {
                        let (control, part) = model.output_at(address)?;
                        Some(format!("   {} {part:?} {value}   [{}]", control.name(), control.source))
                    });
                    println!("{head} {}{}", hex(&raw), named.unwrap_or_default());
                }
            }
        }
    }
    Ok(())
}

fn monitor_args(args: &[String], os: &impl Transport) -> Result<(), String> {
    let (mut state, mut path) = (false, None);
    for arg in args {
        match arg.as_str() {
            "--state" => state = true,
            _ if arg.starts_with('-') || path.is_some() => return Err(USAGE.into()),
            _ => path = Some(arg.as_str()),
        }
    }
    let port = os.midi(path, state)?;
    match port.model {
        Some(model) => eprintln!("{} at {}", model.name, port.name),
        None => eprintln!("{}: no known model; showing raw MIDI", port.name),
    }
    if state && port.model.and_then(Model::request_state).is_none() {
        return Err(format!("{}: no known model with a state request", port.name));
    }
    let name = port.name.clone();
    future::block_on(monitor(port, state)).map_err(|e| format!("{name}: {e}"))
}

/// Prints each message, and below it the typed inputs its model reads in it where known. With
/// `state`, the model's state request is written once, the port's input already open.
async fn monitor(port: Port, state: bool) -> io::Result<()> {
    let start = Instant::now();
    let Some(model) = port.model else {
        let reader = blocking::Unblock::new(port.stream);
        return device::messages(reader, |message| {
            match message {
                Ok(message) => match message.encode() {
                    Ok(raw) => println!("{:<9} {}", hex(&raw), line(&message)),
                    Err(e) => println!("unencodable ({e}): {}", line(&message)),
                },
                Err(e) => println!("malformed: {e}"),
            }
            Ok(())
        })
        .await;
    };
    let (link, writes, reader) = device::link(port.stream, start)?;
    let session = Session::new(model, link);
    let mut received = session.received();
    if state {
        session.send_raw(model.request_state().expect("checked above")).map_err(io::Error::other)?;
        eprintln!("sent the state request {}", hex(model.request_state().expect("checked above")));
    }
    let read = async {
        let read = device::feed(reader, &session, start).await;
        session.close(CloseReason::Unplugged);
        read
    };
    let print = async {
        let mut out = io::stdout().lock();
        while let Some(received) = received.next().await {
            print(&mut out, model, &received)?;
        }
        Ok(())
    };
    future::or(async { future::try_zip(read, print).await.map(drop) }, writes).await
}

/// One message, then each typed input in it, with where the official list documents it.
fn print(out: &mut impl Write, model: &'static Model, received: &Received) -> io::Result<()> {
    match &received.message {
        Some(Ok(message)) => writeln!(out, "{:<9} {}", hex(&received.bytes), line(message))?,
        Some(Err(e)) => writeln!(out, "malformed: {e}")?,
        None => {}
    }
    for event in &received.events {
        match event {
            Event::Control { control, value, .. } => {
                let input = models::input(model, model.row(control), *value);
                writeln!(out, "          = {input:?}   [{}]", control.source)?;
            }
            Event::Unmapped(message) => writeln!(out, "          = unmapped {}", line(message))?,
        }
    }
    out.flush()
}

/// One message as a line: its kind, its 1-based channel as MIDI gear labels it, its fields.
fn line(message: &Message) -> String {
    let channel = message.channel().map(|c| format!(" ch {:>2}", c + 1)).unwrap_or_default();
    let fields = match message {
        Message::NoteOff { note, velocity, .. } => format!("note-off{channel} note {note:>3} velocity {velocity:>3}"),
        Message::NoteOn { note, velocity, .. } => format!("note-on{channel} note {note:>3} velocity {velocity:>3}"),
        Message::PolyPressure { note, pressure, .. } => {
            format!("poly-pressure{channel} note {note:>3} pressure {pressure:>3}")
        }
        Message::ControlChange { control, value, .. } => format!("cc{channel} control {control:>3} value {value:>3}"),
        Message::ProgramChange { program, .. } => format!("program{channel} program {program:>3}"),
        Message::ChannelPressure { pressure, .. } => format!("channel-pressure{channel} pressure {pressure:>3}"),
        Message::PitchBend { value, .. } => format!("pitch-bend{channel} value {value:>5}"),
        Message::SysEx(body) => format!("sysex {}", hex(body)),
        Message::System { status, data } => format!("system {status:02X} {}", hex(data)),
    };
    fields.trim_end().to_owned()
}

fn read(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" ")
}
