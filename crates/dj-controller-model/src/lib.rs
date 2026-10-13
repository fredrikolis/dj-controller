// Concern: every model as its data file states it, checked, with the MIDI it is written in and its surface | Non-concern: decoding, state, sending (dj-controller-core) | IO: (models/*) -> Model, Surface
//! A model is data alone: adding one needs only its file under models/ (docs/research/model-format.md).

pub mod beat_fx;
#[cfg(any(feature = "generate", test))]
pub mod generate;
pub mod midi;
pub mod model;
pub mod steps;
pub mod surface;

/// Each model file's text with its official list's rows, as `scripts/mml-extract.py rows` cut them.
#[cfg(feature = "mml")]
pub const MML: &[(&str, &str)] = include!(concat!(env!("OUT_DIR"), "/mml.rs"));
