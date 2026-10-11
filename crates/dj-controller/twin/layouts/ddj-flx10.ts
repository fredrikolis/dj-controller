// Concern: the DDJ-FLX10's twin layout: every part on its panel with the typed controls it shows | Non-concern: drawing (draw.ts), following (follow.ts) | IO: (controller) -> Layout
// Positions read off the top panel drawing in AlphaTheta's DDJ-FLX10 Operating Instructions, “Part names and functions”, pp. 10, 11, 14, 50, 54; proportions approximate. Both browse sections are drawn with the one rotate, BACK and VIEW the MIDI list has (MML p.1 B1 to B3); its press names the deck, as `decks` filters it.
import type { Button, DdjFlx10, DdjFlx10ChannelIndex, DdjFlx10DeckIndex } from '../../index.js'
import type { Entry, Id, Layout } from '../types.js'

type Deck = DdjFlx10['decks'][number]

const frames: Entry[] = [
  { shape: 'passive', at: [300, 484], size: [592, 961] },
  { shape: 'passive', at: [880, 484], size: [552, 961] },
  { shape: 'passive', at: [1452, 484], size: [613, 961] },
]

/** A deck's parts, each showing whichever of `decks` is in control; `l` and `r` the decks its in-control lights name, `ln` and `rn` their numbers on the panel. */
function deck(flx: DdjFlx10, decks: readonly DdjFlx10DeckIndex[], l: DdjFlx10DeckIndex, r: DdjFlx10DeckIndex, ln: string, rn: string, select: Button<Id>): Entry[] {
  const each = <C>(pick: (deck: Deck) => C) => decks.map((i) => ({ control: pick(flx.decks[i]), inControl: flx.decks[i].inControl }))
  // One physical control moved with SHIFT held reports on its shifted view (MML p.2 D3, D4).
  const both = <C>(pick: (deck: Deck | Deck['shifted']) => C) => decks.map((i) => ({ control: pick(flx.decks[i]), shifted: pick(flx.decks[i].shifted), inControl: flx.decks[i].inControl }))
  return [
    { shape: 'button', at: [55, 64], size: [46, 16], label: 'DRUMS', controls: each((d) => d.activePart.drums) },
    { shape: 'button', at: [117, 64], size: [46, 16], label: 'VOCAL', controls: each((d) => d.activePart.vocal) },
    { shape: 'button', at: [179, 64], size: [46, 16], label: 'INST', controls: each((d) => d.activePart.inst) },
    { shape: 'round', at: [54, 130], size: 20, label: 'IN', controls: each((d) => d.loopIn) },
    { shape: 'round', at: [117, 130], size: 20, label: 'OUT', controls: each((d) => d.loopOut) },
    { shape: 'round', at: [178, 130], size: 20, label: '4', name: '4 beat exit', controls: each((d) => d['4BeatExit']) },
    { shape: 'round', at: [370, 64], size: 10, label: '◀', name: 'cue loop call left', controls: each((d) => d.cueLoopCall.left) },
    { shape: 'round', at: [422, 64], size: 10, label: '▶', name: 'cue loop call right', controls: each((d) => d.cueLoopCall.right) },
    { shape: 'round', at: [370, 130], size: 10, label: '◀', name: 'mix point left', controls: each((d) => d.mixPointSelect.left) },
    { shape: 'round', at: [422, 130], size: 10, label: '▶', name: 'mix point right', controls: each((d) => d.mixPointSelect.right) },
    { shape: 'round', at: [473, 130], size: 11, label: 'LINK', controls: each((d) => d.mixPointLink) },
    { shape: 'button', at: [62, 196], size: [60, 16], label: 'SLIP REVERSE', controls: each((d) => d.slipReverse) },
    { shape: 'button', at: [527, 196], size: [38, 16], label: 'QUANTIZE', controls: each((d) => d.quantize) },
    { shape: 'button', at: [574, 196], size: [34, 16], label: 'SLIP', controls: each((d) => d.slip) },
    { shape: 'round', at: [55, 271], size: 18, label: `${ln}/${rn}`, name: 'select', controls: [{ control: select }] },
    { shape: 'passive', at: [567, 271], size: 16, label: 'JOG FEEL' },
    { shape: 'spin', at: [312, 437], size: 248, controls: both((d) => d.jog.side) },
    { shape: 'touch', at: [312, 437], size: 226, controls: each((d) => d.jog.touch) },
    { shape: 'spin', at: [312, 437], size: 196, controls: both((d) => d.jog.platter) },
    { shape: 'screen', at: [312, 437], size: 97, controls: each((d) => d.jog.ring) },
    { shape: 'position', at: [265, 381], size: 9, label: ln, controls: [{ control: flx.decks[l].inControl }] },
    { shape: 'position', at: [358, 381], size: 9, label: rn, controls: [{ control: flx.decks[r].inControl }] },
    { shape: 'button', at: [62, 617], size: [32, 14], label: 'SHIFT', controls: each((d) => d.shift) },
    { shape: 'button', at: [66, 683], size: [32, 26], label: '◀', name: '4 beat jump left', controls: each((d) => d['4BeatJump'].left) },
    { shape: 'button', at: [106, 683], size: [32, 26], label: '▶', name: '4 beat jump right', controls: each((d) => d['4BeatJump'].right) },
    { shape: 'round', at: [86, 770], size: 40, label: 'CUE', controls: each((d) => d.cue) },
    { shape: 'round', at: [86, 882], size: 40, label: '▶/❚❚', name: 'play pause', controls: each((d) => d.playPause) },
    { shape: 'button', at: [183, 742], size: [46, 16], label: 'HOT CUE', controls: each((d) => d.padMode.hotCue) },
    { shape: 'button', at: [243, 742], size: [46, 16], label: 'PAD FX1', controls: each((d) => d.padMode.padFx1) },
    { shape: 'button', at: [303, 742], size: [46, 16], label: 'BEAT JUMP', controls: each((d) => d.padMode.beatJump) },
    { shape: 'button', at: [362, 742], size: [46, 16], label: 'SAMPLER', controls: each((d) => d.padMode.sampler) },
    { shape: 'button', at: [411, 742], size: [28, 16], label: '◀', name: 'pad page left', controls: each((d) => d.page.left) },
    { shape: 'button', at: [445, 742], size: [28, 16], label: '▶', name: 'pad page right', controls: each((d) => d.page.right) },
    { shape: 'pad', at: [196, 812], size: [66, 66], controls: each((d) => d.pads[0]) },
    { shape: 'pad', at: [274, 812], size: [66, 66], controls: each((d) => d.pads[1]) },
    { shape: 'pad', at: [352, 812], size: [66, 66], controls: each((d) => d.pads[2]) },
    { shape: 'pad', at: [430, 812], size: [66, 66], controls: each((d) => d.pads[3]) },
    { shape: 'pad', at: [196, 890], size: [66, 66], controls: each((d) => d.pads[4]) },
    { shape: 'pad', at: [274, 890], size: [66, 66], controls: each((d) => d.pads[5]) },
    { shape: 'pad', at: [352, 890], size: [66, 66], controls: each((d) => d.pads[6]) },
    { shape: 'pad', at: [430, 890], size: [66, 66], controls: each((d) => d.pads[7]) },
    { shape: 'button', at: [501, 700], size: [32, 26], label: 'BEAT SYNC', controls: each((d) => d.beatSync) },
    { shape: 'round', at: [501, 776], size: 12, name: 'tempo reset', controls: each((d) => d.tempoReset) },
    { shape: 'button', at: [501, 852], size: [32, 26], label: 'KEY SYNC', controls: each((d) => d.keySync) },
    // The value rises toward the player, down the panel (owner, 2026-10-10, docs/research/flx10-observed-tempo.md).
    { shape: 'fader', at: [557, 770], size: [26, 270], label: 'TEMPO', reversed: true, controls: both((d) => d.tempo) },
  ]
}

