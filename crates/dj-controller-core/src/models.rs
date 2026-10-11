// Concern: every known model as typed Rust: its indices, pad modes, each control's identity, the tree of controls, its inputs | Non-concern: writing them (build.rs, generate) | IO: none
//! Generated at build time from each model's file; nothing here is written by hand.

include!(concat!(env!("OUT_DIR"), "/models.rs"));
