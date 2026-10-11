// Concern: the Linux backend: rawmidi, hidraw, usbfs and the udev rule, each found by USB id | Non-concern: what is sent or printed | IO: device files, sysfs, procfs, /etc/udev
//! Reads and writes device files directly, so it needs no ALSA, HID or USB library.

use std::ffi::{c_int, c_ulong, c_void};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};
use std::process::Command;

use dj_controller_core::hid::{Setup, Via};
use dj_controller_core::model::Model;

use crate::transport::{Port, Stream, Transport};

const RULE_FILE: &str = "/etc/udev/rules.d/70-dj-controller.rules";

pub struct Linux;

impl Stream for File {
    fn try_clone(&self) -> io::Result<Box<dyn Stream>> {
        Ok(Box::new(File::try_clone(self)?))
    }
}

fn open(path: &Path, write: bool) -> Result<File, String> {
    OpenOptions::new().read(true).write(write).open(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// A hidraw node: each read or write is one report (Linux Documentation/hid/hidraw.rst). The
/// device numbers no reports (LOU-JOG), so reads carry no id and each write puts id 0 first.
struct Hidraw(File);

impl Read for Hidraw {
    fn read(&mut self, report: &mut [u8]) -> io::Result<usize> {
        self.0.read(report)
    }
}

impl Write for Hidraw {
    fn write(&mut self, report: &[u8]) -> io::Result<usize> {
        let framed = [&[0][..], report].concat();
        if self.0.write(&framed)? != framed.len() {
            return Err(io::Error::new(io::ErrorKind::WriteZero, "hidraw took part of a report"));
        }
        Ok(report.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.0.flush()
    }
}

impl Stream for Hidraw {
    fn try_clone(&self) -> io::Result<Box<dyn Stream>> {
        Ok(Box::new(Hidraw(self.0.try_clone()?)))
    }
}

impl Transport for Linux {
    fn midi(&self, path: Option<&str>, write: bool) -> Result<Port, String> {
        let path = path.map_or_else(find_port, |p| Ok(PathBuf::from(p)))?;
        let model = card_of_port(&path).and_then(model_of_card);
        Ok(Port { stream: Box::new(open(&path, write)?), model, name: path.display().to_string() })
    }

    fn hid(&self) -> Result<Port, String> {
        let (path, model) = find_hidraw()?;
        Ok(Port { stream: Box::new(Hidraw(open(&path, true)?)), model: Some(model), name: path.display().to_string() })
    }

    fn control(&self, model: &Model, setup: Setup) -> Result<(), String> {
        let path = find_usbfs(model)?;
        control(&path, setup).map_err(|e| format!("{}: {e}", path.display()))
    }

    fn access(&self, install: bool) -> Result<String, String> {
        let rule = udev_rule();
        if install {
            fs::write(RULE_FILE, &rule).map_err(|e| format!("{RULE_FILE}: {e} (run as root)"))?;
            for args in
                [&["control", "--reload"][..], &["trigger", "--subsystem-match=usb", "--subsystem-match=hidraw"]]
            {
                let status = Command::new("udevadm").args(args).status().map_err(|e| format!("udevadm: {e}"))?;
                if !status.success() {
                    return Err(format!("udevadm {}: {status}", args.join(" ")));
                }
            }
            eprintln!("installed {RULE_FILE}");
        }
        Ok(rule)
    }
}

/// The rawmidi device of the first card a known model owns.
fn find_port() -> Result<PathBuf, String> {
    let cards = fs::read_dir("/proc/asound").map_err(|e| format!("/proc/asound: {e}"))?;
    let mut seen = Vec::new();
    for entry in cards.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(card) = name.strip_prefix("card").filter(|n| n.parse::<u32>().is_ok()) else { continue };
        let Some(usbid) = usbid(card) else { continue };
        if model_of_usbid(&usbid).is_some() {
            return Ok(PathBuf::from(format!("/dev/snd/midiC{card}D0")));
        }
        seen.push(format!("card {card} ({usbid})"));
    }
    let known: Vec<_> = dj_controller_core::model::models()
        .iter()
        .map(|m| format!("{} {:04x}:{:04x}", m.name, m.usb_vendor, m.usb_product))
        .collect();
    Err(format!("no known controller among USB cards [{}]; known: {}", seen.join(", "), known.join(", ")))
}

/// The `usbid` ALSA's USB driver writes under /proc/asound/card<N>/ as `vvvv:pppp`.
fn usbid(card: &str) -> Option<String> {
    Some(fs::read_to_string(format!("/proc/asound/card{card}/usbid")).ok()?.trim().to_owned())
}

/// The known model that owns ALSA card `card`, by its USB ids.
fn model_of_card(card: &str) -> Option<&'static Model> {
    model_of_usbid(&usbid(card)?)
}

fn model_of_usbid(usbid: &str) -> Option<&'static Model> {
    let (vendor, product) = usbid.split_once(':')?;
    Model::of_usb(u16::from_str_radix(vendor, 16).ok()?, u16::from_str_radix(product, 16).ok()?)
}

