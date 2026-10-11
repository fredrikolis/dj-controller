// Concern: what the CLI needs from an OS: a controller's MIDI and HID byte streams, control transfers, device access | Non-concern: any OS's plumbing (linux.rs) | IO: none
use std::io::{self, Read, Write};

use dj_controller_core::hid::Setup;
use dj_controller_core::model::Model;

pub trait Stream: Read + Write + Send {
    fn try_clone(&self) -> io::Result<Box<dyn Stream>>;
}

pub struct Port {
    pub stream: Box<dyn Stream>,
    pub model: Option<&'static Model>,
    pub name: String,
}

pub trait Transport {
    fn midi(&self, path: Option<&str>, write: bool) -> Result<Port, String>;
    /// One report per read or write, a report without its id; opening sends nothing.
    fn hid(&self) -> Result<Port, String>;
    fn control(&self, model: &Model, out_without_data: Setup) -> Result<(), String>;
    /// What lets the user open the devices (Linux: a udev rule), installed if `install`.
    fn access(&self, install: bool) -> Result<String, String>;
}

#[cfg(target_os = "linux")]
pub fn os() -> impl Transport {
    crate::linux::Linux
}

#[cfg(not(target_os = "linux"))]
pub fn os() -> impl Transport {
    Unavailable
}

#[cfg(not(target_os = "linux"))]
struct Unavailable;

#[cfg(not(target_os = "linux"))]
impl Unavailable {
    fn refuse<T>(&self) -> Result<T, String> {
        Err(format!("dj-controller-cli has no device backend for {} yet; only Linux", std::env::consts::OS))
    }
}

#[cfg(not(target_os = "linux"))]
impl Transport for Unavailable {
    fn midi(&self, _: Option<&str>, _: bool) -> Result<Port, String> {
        self.refuse()
    }
    fn hid(&self) -> Result<Port, String> {
        self.refuse()
    }
    fn control(&self, _: &Model, _: Setup) -> Result<(), String> {
        self.refuse()
    }
    fn access(&self, _: bool) -> Result<String, String> {
        self.refuse()
    }
}
