<!-- Concern: the FLX10's USB audio channels and how a page could route master and cue to them | Non-concern: MIDI and HID | IO: none -->
# DDJ-FLX10: USB audio and cue routing

Source short names are in [flx10-sources.md](flx10-sources.md).

## The device

- **44.1 kHz, 24-bit** converters (MAN "Specifications – Audio Section"). Captured traffic
  sets 44100 Hz (`44ac0000`) [LOU-RB3].
- **Routing** (MAN "Signal flow", p.174), per computer port (USB A / USB B, two USB-C ports):
  `USB Audio Out 1` = **PC MASTER**, `Out 2` = **PC HEADPHONE** (2 stereo pairs = **4 output
  channels**); `USB Audio In 1` = **REC OUT**, `In 2..5` = **CH1–CH4 timecode/line** (5 stereo
  pairs = **10 input channels**). Matches VZ-F's 4-out/10-in.
- In PC mode the **software** makes both the master and the cue mix. HEADPHONES MIX, MASTER
  CUE, CH CUE and the channel meters are MIDI the software acts on. Whether the hardware
  also applies HEADPHONES LEVEL in analog is not stated **[unverified]**.
- Linux: no FLX10 quirk in `sound/usb/quirks-table.h`, so generic snd-usb-audio binds; other
  Pioneer IDs (e.g. `2b73:0017`, `000d`) have quirks
  (https://github.com/torvalds/linux/blob/master/sound/usb/quirks-table.h). VZ-F: audio works
  on kernel 6.x, sometimes only after the vendor transfers ([flx10-displays.md](flx10-displays.md)).

## Cue to the headphones from Chrome

`AudioContext.setSinkId()` (Chrome 110+, secure context, output-device permission;
https://developer.chrome.com/blog/audiocontext-setsinkid), then
`ctx.destination.channelCount = 4`, `channelInterpretation = 'discrete'`, master to ch 0/1
and cue to ch 2/3 via a `ChannelMergerNode`. Needs `destination.maxChannelCount >= 4` (MDN:
https://developer.mozilla.org/en-US/docs/Web/API/AudioDestinationNode/maxChannelCount).

| Platform | What Chrome does (Chromium source) | Consequence |
|---|---|---|
| **Windows** | `AudioManagerWin::GetPreferredOutputStreamParameters` queries the **chosen** device's mix format via `CoreAudioUtil::GetPreferredAudioParameters(output_device_id …)` (https://github.com/chromium/chromium/blob/main/media/audio/win/audio_manager_win.cc) | If the FLX10 WDM endpoint is 4-channel, `maxChannelCount` should be 4 after `setSinkId`. Whether Pioneer's driver exposes one 4-ch or two stereo endpoints is unknown **[unverified]** |
| **Linux (Pulse/PipeWire)** | `AudioManagerPulse::GetPreferredOutputStreamParameters` ignores `output_device_id` ("TODO(tommi): Support \|output_device_id\|") and uses the **server's default sample-spec channel count** (`info->sample_spec.channels`, usually 2) (https://github.com/chromium/chromium/blob/main/media/audio/pulse/audio_manager_pulse.cc) | Expect `maxChannelCount = 2` even with the FLX10 selected **[my reading of source; verify]**. Workarounds: (a) split the 4-ch sink in PipeWire into two virtual stereo sinks (ch 1/2 "FLX10 Master", ch 3/4 "FLX10 Phones") and run two AudioContexts, each `setSinkId`'d (two clocks; watch drift); (b) raise the server default to 4 channels **[unverified]** |
| **Android** | `GetAudioOutputDeviceNames` returns only "default" unless `AAudioPerStreamDeviceSelection` is on; `getLayoutWithMaxChannels` returns unsupported (stereo) unless the device is Automotive (https://github.com/chromium/chromium/blob/main/media/audio/android/audio_manager_android.cc, https://github.com/chromium/chromium/blob/main/media/base/android/java/src/org/chromium/media/AudioManagerAndroid.java) | No sink choice, no 4-ch output: **no separate cue on Android**. Fallbacks: master only, or a mono split (L = cue, R = master) **[design idea]** |

BCD lists `AudioContext.setSinkId` as Chrome 110, Android "mirror" (`api/AudioContext.json`),
but the Android source above can only pick "default". `selectAudioOutput()` is not in
Chrome (BCD `api/MediaDevices.json`, crbug 372214870). A page should read
`maxChannelCount` and degrade explicitly.