/** The browser's parts, its press shown where it names one of `decks`. */
function browse(flx: DdjFlx10, decks: readonly DdjFlx10DeckIndex[]): Entry[] {
  return [
    { shape: 'encoder', at: [550, 62], size: 24, controls: [{ control: flx.browser.rotate, shifted: flx.shifted.browser.rotate }] },
    { shape: 'round', at: [550, 62], size: 15, name: 'press', controls: [{ control: flx.browser.press }], decks },
    { shape: 'button', at: [527, 130], size: [32, 16], label: 'BACK', controls: [{ control: flx.browser.back }] },
    { shape: 'button', at: [574, 130], size: [32, 16], label: 'VIEW', controls: [{ control: flx.browser.view }] },
  ]
}

function channel(flx: DdjFlx10, ch: DdjFlx10ChannelIndex): Entry[] {
  const c = flx.mixer.channels[ch]
  return [
    { shape: 'position', at: [738, 88], size: [11, 14], label: 'A', controls: [{ control: c.inputSelect.pcA }] },
    { shape: 'position', at: [750, 88], size: [11, 14], controls: [{ control: c.inputSelect.linePhono }] },
    { shape: 'position', at: [762, 88], size: [11, 14], label: 'B', controls: [{ control: c.inputSelect.pcB }] },
    { shape: 'knob', at: [750, 140], size: 17, label: 'TRIM', controls: [{ control: c.trim }] },
    { shape: 'meter', at: [716, 252], size: [6, 160], controls: [{ control: c.levelMeter }] },
    { shape: 'knob', at: [750, 212], size: 17, label: 'HI', controls: [{ control: c.eq.hi }] },
    { shape: 'knob', at: [750, 286], size: 17, label: 'MID', controls: [{ control: c.eq.mid }] },
    { shape: 'knob', at: [750, 360], size: 17, label: 'LOW', controls: [{ control: c.eq.low }] },
    { shape: 'knob', at: [750, 456], size: 17, label: 'COLOR', controls: [{ control: c.color }] },
    { shape: 'button', at: [750, 550], size: [34, 16], label: 'CUE', name: 'headphone cue', controls: [{ control: c.cue }] },
    { shape: 'fader', at: [750, 690], size: [24, 116], controls: [{ control: c.fader }] },
    { shape: 'position', at: [742, 759], size: 3, controls: [{ control: c.faderStart.leavesZero, shifted: flx.mixer.channels[ch].shifted.faderStart.leavesZero }] },
    { shape: 'position', at: [758, 759], size: 3, controls: [{ control: c.faderStart.reachesZero }] },
    { shape: 'position', at: [738, 811], size: [11, 16], label: 'A', controls: [{ control: c.crossfaderAssign.a }] },
    { shape: 'position', at: [750, 811], size: [11, 16], controls: [{ control: c.crossfaderAssign.thru }] },
    { shape: 'position', at: [762, 811], size: [11, 16], label: 'B', controls: [{ control: c.crossfaderAssign.b }] },
  ]
}

