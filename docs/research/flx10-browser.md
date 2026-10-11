<!-- Concern: which browser API reaches which FLX10 interface on which platform, and the OS setup each needs | Non-concern: the protocols spoken over them | IO: none -->
# DDJ-FLX10: browser platform support

Source short names are in [flx10-sources.md](flx10-sources.md).

| API | Chrome desktop | Chrome Android | Requirements | Sources |
|---|---|---|---|---|
| **Web MIDI** | yes (since 43) | yes; `android.media.midi` via `MidiManagerAndroid` when the system has FEATURE_MIDI | secure context; **since Chrome 124 every `requestMIDIAccess()` prompts**, not just SysEx; ask `{sysex:true}` only if needed; permissions policy `midi` | BCD `api/Navigator.json`; https://developer.chrome.com/blog/web-midi-permission-prompt; https://github.com/chromium/chromium/blob/main/media/midi/midi_manager_android.cc |
| **WebHID** | yes (since 89), desktop only | **not supported** (BCD `chrome_android: false`, crbug 40628009) | secure context, user-gesture `requestDevice` chooser, permissions policy `hid`. Vendor page 0xFFA0 is not a protected usage. No report IDs ⇒ `sendReport(0, data128)` | BCD `api/HID.json`; https://developer.chrome.com/docs/capabilities/hid; https://wicg.github.io/webhid/ |
| **WebUSB** | yes (since 61) | yes (BCD mirror) | secure context, chooser, permissions policy `usb`. **Protected interface classes cannot be claimed: 0x01 Audio, 0x03 HID, 0x08, 0x09, 0x0B, 0x0E, 0x10, 0xE0**; only Isolated Web Apps with `usb-unrestricted` may | WEBUSB "Protected interface classes", `claimInterface`, "Permissions Policy"; BCD `api/USB.json` |

## Web MIDI port names

Researched 2026-10-08. `dj_controller_core::model::Model::owns_port` matches the product name anywhere in a
port's name, ignoring case and non-alphanumerics, unless a digit follows it.
- **Linux:** Chrome passes the ALSA sequencer port name unchanged (`snd_seq_port_info_get_name`,
  https://github.com/chromium/chromium/blob/main/media/midi/midi_manager_alsa.cc); the kernel
  names it `"<iProduct> MIDI <n>"` when the jack has no iJack string
  (https://github.com/torvalds/linux/blob/master/sound/usb/midi.c). Seen as `DDJ-FLX4 MIDI 1`
  (https://github.com/salesforcedoc/rbpi4b/blob/HEAD/docs/15-flx4-midi.md).
- **Windows:** Chrome's default backend is WinMM (`kMidiManagerWinrt` is disabled,
  `media/midi/midi_features.cc`); the name is `szPname`, at most 31 characters. Ports past the
  first read `MIDIOUT2 (Device)`; a second identical unit gets `2- Device`, or `Device (2)` in
  Windows MIDI Services' new-style names, which may use iJack strings instead
  (https://microsoft.github.io/MIDI/kb/midi1-name-mapping/). **[unverified for the FLX10]**
- **macOS:** `kMIDIPropertyDisplayName` (`media/midi/midi_manager_mac.cc`), which CoreMIDI
  builds from device and entity names. **[unverified: `DDJ-FLX10` assumed]**
- **Android:** every port of a device is named `GetProductName()`, `PROPERTY_PRODUCT` or else
  `PROPERTY_NAME`, which may lead with the maker (`media/midi/midi_manager_android.cc`,
  `MidiDeviceAndroid.java`). **[unverified for the FLX10]**

## WebUSB control transfers

Per WEBUSB "check the validity of the control transfer parameters":
- `standard` OUT is rejected (no SET_INTERFACE).
- `class` requests aimed at a protected interface are rejected (no UAC SET_CUR).
- `recipient: "interface"` or `"endpoint"` needs a claimed, unprotected interface.
- **`requestType: "vendor"` with `recipient: "device"` has no such check**, so the FLX10's 7
  vendor transfers (`0x40` = vendor | device | OUT; [flx10-displays.md](flx10-displays.md))
  are spec-legal from WebUSB without claiming anything.

The OS must still let Chrome open the device:
- Linux: a udev rule for usbfs (below).
- Windows: a WinUSB-bound function, which the FLX10 almost certainly lacks; otherwise a
  manually installed INF (https://developer.chrome.com/docs/capabilities/usb)
  **[unverified for this device]**.
- The FLX10 is not on the WebUSB blocklist
  (https://raw.githubusercontent.com/WICG/webusb/main/blocklist.txt has no `2b73` entry).

## What each platform reaches

- **Desktop:** WebHID sends the 128 B EP5 reports (`sendReport(0, …)`), Web MIDI the SysEx
  handshake. The ep0 vendor transfers cannot go over WebHID; over WebUSB they need a udev
  rule on Linux and realistically fail on Windows. Fallback: a one-time native helper or a
  udev `RUN` that fires them on plug-in **[unverified that they are needed for display;
  LOU-JOG says they work with drivers bound]**.
- **Android:** interface 5 is class 0x03 (HID), so `claimInterface(5)` rejects with
  SecurityError; interfaces 0–2 and 4 are Audio (0x01), also protected. Only interface 3
  (vendor) and device-recipient vendor control transfers are reachable, so WebUSB cannot
  reach EP4/EP5 under the current spec. IWAs are the only escape hatch and are not an
  Android-Chrome feature **[unverified for Android]**. Android gets Web MIDI, which still
  carries the ch16 jog-display scalars.

## Linux udev rule

`dj-controller-cli udev` prints it from the model files' USB ids, and `sudo dj-controller-cli udev --install`
writes `/etc/udev/rules.d/70-dj-controller.rules` and reloads udev. One file, following
https://developer.chrome.com/docs/capabilities/hid and
https://developer.chrome.com/docs/capabilities/usb, with `uaccess` instead of a group:
```
# WebHID: vendor HID interface (hidraw)
KERNEL=="hidraw*", ATTRS{idVendor}=="2b73", ATTRS{idProduct}=="0041", MODE="0660", TAG+="uaccess"
# WebUSB (only if the page sends the ep0 vendor transfers)
SUBSYSTEM=="usb", ATTR{idVendor}=="2b73", ATTR{idProduct}=="0041", MODE="0660", TAG+="uaccess"
```
Then `sudo udevadm control --reload && sudo udevadm trigger` and replug. Windows needs
nothing for WebHID: the HID class driver binds and Chrome opens the collection
**[unverified on this device; Pioneer's driver may hold it]**.

## Cross-origin isolation

SharedArrayBuffer / wasm threads need `Cross-Origin-Opener-Policy: same-origin` plus
`Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`)
(https://web.dev/articles/coop-coep;
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer).
These headers do not disable Web MIDI, WebHID or WebUSB, which have their own
permissions-policy features defaulting to `self` (WEBUSB "Permissions Policy"). All three
need a secure context; `http://localhost` counts for testing
(https://www.chromium.org/developers/design-documents/web-midi/).
