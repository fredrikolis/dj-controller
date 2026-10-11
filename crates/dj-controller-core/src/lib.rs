// Concern: the protocol core every transport shares, with no I/O | Non-concern: opening a port or device (dj-controller, dj-controller-cli) | IO: none
//! A model is a data file naming each of its messages by the physical control that sends it.

pub use dj_controller_model::{midi, model, surface};

pub mod capture;
pub mod controls;
pub mod decode;
pub mod error;
pub mod hid;
pub mod lease;
pub mod ledger;
#[cfg(test)]
mod mml;
pub mod models;
pub mod output;
pub mod schedule;
pub mod session;
pub mod state;
pub mod usb_midi;
