// Concern: checks each model file against its official MIDI list's rows, extracted from the PDF apart from the model | Non-concern: decoding rules (decode), output ranges (output) | IO: none
//! Each `models/<model>.mml` is `scripts/mml-extract.py rows` run on that model's official list:
//! per message row its page, direction (in, out, both, or a 14-bit half), the channel column, the
//! status column (n or p: the channels the column lists) and data 1. It shares nothing with the model file.

use std::collections::HashSet;

use crate::decode::{Decoder, Event};
use crate::model::{Address, Kind, Model};
use crate::output::Output;

use dj_controller_model::MML as LISTS;

struct Row {
    dir: &'static str,
    addresses: Vec<Address>,
}

fn rows(list: &'static str) -> Vec<Row> {
    list.lines()
        .map(|line| {
            let [_page, dir, channels, status, data1] = line.split(' ').collect::<Vec<_>>()[..] else {
                panic!("{line}")
            };
            let number = u8::from_str_radix(data1, 16).unwrap();
            let kind = if status.starts_with('9') { Kind::Note } else { Kind::Cc };
            let channels = match &status[1..] {
                "n" | "m" | "p" => channels.split('/').map(|c| c.parse::<u8>().unwrap() - 1).collect(),
                nibble => vec![u8::from_str_radix(nibble, 16).unwrap()],
            };
            Row { dir, addresses: channels.into_iter().map(|channel| Address { kind, channel, number }).collect() }
        })
        .collect()
}

/// Each model with its list's addresses in the given directions.
fn lists(dirs: &[&str]) -> Vec<(&'static Model, HashSet<Address>)> {
    LISTS
        .iter()
        .map(|&(file, list)| {
            let model = Model::named(&Model::parse(file).unwrap().name).unwrap();
            let listed = rows(list).into_iter().filter(|r| dirs.contains(&r.dir)).flat_map(|r| r.addresses).collect();
            (model, listed)
        })
        .collect()
}

const INPUTS: &[&str] = &["in", "inout", "in-msb", "in-lsb"];
const OUTPUTS: &[&str] = &["inout", "out", "out-msb", "out-lsb"];

#[test]
fn every_model_has_its_list() {
    assert_eq!(lists(INPUTS).len(), crate::model::models().len());
}

#[test]
fn every_listed_input_decodes_to_a_control() {
    for (model, listed) in lists(INPUTS) {
        for address in listed {
            let mut decoder = Decoder::new(model);
            let mut events = decoder.feed(&address.message(if address.kind == Kind::Note { 0x7F } else { 0x41 }));
            events.extend(decoder.flush());
            assert!(!events.is_empty(), "{} {address}", model.name);
            assert!(events.iter().all(|e| matches!(e, Event::Control { .. })), "{} {address}", model.name);
        }
    }
}

/// Every address a model file puts in one direction, apart from those it marks unlisted.
fn addresses(model: &Model, input: bool, listed: bool) -> HashSet<Address> {
    model
        .controls()
        .iter()
        .filter(|c| c.listed == listed && if input { c.input.is_some() } else { c.output.is_some() })
        .flat_map(|c| [Some(c.midi), c.lsb].into_iter().flatten())
        .collect()
}

#[test]
fn a_model_holds_its_lists_addresses_and_only_the_unlisted_besides() {
    for (input, dirs) in [(true, INPUTS), (false, OUTPUTS)] {
        for (model, listed) in lists(dirs) {
            let mapped = addresses(model, input, true);
            let missing: Vec<_> = listed.difference(&mapped).map(Address::to_string).collect();
            let extra: Vec<_> = mapped.difference(&listed).map(Address::to_string).collect();
            assert_eq!((missing, extra), (vec![], vec![]), "{} {}", model.name, if input { "in" } else { "out" });
            let unlisted = addresses(model, input, false);
            assert!(unlisted.is_disjoint(&listed), "{} marks a listed address unlisted", model.name);
        }
    }
}

#[test]
fn every_listed_output_round_trips() {
    for (model, listed) in lists(&["inout", "out"]) {
        for address in listed {
            let round_trips = [0x00, 0x01, 0x7F].into_iter().any(|value| {
                let message = [address.message(value)];
                Output::decode(model, &message).is_some_and(|o| o.encode().as_deref() == Ok(&message[..]))
            });
            assert!(round_trips, "{} {address}", model.name);
        }
    }
    for ((model, msbs), (_, lsbs)) in lists(&["out-msb"]).into_iter().zip(lists(&["out-lsb"])) {
        for msb in msbs {
            let lsb = Address { number: msb.number + 0x20, ..msb };
            assert!(lsbs.contains(&lsb), "{} {msb} has no LSB row", model.name);
            let pair = [msb.message(0x02), lsb.message(0x67)];
            let output = Output::decode(model, &pair).unwrap_or_else(|| panic!("{} {msb}", model.name));
            assert_eq!(output.encode().as_deref(), Ok(&pair[..]));
        }
    }
}
