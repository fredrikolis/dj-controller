<!-- Concern: the rules that read a model file's paths and layers as the object tree, events and bank views a page uses | Non-concern: the file's own fields (model-format.md) | IO: none -->
# The surface

The driver hands a page each model as one object tree (`crates/dj-controller-model/src/surface.rs`),
read from the file by rules, so its TypeScript types and objects need no code per model:

- A path segment of letters and a number from 1 (`deck2`, `pad8`, `channel3`) is a member of a
  0-based tuple named with an `s` (`decks[1]`, `pads[7]`, `channels[2]`); any other segment is a
  camelCase name (`play-pause` as `playPause`). Every event carries those indices as fields
  (`deck`, `pad`). A tuple's members are numbered from 1 with none missing.
- A layer is read word by word: `shift`; `page-N`; a pad mode, any word a `page-N` layer holds;
  a tuple member (`deck1` on a shared browse press, as `deck: 0`); every other word stays the
  event's `layer` (`long-press`, `vinyl-on`).
- The nearest tuple member above a control (a deck, a mixer channel), or the root, owns pad modes
  and shift: a button at `<owner>.shift` is its shift; a row with `selects` makes its owner show
  that bank when pressed. A press of any other row naming a pad mode tells that mode (a pad tells
  its page too); a press of a selecting button's row without `selects` leaves mode and page unknown.
- A control is one object over all its rows. A fader, switch or relative control reads its own
  layers alone, its shift layer only through the `shifted` view (the shift layer where it has no
  other), so its value, changes and position never mix in what moved with shift held; a button's
  or pad's presses come from every row, each carrying its layer. Each layer of shift, mode and page alone is also a
  bank view of its own under the owner: `modes.<mode>.pages[n].shifted.<path>`, any part absent
  that the layer lacks. A write to the object goes to its unshifted layer of the pad mode and
  page the device shows now, whatever shift it reports (a shift layer only where the object has
  no other); a write to a bank view, `shifted` among them, goes to that bank. A lease on the
  object moves to each bank the device shows, the bank it leaves shown what it would without it;
  a lease on a bank view stays on that bank. Until the device tells an owner's mode, it shows the file's
  `start-bank`.
- `modes`, `shifted`, `mode`, `modeChanges`, `model`, `palette`, `closed` and `close` name nothing else.

The core's build writes each model's typed module from these rules (`dj_controller_core::models`,
by `dj-controller-model`'s `generate`): an index type per tuple (`DeckIndex`), `Mode`, an identity
per control (`DeckPadId`), the tree of typed controls over a session, and `Input`, every input as a
typed value. Control paths stay in the model file and at the edges, as logs and the inspector.
The npm package projects the same tree into JS (`dj-controller`'s build, from the same generator):
each Rust type becomes the TypeScript type of its name, `DdjFlx10Deck` for `ddj_flx10::Deck`.
