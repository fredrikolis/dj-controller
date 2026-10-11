<!-- Concern: the sources the FLX10 research notes cite, and the prior art behind them | Non-concern: what each source says (other flx10-*.md) | IO: none -->
# DDJ-FLX10: sources and prior art

Researched 2026-10-08 with the FLX10 unplugged (sysfs showed no `2b73` device); nothing was
sent to it. Descriptor facts come from `docs/vision.md` and the cited captures. **[unverified]**
marks community inference, sources that contradict each other, or reasoning not tested on
hardware. The other notes cite these short names.

| Short name | What it is | URL |
|---|---|---|
| **MML** | Official "DDJ-FLX10 List of MIDI message", AlphaTheta, © 2023, 7 pages A3, PDF "E1" (created 2023-03-05), sha256 `c6fbe89c…0ac26c`. The official host returned HTTP 403 to scripted fetches; the copy used is Loui1979's mirror | official: https://www.pioneerdj.com/-/media/pioneerdj/software-info/controller/ddj-flx10/ddj-flx10_midi_message_list_e1.pdf (linked from https://virtualdj.com/forums/251695/VirtualDJ_Technical_Support/Pioneer_DDJ-FLX10_Virtual_DJ_Support_.html?page=4 and https://support.alphatheta.com/en-US/articles/16716711647129?product=16715825715481); copy used: https://github.com/Loui1979/MIXXX-FLX10/blob/main/DDJ-FLX10_MIDI_Message_List_E1.pdf |
| **MAN** | DDJ-FLX10 operating instructions (English) | https://github.com/Loui1979/MIXXX-FLX10/blob/main/MIXXX-FLX10%20INDEX/DDJ-FLX10_manual_EN.pdf (also https://www.fullcompass.com/common/files/85661-DDJFLX10OwnersManual.pdf) |
| **VZ-F** | Veezuhz (Victor Pineda), "FLX10 jog wheel screen protocol: findings", May 2026, no license | https://github.com/Veezuhz/Mixxx_FLX10_Controller_Mapping/blob/main/DDJ-FLX10%20Screen%20Protocol/FLX10-SCREEN-PROTOCOL-FINDINGS.md |
| **VZ-S** | Veezuhz, earlier `screen-protocol.md` | https://github.com/Veezuhz/Mixxx_FLX10_Controller_Mapping/blob/main/DDJ-FLX10%20Screen%20Protocol/screen-protocol.md |
| **VZ-R** | Veezuhz, `README-SCREEN.md` | https://github.com/Veezuhz/Mixxx_FLX10_Controller_Mapping/blob/main/README-SCREEN.md |
| **LOU-JS** | Loui1979 Mixxx mapping script (Unlicense) | https://github.com/Loui1979/MIXXX-FLX10/blob/main/Controllers/Pioneer-DDJ-FLX10-script.js |
| **LOU-HID** | Loui1979 `HID/README.md` (relay daemon) | https://github.com/Loui1979/MIXXX-FLX10/blob/main/HID/README.md |
| **LOU-RB3** | Loui1979 `captures/FINDINGS_rekordbox3.md` (Sep 2026) | https://github.com/Loui1979/MIXXX-FLX10/blob/main/captures/FINDINGS_rekordbox3.md |
| **LOU-JOG** | Loui1979 `captures/FINDINGS_rekordbox_jogscreen.md` (2026-09-16/17) | https://github.com/Loui1979/MIXXX-FLX10/blob/main/captures/FINDINGS_rekordbox_jogscreen.md |
| **LOU-RELAY** | Loui1979 `HID/flx10_relay_daemon.py`; its screen packet builders are ported from Veezuhz and credited so, so only their facts are used | https://github.com/Loui1979/MIXXX-FLX10/blob/main/HID/flx10_relay_daemon.py |
| **LOU-INIT** | Loui1979 `HID/rb_init_sequence.json`: 324 frames rekordbox sent at connect (323 EP3 USB-MIDI, then 1 EP5), last changed in commit c3d2f313 (2026-09-17), sha256 `bb5371a0…62ef4f7` (read 2026-10-08); committed unchanged as `crates/dj-controller-core/fixtures/ddj-flx10-rekordbox-connect.json` | https://github.com/Loui1979/MIXXX-FLX10/blob/main/HID/rb_init_sequence.json |
| **NT-1000** | ntamas94, DDJ-1000 bridge (GPL-3.0), commit db9b669 (2026-08-23): `ddj1000-linux/bridge/djbox-ddj-bridge.py` and `ddj1000-post-auth-midi.txt`, the MIDI rekordbox sent a DDJ-1000 after its login | https://github.com/ntamas94/pioneered-by-ntamas |
| **JAN-1000** | jan0803, DDJ-1000 Linux driver (GPL-2.0), commit b7f689b: `scripts/runtime/ddj1000-unlock-service.py` | https://github.com/jan0803/ddj1000-linux-driver |
| **RU-1000** | RudolfsUiska, DDJ-1000 jog-screen protocol from rekordbox captures (GPL-2.0), commit da43b84: `docs/PROTOCOL.md` | https://github.com/RudolfsUiska/ddj1000-linux-mixxx |
| **MIDI10-USB** | USB-IF, Universal Serial Bus Device Class Definition for MIDI Devices 1.0 (1999), §4 "USB-MIDI Event Packets" | https://www.usb.org/sites/default/files/midi10.pdf |
| **HIDRAW** | Linux kernel, `Documentation/hid/hidraw.rst`: write() starts with the report id, 0 for a device without numbered reports; read() returns one report | https://www.kernel.org/doc/html/latest/hid/hidraw.html |
| **WEBUSB** | WebUSB spec source (WICG; the rendered page now redirects to usb.spec.whatwg.org) | https://github.com/WICG/webusb/blob/main/index.bs |
| **BCD** | MDN browser-compat-data | https://github.com/mdn/browser-compat-data (files `api/HID.json`, `api/USB.json`, `api/AudioContext.json`, `api/Navigator.json`) |