function mixer(flx: DdjFlx10): Entry[] {
  return [
    { shape: 'position', at: [750, 60], size: 4, label: 'LINE', controls: [{ control: flx.mixer.channels[2].linePhono.line }] },
    { shape: 'position', at: [1014, 60], size: 4, label: 'LINE', controls: [{ control: flx.mixer.channels[3].linePhono.line }] },
    { shape: 'passive', at: [658, 127], size: 14, label: 'MIC 1' },
    { shape: 'passive', at: [658, 180], size: 14, label: 'MIC 2' },
    { shape: 'knob', at: [658, 235], size: 15, label: 'HI', controls: [{ control: flx.mixer.mic.eq.hi }] },
    { shape: 'knob', at: [658, 292], size: 15, label: 'LOW', controls: [{ control: flx.mixer.mic.eq.low }] },
    { shape: 'position', at: [645, 360], size: [12, 14], label: 'OFF', controls: [{ control: flx.mixer.mic.off }] },
    { shape: 'position', at: [658, 360], size: [12, 14], controls: [{ control: flx.mixer.mic.on }] },
    { shape: 'position', at: [671, 360], size: [12, 14], label: 'TALK', controls: [{ control: flx.mixer.mic.talkover }] },
    { shape: 'button', at: [639, 416], size: [28, 16], label: 'SPACE', controls: [{ control: flx.effect.soundColor.space }] },
    { shape: 'button', at: [678, 416], size: [28, 16], label: 'ECHO', controls: [{ control: flx.effect.soundColor.dubEcho }] },
    { shape: 'button', at: [639, 456], size: [28, 16], label: 'CRUSH', controls: [{ control: flx.effect.soundColor.crush }] },
    { shape: 'button', at: [678, 456], size: [28, 16], label: 'PITCH', controls: [{ control: flx.effect.soundColor.pitch }] },
    { shape: 'button', at: [639, 497], size: [28, 16], label: 'NOISE', controls: [{ control: flx.effect.soundColor.noise }] },
    { shape: 'button', at: [678, 497], size: [28, 16], label: 'FILTER', controls: [{ control: flx.effect.soundColor.filter }] },
    { shape: 'button', at: [658, 550], size: [34, 16], label: 'CUE', name: 'sampler cue', controls: [{ control: flx.mixer.samplerCue }] },
    { shape: 'knob', at: [658, 616], size: 17, label: 'SAMPLER VOL', controls: [{ control: flx.mixer.samplerVolume }] },
    { shape: 'knob', at: [658, 730], size: 17, label: 'MIX', controls: [{ control: flx.mixer.headphones.mix }] },
    { shape: 'knob', at: [658, 806], size: 17, label: 'LEVEL', controls: [{ control: flx.mixer.headphones.level }] },
    { shape: 'knob', at: [1106, 68], size: 17, label: 'MASTER', controls: [{ control: flx.mixer.masterLevel }] },
    { shape: 'knob', at: [1106, 128], size: 17, label: 'BOOTH', controls: [{ control: flx.mixer.boothLevel }] },
    { shape: 'button', at: [1106, 364], size: [36, 16], label: 'CUE', name: 'master cue', controls: [{ control: flx.mixer.masterCue }] },
    { shape: 'fader', at: [882, 895], size: [124, 24], controls: [{ control: flx.mixer.crossfader }] },
    { shape: 'round', at: [1106, 425], size: 13, label: 'VOCAL', name: 'FX part vocal', controls: [{ control: flx.effect.fxPart.vocal }] },
    { shape: 'round', at: [1082, 468], size: 13, label: 'DRUMS', name: 'FX part drums', controls: [{ control: flx.effect.fxPart.drums }] },
    { shape: 'round', at: [1130, 468], size: 13, label: 'INST', name: 'FX part inst', controls: [{ control: flx.effect.fxPart.inst }] },
    { shape: 'passive', at: [1106, 567], size: [78, 28], label: 'BEAT FX' },
    { shape: 'button', at: [1089, 617], size: [24, 16], label: '◀', name: 'beat FX left', controls: [{ control: flx.effect.beat.left }] },
    { shape: 'button', at: [1124, 617], size: [24, 16], label: '▶', name: 'beat FX right', controls: [{ control: flx.effect.beat.right }] },
    { shape: 'passive', at: [1106, 672], size: 13 },
    { shape: 'position', at: [1091, 692], size: 3, controls: [{ control: flx.effect.beatFxSelect.lowCutEcho }] },
    { shape: 'position', at: [1085, 685], size: 3, controls: [{ control: flx.effect.beatFxSelect.echo }] },
    { shape: 'position', at: [1081, 676], size: 3, controls: [{ control: flx.effect.beatFxSelect.mtDelay }] },
    { shape: 'position', at: [1082, 666], size: 3, controls: [{ control: flx.effect.beatFxSelect.spiral }] },
    { shape: 'position', at: [1086, 658], size: 3, controls: [{ control: flx.effect.beatFxSelect.reverb }] },
    { shape: 'position', at: [1092, 651], size: 3, controls: [{ control: flx.effect.beatFxSelect.trans }] },
    { shape: 'position', at: [1101, 647], size: 3, controls: [{ control: flx.effect.beatFxSelect.enigmaJet }] },
    { shape: 'position', at: [1111, 647], size: 3, controls: [{ control: flx.effect.beatFxSelect.flanger }] },
    { shape: 'position', at: [1120, 651], size: 3, controls: [{ control: flx.effect.beatFxSelect.phaser }] },
    { shape: 'position', at: [1126, 658], size: 3, controls: [{ control: flx.effect.beatFxSelect.stretch }] },
    { shape: 'position', at: [1130, 666], size: 3, controls: [{ control: flx.effect.beatFxSelect.slipRoll }] },
    { shape: 'position', at: [1131, 676], size: 3, controls: [{ control: flx.effect.beatFxSelect.roll }] },
    { shape: 'position', at: [1127, 685], size: 3, controls: [{ control: flx.effect.beatFxSelect.mobiusSaw }] },
    { shape: 'position', at: [1121, 692], size: 3, controls: [{ control: flx.effect.beatFxSelect.mobiusTri }] },
    { shape: 'passive', at: [1106, 753], size: 13 },
    { shape: 'position', at: [1084, 761], size: 3, controls: [{ control: flx.effect.beatFxChSelect.sampler }] },
    { shape: 'position', at: [1083, 749], size: 3, controls: [{ control: flx.effect.beatFxChSelect.mic }] },
    { shape: 'position', at: [1091, 736], size: 3, controls: [{ control: flx.effect.beatFxChSelect.channels[2] }] },
    { shape: 'position', at: [1100, 731], size: 3, controls: [{ control: flx.effect.beatFxChSelect.channels[0] }] },
    { shape: 'position', at: [1112, 731], size: 3, controls: [{ control: flx.effect.beatFxChSelect.channels[1] }] },
    { shape: 'position', at: [1121, 736], size: 3, controls: [{ control: flx.effect.beatFxChSelect.channels[3] }] },
    { shape: 'position', at: [1129, 749], size: 3, controls: [{ control: flx.effect.beatFxChSelect.master }] },
    { shape: 'knob', at: [1106, 830], size: 17, label: 'LEVEL/DEPTH', controls: [{ control: flx.effect.levelDepth }] },
    { shape: 'round', at: [1106, 905], size: 22, label: 'ON/OFF', controls: [{ control: flx.effect.beatFxOnOff }] },
  ]
}

export function layout(flx: DdjFlx10): Layout {
  return {
    view: [0, 0, 1760, 970],
    narrow: [[0, 0, 600, 970], [600, 0, 560, 970], [1158, 0, 602, 970]],
    sections: [
      { at: [0, 0], parts: frames },
      { at: [0, 0], name: 'deck 1/3', parts: deck(flx, [0, 2], 2, 0, '3', '1', flx.deckSelect.left) },
      { at: [1141, 0], name: 'deck 2/4', parts: deck(flx, [1, 3], 1, 3, '2', '4', flx.deckSelect.right) },
      { at: [0, 0], name: 'browser 1/3', parts: browse(flx, [0, 2]) },
      { at: [1141, 0], name: 'browser 2/4', parts: browse(flx, [1, 3]) },
      { at: [0, 0], name: 'channel 3', parts: channel(flx, 2) },
      { at: [88, 0], name: 'channel 1', parts: channel(flx, 0) },
      { at: [176, 0], name: 'channel 2', parts: channel(flx, 1) },
      { at: [264, 0], name: 'channel 4', parts: channel(flx, 3) },
      { at: [0, 0], parts: mixer(flx) },
    ],
  }
}
