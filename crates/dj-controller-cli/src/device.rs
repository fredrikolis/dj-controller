// Concern: a MIDI port as the core session's link, its blocking reads and writes run on the blocking crate's pool | Non-concern: finding or opening the port, printing | IO: (port) <-> Session

use std::future::Future;
use std::io;
use std::pin::Pin;
use std::time::{Duration, Instant};

use blocking::Unblock;
use dj_controller_core::midi::{self, Framer, Message};
use dj_controller_core::session::{Link, Session};
use futures_lite::{AsyncReadExt, AsyncWriteExt};

use crate::transport::Stream;

pub type Reader = Unblock<Box<dyn Stream>>;
pub type Writes = Pin<Box<dyn Future<Output = io::Result<()>>>>;

/// The session's link: sends go to a writer task in order, so `send` never blocks.
pub struct PortLink {
    sends: async_channel::Sender<Vec<u8>>,
    start: Instant,
}

impl Link for PortLink {
    /// A rawmidi port takes no timestamp: a timed send goes now.
    fn send(&self, bytes: &[u8], _: Option<f64>) -> Result<(), String> {
        self.sends.try_send(bytes.to_vec()).map_err(|e| e.to_string())
    }

    fn now(&self) -> f64 {
        self.start.elapsed().as_secs_f64() * 1000.0
    }

    fn sleep(&self, ms: f64) -> Pin<Box<dyn Future<Output = ()>>> {
        Box::pin(async move {
            async_io::Timer::after(Duration::from_secs_f64(ms.max(0.0) / 1000.0)).await;
        })
    }
}

/// The link over `port`, the task writing its sends, and its reads.
pub fn link(port: Box<dyn Stream>, start: Instant) -> io::Result<(PortLink, Writes, Reader)> {
    let reader = Unblock::new(port.try_clone()?);
    let (sends, queued) = async_channel::unbounded::<Vec<u8>>();
    let mut writer = Unblock::new(port);
    let writes = Box::pin(async move {
        while let Ok(bytes) = queued.recv().await {
            writer.write_all(&bytes).await?;
            writer.flush().await?;
        }
        Ok(())
    });
    Ok((PortLink { sends, start }, writes, reader))
}

pub async fn messages(
    mut reader: Reader,
    mut take: impl FnMut(Result<Message, midi::Error>) -> io::Result<()>,
) -> io::Result<()> {
    let (mut framer, mut buf) = (Framer::new(), vec![0u8; 512]);
    loop {
        let n = reader.read(&mut buf).await?;
        if n == 0 {
            return Ok(());
        }
        for message in framer.feed(&buf[..n]) {
            take(message)?;
        }
    }
}

pub async fn feed(reader: Reader, session: &Session, start: Instant) -> io::Result<()> {
    messages(reader, |framed| {
        session.receive_framed(framed, start.elapsed().as_secs_f64() * 1000.0);
        Ok(())
    })
    .await
}
