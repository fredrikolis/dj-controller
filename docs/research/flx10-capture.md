<!-- Concern: how to capture rekordbox's USB traffic to the FLX10, in which steps, and how to read it | Non-concern: what earlier captures found | IO: none -->
# DDJ-FLX10: capturing rekordbox

Precedent: Loui1979 captured rekordbox in a VMware Windows guest with host `usbmon`
(https://github.com/Loui1979/MIXXX-FLX10/blob/main/tools/WIRESHARK-GUIDE.md,
https://github.com/Loui1979/MIXXX-FLX10/blob/main/tools/flx10-capture.sh); Veezuhz used
USBPcap on Windows [VZ-S]. usbmon sees the URBs because hypervisor USB passthrough goes
through the host kernel's usbfs (https://docs.kernel.org/usb/usbmon.html). Short names are in
[flx10-sources.md](flx10-sources.md).

## A. Linux host + Windows VM (QEMU/libvirt) + usbmon (recommended)

```bash
sudo modprobe usbmon                        # one-time, then:
echo usbmon | sudo tee /etc/modules-load.d/usbmon.conf
sudo usermod -aG wireshark "$USER"          # or: sudo setfacl -m u:$USER:r /dev/usbmon*
lsusb -d 2b73:0041                          # per session: "Bus 003 Device 011: ..."
BUS=3                                       # usbmon has no reliable per-device filter
dumpcap -i usbmon$BUS -s 0 -w ~/captures/flx10_$(date +%F_%H%M)_STEP.pcapng
```
Usage per https://wiki.wireshark.org/CaptureSetup/USB. Pass the device to the guest (libvirt;
https://libvirt.org/formatdomain.html#usb-pci-scsi-devices):
```bash
cat > /tmp/flx10.xml <<'XML'
<hostdev mode='subsystem' type='usb' managed='yes'>
  <source><vendor id='0x2b73'/><product id='0x0041'/></source>
</hostdev>
XML
virsh attach-device win11 /tmp/flx10.xml --live     # detach-device to hand it back
```
Plain QEMU (https://www.qemu.org/docs/master/system/devices/usb.html):
`-device qemu-xhci,id=xhci -device usb-host,bus=xhci.0,vendorid=0x2b73,productid=0x0041`.
Use xHCI so the high-speed iso endpoints work. Start `dumpcap` **before** attaching so the
guest's enumeration is captured; LOU-RB3 and VZ-F both say the gate may be in the
attach-time sequence.

- Audio iso traffic dominates (299 MB in one session): set rekordbox's output to the laptop
  speakers or play no audio [LOU-RB3].
- **Power-cycle the FLX10** (unplug USB and power ~10 s) before each capture [LOU-JOG].
- Filter on the FLX10's device address afterwards.

## B. Windows box + USBPcap

```bat
USBPcapCMD.exe                                   :: lists \\.\USBPcapN root hubs
USBPcapCMD.exe -d \\.\USBPcap1 --capture-from-new-devices --inject-descriptors -s 0 -o C:\cap\flx10_attach.pcap
```
Flags from https://github.com/desowin/usbpcap/blob/master/USBPcapCMD/cmd.c (`--devices 3`
for an already-attached device; `--capture-from-new-devices` catches enumeration).

## What to capture, in order

One action per file; press a known button (e.g. deck-1 SHIFT) as a marker between steps.

1. `00_attach_idle`: plug in, no software running (enumeration, driver/Setting Utility autostart).
2. `01_rekordbox_start`: launch rekordbox, wait for the jog screens to leave the splash
   (vendor ep0 transfers, SysEx handshake, keepalive cadence, first EP5 frames).
3. `02_load_deck1`: load one known track (note length, BPM, key) on deck 1 only. Expect
   `37`/`38` bursts plus `21`/`30`/`2F`/`39`.
4. `03_play_pause_scrub`: play 10 s, pause, scrub (playhead fields in `21`).
5. `04_display_modes`: cycle Deck Info → Waveform → Artwork → DJ Logo (artwork: `33` JPEG).
6. `05_logo_upload`: Image Transfer Tool, upload solid red, solid white, and a 2-pixel
   checkerboard (size and format of `D0`/`D1`).
7. `06_pad_modes_leds`: switch pad modes and pages, set hot-cue colours (pad colour
   palette, `39` labels).
8. `07_four_decks`: load four different tracks at once, to diff per-deck framing [VZ-S].

## Reading a capture

Adapted from VZ-F "How to analyze captures"; fields per the Wireshark USB dissector. On
USBPcap files the HID payload may be `usbhid.data` instead of `usb.capdata`.
```bash
F=~/captures/flx10_..._02_load_deck1.pcapng
DEV=$(tshark -r "$F" -Y 'usb.idVendor == 0x2b73' -T fields -e usb.device_address -c1)
# vendor ep0 transfers (the 7-command sequence)
tshark -r "$F" -Y "usb.device_address==$DEV && usb.bmRequestType==0x40" -T fields -e frame.time_relative -e usb.setup.bRequest -e usb.setup.wValue -e usb.setup.wIndex
# EP5 OUT command histogram (deck byte + command byte)
tshark -r "$F" -Y "usb.device_address==$DEV && usb.endpoint_address==0x05 && usb.src==\"host\"" -T fields -e usb.capdata | cut -c1-4 | sort | uniq -c | sort -rn
# MIDI OUT (host->device) raw USB-MIDI packets incl. SysEx
tshark -r "$F" -Y "usb.device_address==$DEV && usb.endpoint_address==0x03" -T fields -e frame.time_relative -e usb.capdata
# EP4 IN reports
tshark -r "$F" -Y "usb.device_address==$DEV && usb.endpoint_address==0x84" -T fields -e frame.time_relative -e usb.capdata | head
```
