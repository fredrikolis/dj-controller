// Concern: a fader's or knob's travel as evenly spaced positions, one held by a margin | Non-concern: feeds | IO: (raw, held) -> position
use serde::Serialize;

use crate::error::Error;

// Chosen, no device fact: a TEMPO slider at ±10 % (MAN p.17 item 12) steps by 0.02 %.
pub(crate) const DEFAULT_POSITIONS: u16 = 1001;

pub(crate) const MARGIN: f64 = 0.25;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Positions {
    Default,
    All,
    Count(f64),
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Reading {
    pub position: u16,
    pub value: f64,
    pub raw: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Stepping {
    positions: u16,
    max: u16,
}

impl Stepping {
    pub(crate) fn of(asked: Positions, max: u16) -> Result<Stepping, Error> {
        let all = max + 1;
        let positions = match asked {
            Positions::Default => DEFAULT_POSITIONS.min(all),
            Positions::All => all,
            Positions::Count(n) if n.fract() == 0.0 && n >= 2.0 && n <= f64::from(all) => n as u16,
            Positions::Count(n) => {
                return Err(Error::Refused(format!(
                    "{n} positions: a control reporting 0 to {max} is read at a whole 2 to {all} positions, or \"all\" for each of the {all}"
                )));
            }
        };
        Ok(Stepping { positions, max })
    }

    pub(crate) fn position(&self, raw: u16, held: Option<u16>) -> u16 {
        let at = f64::from(raw) * f64::from(self.positions - 1) / f64::from(self.max);
        match held {
            Some(held) if (at - f64::from(held)).abs() <= 0.5 + MARGIN => held,
            _ => at.round() as u16,
        }
    }

    pub(crate) fn reading(&self, position: u16, raw: u16) -> Reading {
        Reading { position, value: f64::from(position) / f64::from(self.positions - 1), raw }
    }
}
