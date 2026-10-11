// Concern: why a controller's operation failed or its session ended, each by the one word every transport reports | Non-concern: raising them (session, transports) | IO: none
use std::fmt;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CloseReason {
    Closed,
    Unplugged,
    Aborted,
}

impl CloseReason {
    pub const ALL: [CloseReason; 3] = [CloseReason::Closed, CloseReason::Unplugged, CloseReason::Aborted];

    pub fn name(self) -> &'static str {
        match self {
            CloseReason::Closed => "closed",
            CloseReason::Unplugged => "unplugged",
            CloseReason::Aborted => "aborted",
        }
    }

    pub fn meaning(self) -> &'static str {
        match self {
            CloseReason::Closed => "closed by its owner",
            CloseReason::Unplugged => "the device unplugged",
            CloseReason::Aborted => "the connect's signal aborted",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// The platform has no MIDI to reach a device by.
    Unsupported(String),
    Permission(String),
    /// A port another program holds.
    Busy(String),
    /// A port gone while it opened.
    Gone(String),
    Closed(CloseReason),
    /// A value the control does not take, or no output there.
    Refused(String),
    /// A write to what a control shows before the device has told which bank that is.
    Unshown(String),
    /// The link refused a message.
    Send(String),
    /// No answer to the state request.
    Timeout(String),
}

/// An [`Error`]'s kind in one word.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Code {
    Unsupported,
    Permission,
    Busy,
    Timeout,
    Unplugged,
    Closed,
    Send,
    Refused,
    Unshown,
}

impl Code {
    pub const ALL: [Code; 9] = [
        Code::Unsupported,
        Code::Permission,
        Code::Busy,
        Code::Timeout,
        Code::Unplugged,
        Code::Closed,
        Code::Send,
        Code::Refused,
        Code::Unshown,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Code::Unsupported => "unsupported",
            Code::Permission => "permission",
            Code::Busy => "busy",
            Code::Timeout => "timeout",
            Code::Unplugged => "unplugged",
            Code::Closed => "closed",
            Code::Send => "send",
            Code::Refused => "refused",
            Code::Unshown => "unshown",
        }
    }

    pub fn meaning(self) -> &'static str {
        match self {
            Code::Unsupported => "the platform has no MIDI",
            Code::Permission => "access to MIDI refused",
            Code::Busy => "a port another program holds",
            Code::Timeout => "no answer to the state request",
            Code::Unplugged => "the controller is unplugged",
            Code::Closed => "the controller is closed",
            Code::Send => "the port refused a message",
            Code::Refused => "a value the control does not take",
            Code::Unshown => "a write to what shows before the device has told its pad mode or page",
        }
    }
}

impl Error {
    pub fn code(&self) -> Code {
        match self {
            Error::Unsupported(_) => Code::Unsupported,
            Error::Permission(_) => Code::Permission,
            Error::Busy(_) => Code::Busy,
            Error::Gone(_) | Error::Closed(CloseReason::Unplugged) => Code::Unplugged,
            Error::Closed(_) => Code::Closed,
            Error::Refused(_) => Code::Refused,
            Error::Unshown(_) => Code::Unshown,
            Error::Send(_) => Code::Send,
            Error::Timeout(_) => Code::Timeout,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Closed(reason) => write!(f, "the controller is {}", reason.name()),
            Error::Unsupported(e)
            | Error::Permission(e)
            | Error::Busy(e)
            | Error::Gone(e)
            | Error::Refused(e)
            | Error::Unshown(e)
            | Error::Send(e)
            | Error::Timeout(e) => f.write_str(e),
        }
    }
}

impl std::error::Error for Error {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_code_is_listed_once() {
        let names: std::collections::HashSet<&str> = Code::ALL.iter().map(|c| c.name()).collect();
        assert_eq!(names.len(), Code::ALL.len());
        let reasons: std::collections::HashSet<&str> = CloseReason::ALL.iter().map(|r| r.name()).collect();
        assert_eq!(reasons.len(), CloseReason::ALL.len());
    }
}