/// The card number in a rawmidi device path, `/dev/snd/midiC<card>D<device>`.
fn card_of_port(path: &Path) -> Option<&str> {
    let name = path.file_name()?.to_str()?;
    let (card, device) = name.strip_prefix("midiC")?.split_once('D')?;
    (card.parse::<u32>().is_ok() && device.parse::<u32>().is_ok()).then_some(card)
}

fn find_hidraw() -> Result<(PathBuf, &'static Model), String> {
    let nodes = fs::read_dir("/sys/class/hidraw").map_err(|e| format!("/sys/class/hidraw: {e}"))?;
    let mut seen = Vec::new();
    for node in nodes.flatten() {
        let uevent = fs::read_to_string(node.path().join("device/uevent")).unwrap_or_default();
        let Some((vendor, product)) = hid_id(&uevent) else { continue };
        let name = node.file_name().to_string_lossy().into_owned();
        match Model::of_usb(vendor, product) {
            Some(model) if model.hid.is_some() => return Ok((Path::new("/dev").join(name), model)),
            _ => seen.push(format!("{name} ({vendor:04x}:{product:04x})")),
        }
    }
    Err(format!("no known controller's HID interface among hidraw nodes [{}]", seen.join(", ")))
}

/// The ids in uevent's `HID_ID=bus:vendor:product`, hex (Linux hid-core `%04X:%08X:%08X`).
fn hid_id(uevent: &str) -> Option<(u16, u16)> {
    let id = uevent.lines().find_map(|l| l.strip_prefix("HID_ID="))?;
    let mut fields = id.split(':').skip(1).map(|f| u32::from_str_radix(f, 16).ok().and_then(|v| u16::try_from(v).ok()));
    Some((fields.next()??, fields.next()??))
}

/// The usbfs node of the USB device with `model`'s ids: sysfs `idVendor`, `idProduct`, `busnum`
/// and `devnum` (Linux Documentation/ABI/stable/sysfs-bus-usb) name `/dev/bus/usb/BBB/DDD`.
fn find_usbfs(model: &Model) -> Result<PathBuf, String> {
    let devices = fs::read_dir("/sys/bus/usb/devices").map_err(|e| format!("/sys/bus/usb/devices: {e}"))?;
    for device in devices.flatten() {
        let read = |name: &str| fs::read_to_string(device.path().join(name)).ok().map(|s| s.trim().to_owned());
        let id = |name: &str| read(name).and_then(|s| u16::from_str_radix(&s, 16).ok());
        let number = |name: &str| read(name).and_then(|s| s.parse::<u16>().ok());
        if (id("idVendor"), id("idProduct")) != (Some(model.usb_vendor), Some(model.usb_product)) {
            continue;
        }
        if let (Some(bus), Some(dev)) = (number("busnum"), number("devnum")) {
            return Ok(PathBuf::from(format!("/dev/bus/usb/{bus:03}/{dev:03}")));
        }
    }
    Err(format!("no USB device {:04x}:{:04x} in /sys/bus/usb/devices", model.usb_vendor, model.usb_product))
}

/// `struct usbdevfs_ctrltransfer` (Linux include/uapi/linux/usbdevice_fs.h).
#[repr(C)]
struct CtrlTransfer {
    request_type: u8,
    request: u8,
    value: u16,
    index: u16,
    length: u16,
    timeout_ms: u32,
    data: *mut c_void,
}

/// `_IOWR('U', 0, struct usbdevfs_ctrltransfer)`, as include/uapi/asm-generic/ioctl.h packs it.
const USBDEVFS_CONTROL: c_ulong = (3 << 30) | ((size_of::<CtrlTransfer>() as c_ulong) << 16) | ((b'U' as c_ulong) << 8);
const CONTROL_TIMEOUT_MS: u32 = 1000;

unsafe extern "C" {
    fn ioctl(fd: c_int, request: c_ulong, ...) -> c_int;
}