## Prior art

- Upstream Mixxx ships **no FLX10 mapping**. `res/controllers` has the DDJ-FLX4, DDJ-400,
  SB/SB2/SB3, SX, DDJ-200 and CDJ files (https://github.com/mixxxdj/mixxx/tree/main/res/controllers).
  Open PRs: #15789 "Pioneer ddj flx10 mapping" by marco-zis, 2025-12-24
  (https://github.com/mixxxdj/mixxx/pull/15789); #16539 by Veezuhz, 2026-06-02, with HID
  screen files (https://github.com/mixxxdj/mixxx/pull/16539).
- marco-zis/Mixxx-mapping-for-DDJ-FLX10 (GPL-3.0), adapted from the DDJ-1000 mapping:
  https://github.com/marco-zis/Mixxx-mapping-for-DDJ-FLX10
- Veezuhz/Mixxx_FLX10_Controller_Mapping (**no license declared**), a fork of the above plus
  the HID screen research: https://github.com/Veezuhz/Mixxx_FLX10_Controller_Mapping
- Loui1979/MIXXX-FLX10 (Unlicense, but vendors Veezuhz files): a MIDI mapping, a libusb relay
  daemon, rekordbox captures and decoders: https://github.com/Loui1979/MIXXX-FLX10
- Mixxx forum threads, not read (403 to scripted fetch):
  https://mixxx.discourse.group/t/pioneer-ddj-flx-10/28683,
  https://mixxx.discourse.group/t/ddj-flx10-hid-mapping-static-wave-forms-show/33783
- Mixar has an open request for FLX10 jog-display support; it notes the Veezuhz implementation "has no
  declared license and is reference material only" (https://github.com/geovannimp/mixar/issues/291).
- Unofficial djay mapping: https://community.algoriddim.com/t/ddj-flx10-unofficial-mapping/23148.
- Empty repo (2026-10-08) aiming to run the FLX10 standalone on a Raspberry Pi with the
  XDJ-RX3 firmware: https://github.com/alex-j-butler/rb-flx10-standalone

## Licensing

Veezuhz's repo has no license, so nothing is copied from it; Loui1979's is Unlicense but
vendors Veezuhz files; marco-zis is GPL-3.0. The driver is written clean-room from our own
captures and the cited protocol descriptions. The only bytes taken verbatim are capture data
from LOU-INIT (Loui1979's own capture, Unlicense): the handshake SysEx and the EP5 init report
in `crates/dj-controller-model/models/ddj-flx10.json`, and the whole capture as a fixture. The DDJ-1000 sources
(GPL) are read for facts only. The HID report layouts in `crates/dj-controller-core/src/hid.rs` restate
facts (byte offsets and constants) from LOU-JOG, LOU-RELAY and VZ-F in new code.