/// One transfer, no interface claimed: usbfs asks none for a device-recipient request.
fn control(path: &Path, setup: Setup) -> io::Result<()> {
    let device = OpenOptions::new().read(true).write(true).open(path)?;
    let Setup { request_type, request, value, index } = setup;
    let mut transfer = CtrlTransfer {
        request_type,
        request,
        value,
        index,
        length: 0,
        timeout_ms: CONTROL_TIMEOUT_MS,
        data: std::ptr::null_mut(),
    };
    // SAFETY: the fd is open and `transfer` is the struct this request takes, with no data to point at.
    if unsafe { ioctl(device.as_raw_fd(), USBDEVFS_CONTROL, &raw mut transfer) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// Per model with HID setup steps, its ids from its file: hidraw for WebHID and `dj-controller-cli hid`,
/// and usbfs where a step goes over control transfers, with `uaccess` as
/// docs/research/flx10-browser.md "Linux udev rule" has it.
fn udev_rule() -> String {
    let mut rule = String::new();
    for model in dj_controller_core::model::models() {
        let Some(hid) = &model.hid else { continue };
        let ids = |attr: &str| {
            format!(
                "{attr}{{idVendor}}==\"{:04x}\", {attr}{{idProduct}}==\"{:04x}\"",
                model.usb_vendor, model.usb_product
            )
        };
        rule += &format!("# {}: USB ids {}\n", model.name, model.usb_source);
        rule += &format!("KERNEL==\"hidraw*\", {}, MODE=\"0660\", TAG+=\"uaccess\"\n", ids("ATTRS"));
        if hid.steps.iter().any(|s| s.via == Via::Control) {
            rule += &format!("SUBSYSTEM==\"usb\", {}, MODE=\"0660\", TAG+=\"uaccess\"\n", ids("ATTR"));
        }
    }
    rule
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hidraw_write_puts_report_id_0_before_the_report() {
        let path = std::env::temp_dir().join(format!("dj-controller-cli-hidraw-{}", std::process::id()));
        let mut node = Hidraw(File::create(&path).unwrap());
        node.write_all(&[0x30, 0x21]).unwrap();
        assert_eq!(fs::read(&path).unwrap(), [0, 0x30, 0x21]);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn a_rawmidi_path_names_its_card() {
        assert_eq!(card_of_port(Path::new("/dev/snd/midiC1D0")), Some("1"));
        assert_eq!(card_of_port(Path::new("/dev/snd/midiC12D3")), Some("12"));
        assert_eq!(card_of_port(Path::new("/tmp/capture.mid")), None);
        assert_eq!(card_of_port(Path::new("/dev/snd/midiCxD0")), None);
    }

    #[test]
    fn a_usbid_names_a_known_model() {
        for model in dj_controller_core::model::models() {
            let usbid = format!("{:04x}:{:04x}", model.usb_vendor, model.usb_product);
            assert_eq!(model_of_usbid(&usbid), Some(model));
        }
        assert_eq!(model_of_usbid("0000:0000"), None);
    }

    #[test]
    fn a_uevent_names_its_usb_ids() {
        let uevent = "DRIVER=hid-generic\nHID_ID=0003:00002B73:00000041\nHID_NAME=AlphaTheta DDJ-FLX10\n";
        assert_eq!(hid_id(uevent), Some((0x2B73, 0x0041)));
        assert_eq!(hid_id("HID_NAME=x\n"), None);
        assert_eq!(hid_id("HID_ID=0003:00012B73:00000041\n"), None);
    }

    #[test]
    #[cfg(target_pointer_width = "64")]
    fn the_control_request_number_is_the_one_64_bit_linux_defines() {
        // _IOWR('U', 0, 24 bytes): usbdevice_fs.h, asm-generic/ioctl.h.
        assert_eq!(USBDEVFS_CONTROL, 0xC018_5500);
    }

    #[test]
    fn the_udev_rule_opens_the_flx10s_hidraw_and_usbfs_nodes_by_its_file_ids() {
        let rule = udev_rule();
        let lines: Vec<&str> = rule.lines().filter(|l| !l.starts_with('#')).collect();
        assert_eq!(
            lines,
            [
                r#"KERNEL=="hidraw*", ATTRS{idVendor}=="2b73", ATTRS{idProduct}=="0041", MODE="0660", TAG+="uaccess""#,
                r#"SUBSYSTEM=="usb", ATTR{idVendor}=="2b73", ATTR{idProduct}=="0041", MODE="0660", TAG+="uaccess""#,
            ]
        );
    }
}
