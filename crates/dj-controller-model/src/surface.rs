// Concern: a model's controls as one object tree: each control's place, its layers read as shift, mode, page, and the banks writes name | Non-concern: decoding, state | IO: (Model) -> Surface
//! The rules are docs/research/model-surface.md. Every transport and the generated
//! TypeScript read the tree from here, so a model is still added as data alone.

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::model::{Control, Input, Model, OutputKind, models};

/// One step of a place in the tree: a property, camelCase, or a 0-based position in a tuple.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Step {
    Name(String),
    Index(usize),
}

/// A row's layer, read word by word.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Layer {
    pub shift: bool,
    /// Into [`Surface::modes`].
    pub mode: Option<usize>,
    /// 0-based.
    pub page: Option<usize>,
    /// A word naming one of a tuple's members, as `deck1` on a shared browse press: (`deck`, 0).
    pub indices: Vec<(String, usize)>,
    /// Every other word, as written: `long-press`, `vinyl-on`; empty for none.
    pub rest: String,
}

impl Layer {
    /// Whether the layer is a bank a write can name: shift, mode and page only.
    pub fn is_bank(&self) -> bool {
        self.rest.is_empty() && self.indices.is_empty()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Kind {
    Button,
    Pad,
    Switch,
    Absolute,
    Relative,
    /// Output only, as every kind below.
    Led,
    Colour,
    Value,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Button => "button",
            Kind::Pad => "pad",
            Kind::Switch => "switch",
            Kind::Absolute => "absolute",
            Kind::Relative => "relative",
            Kind::Led => "led",
            Kind::Colour => "colour",
            Kind::Value => "value",
        }
    }
}

/// Which identity fields an object's events carry, besides the indices of its place.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Fields {
    pub indices: Vec<(String, usize)>,
    /// Index fields its layers name, each named by every one of its rows.
    pub layer_indices: Vec<String>,
    pub mode: bool,
    pub page: bool,
    pub shift: bool,
    /// The `rest` of each of its layers, `""` among them where a row has none; empty for none.
    pub rest: Vec<String>,
}

/// One physical control: every row whose path is its place.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Object {
    pub place: Vec<Step>,
    pub kind: Kind,
    pub rows: Vec<usize>,
    /// Into [`Surface::owners`].
    pub owner: usize,
    pub fields: Fields,
}

/// The nearest tuple member above a set of controls (a deck, a mixer channel), or the root: what
/// pad modes and shift belong to.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Owner {
    pub place: Vec<Step>,
    /// Into [`Surface::modes`], in the order rows first name them.
    pub modes: Vec<usize>,
    /// How many pages each of `modes` has.
    pub pages: Vec<usize>,
    /// The object of its `shift` button, if it has one.
    pub shift: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    /// `owner` is set where the group is an owner with pad modes.
    Group {
        entries: Vec<(String, Node)>,
        owner: Option<usize>,
    },
    Tuple(Vec<Node>),
    /// `bank` marks a view of one bank: then `rows` is that one row.
    Leaf {
        object: usize,
        rows: Vec<usize>,
        bank: bool,
    },
}

#[derive(Debug)]
pub struct Surface {
    pub model: &'static Model,
    /// camelCase, in the order rows first name them.
    pub modes: Vec<String>,
    /// One per row of the model's `controls`.
    pub layers: Vec<Layer>,
    /// By row: the bank its `selects` names, a pad mode of its owner and maybe a page.
    pub selects: Vec<Option<Layer>>,
    pub row_object: Vec<usize>,
    pub objects: Vec<Object>,
    /// The root's is first.
    pub owners: Vec<Owner>,
    pub root: Node,
    /// The model's `start-bank`: the bank each owner with its mode shows when a session starts.
    pub start: Option<Layer>,
}

/// Names the tree gives its own members: an owner's modes and banks, the controller's lifecycle.
const RESERVED: [&str; 8] = ["mode", "modeChanges", "modes", "shifted", "model", "palette", "closed", "close"];

/// Every model's surface, built once; one that breaks a rule panics, as the tests catch first.
pub fn surface(model: &'static Model) -> &'static Surface {
    static SURFACES: OnceLock<Vec<Surface>> = OnceLock::new();
    let all = SURFACES.get_or_init(|| {
        models().iter().map(|m| Surface::build(m).unwrap_or_else(|e| panic!("{}: {e}", m.name))).collect()
    });
    all.iter().find(|s| std::ptr::eq(s.model, model)).expect("every model has a surface")
}

/// `play-pause` as `playPause`.
pub fn camel(word: &str) -> String {
    let mut parts = word.split('-');
    let first = parts.next().unwrap_or_default().to_owned();
    parts.fold(first, |mut out, part| {
        let mut chars = part.chars();
        out.extend(chars.next().map(|c| c.to_ascii_uppercase()));
        out.push_str(chars.as_str());
        out
    })
}

/// `deck1` as (`deck`, 1): letters then a number from 1.
fn numbered(word: &str) -> Option<(&str, usize)> {
    let digits = word.find(|c: char| c.is_ascii_digit())?;
    let (name, number) = word.split_at(digits);
    let ok = !name.is_empty() && name.chars().all(|c| c.is_ascii_lowercase()) && !number.starts_with('0');
    let number: usize = number.parse().ok().filter(|_| ok)?;
    Some((name, number))
}

/// A control path as steps: `deck1.play-pause` as `decks`, 0, `playPause`.
fn place(path: &str) -> Vec<Step> {
    path.split('.')
        .flat_map(|segment| match numbered(segment) {
            Some((name, n)) => vec![Step::Name(format!("{name}s")), Step::Index(n - 1)],
            None => vec![Step::Name(camel(segment))],
        })
        .collect()
}

/// The place of the owner above `place`: its leaf step dropped, then up to the nearest index.
fn owner_place(place: &[Step]) -> Vec<Step> {
    let mut end = place.len() - 1;
    if matches!(place[end], Step::Index(_)) {
        end -= 1;
    }
    match place[..end].iter().rposition(|s| matches!(s, Step::Index(_))) {
        Some(k) => place[..=k].to_vec(),
        None => Vec::new(),
    }
}

pub fn show_place(place: &[Step]) -> String {
    place
        .iter()
        .map(|s| match s {
            Step::Name(n) => format!(".{n}"),
            Step::Index(i) => format!("[{i}]"),
        })
        .collect::<String>()
        .trim_start_matches('.')
        .to_owned()
}

/// The kind a set of rows makes as one object.
fn kind(rows: &[&Control]) -> Result<Kind, String> {
    let input = rows[0].input;
    if rows.iter().any(|c| c.input != input) {
        return Err("rows of one control send different kinds, or some send nothing".into());
    }
    let output = rows.iter().find_map(|c| c.output);
    if rows.iter().any(|c| c.output.is_some_and(|o| Some(o) != output)) {
        return Err("rows of one control take different outputs".into());
    }
    Ok(match (input, output) {
        (Some(Input::Button), None | Some(OutputKind::Led)) => Kind::Button,
        (Some(Input::Pad), None | Some(OutputKind::Colour)) => Kind::Pad,
        (Some(Input::Switch), None) => Kind::Switch,
        (Some(Input::Absolute), None) => Kind::Absolute,
        (Some(Input::Relative), None) => Kind::Relative,
        (None, Some(OutputKind::Led)) => Kind::Led,
        (None, Some(OutputKind::Colour)) => Kind::Colour,
        (None, Some(OutputKind::Value)) => Kind::Value,
        (input, output) => return Err(format!("no object takes input {input:?} with output {output:?}")),
    })
}

/// The rows a control object reads: a fader's, switch's or relative control's own layers, its
/// shift layer read by the `shifted` view alone (a shift layer only where it has no other), so a
/// value or position never mixes in motion made with shift held; every row of a button or pad,
/// whose each press carries its layer.
fn own_rows(o: &Object, layers: &[Layer]) -> Vec<usize> {
    let unshifted: Vec<usize> = o.rows.iter().copied().filter(|&r| !layers[r].shift).collect();
    match o.kind {
        Kind::Absolute | Kind::Switch | Kind::Relative if !unshifted.is_empty() => unshifted,
        _ => o.rows.clone(),
    }
}

/// The tree while it is built: a tuple's members fill in any order.
enum Draft {
    Group(Vec<(String, Draft)>),
    Tuple(Vec<Option<Draft>>),
    Leaf(Node),
}

fn insert(node: &mut Draft, place: &[Step], leaf: Node, whole: &[Step]) -> Result<(), String> {
    let clash = || format!("{} is a control and holds controls, or is named twice", show_place(whole));
    let Draft::Group(entries) = node else { return Err(clash()) };
    let Some((Step::Name(name), rest)) = place.split_first() else { return Err(clash()) };
    let (index, rest) = match rest.split_first() {
        Some((Step::Index(i), rest)) => (Some(*i), rest),
        _ => (None, rest),
    };
    let at = match entries.iter().position(|(n, _)| n == name) {
        Some(at) => at,
        None => {
            let fresh = if index.is_some() { Draft::Tuple(Vec::new()) } else { Draft::Group(Vec::new()) };
            entries.push((name.clone(), fresh));
            entries.len() - 1
        }
    };
    let mut slot = &mut entries[at].1;
    match (index, slot) {
        (Some(i), Draft::Tuple(items)) => {
            if items.len() <= i {
                items.resize_with(i + 1, || None);
            }
            slot = items[i].get_or_insert_with(|| Draft::Group(Vec::new()));
        }
        (None, s @ (Draft::Group(_) | Draft::Leaf(_))) => slot = s,
        _ => return Err(clash()),
    }
    if !rest.is_empty() {
        return insert(slot, rest, leaf, whole);
    }
    match slot {
        Draft::Group(held) if held.is_empty() => {
            *slot = Draft::Leaf(leaf);
            Ok(())
        }
        _ => Err(clash()),
    }
}

/// The finished tree under `at`, each group that is an owner with pad modes marked.
fn finish(draft: Draft, owners: &HashMap<Vec<Step>, usize>, at: &mut Vec<Step>) -> Result<Node, String> {
    Ok(match draft {
        Draft::Leaf(node) => node,
        Draft::Tuple(items) => {
            let mut nodes = Vec::new();
            for (i, item) in items.into_iter().enumerate() {
                let item = item.ok_or_else(|| format!("{} lacks member {}", show_place(at), i + 1))?;
                at.push(Step::Index(i));
                nodes.push(finish(item, owners, at)?);
                at.pop();
            }
            Node::Tuple(nodes)
        }
        Draft::Group(entries) => {
            let owner = owners.get(at.as_slice()).copied();
            let mut nodes = Vec::new();
            for (name, entry) in entries {
                at.push(Step::Name(name.clone()));
                nodes.push((name, finish(entry, owners, at)?));
                at.pop();
            }
            Node::Group { entries: nodes, owner }
        }
    })
}

impl Surface {
    fn build(model: &'static Model) -> Result<Surface, String> {
        let controls = model.controls();
        let places: Vec<Vec<Step>> = controls.iter().map(|c| place(&c.control)).collect();
        let tuples: Vec<String> = places
            .iter()
            .flat_map(|p| p.windows(2))
            .filter_map(|w| match w {
                [Step::Name(n), Step::Index(_)] => Some(n.clone()),
                _ => None,
            })
            .collect();
        for p in &places {
            if p.iter().any(|s| matches!(s, Step::Name(n) if RESERVED.contains(&n.as_str()))) {
                return Err(format!("{} uses a name the surface reserves ({RESERVED:?})", show_place(p)));
            }
        }

        let paged = controls.iter().map(|c| c.layer.split(' ').collect::<Vec<_>>()).filter(|w| {
            w.iter().any(|w| w.strip_prefix("page-").and_then(|n| n.parse::<usize>().ok()).is_some_and(|n| n >= 1))
        });
        let mut words: Vec<&str> = Vec::new();
        for layer in paged {
            for w in layer {
                if w != "shift" && !w.starts_with("page-") && !words.contains(&w) {
                    words.push(w);
                }
            }
        }
        let modes: Vec<String> = words.iter().map(|w| camel(w)).collect();

        let read = |text: &str| {
            let mut layer = Layer::default();
            let mut rest = Vec::new();
            for w in text.split(' ').filter(|w| !w.is_empty()) {
                let page = w.strip_prefix("page-").and_then(|n| n.parse::<usize>().ok()).filter(|&n| n >= 1);
                let index = numbered(w).filter(|(name, _)| tuples.contains(&format!("{name}s")));
                if w == "shift" {
                    layer.shift = true;
                } else if let Some(page) = page {
                    layer.page = Some(page - 1);
                } else if let Some(m) = words.iter().position(|m| *m == w) {
                    layer.mode = Some(m);
                } else if let Some((name, n)) = index {
                    layer.indices.push((name.to_owned(), n - 1));
                } else {
                    rest.push(w);
                }
            }
            layer.rest = rest.join(" ");
            layer
        };
        let mut layers = Vec::new();
        for c in controls {
            let layer = read(&c.layer);
            if layer.page.is_some() && layer.mode.is_none() {
                return Err(format!("{}: a page with no pad mode", c.name()));
            }
            layers.push(layer);
        }
        let start = model.start_bank.as_ref().map(|b| read(&b.layer));
        if let (Some(start), Some(bank)) = (&start, &model.start_bank) {
            let paged = layers.iter().any(|l| l.mode == start.mode && l.page.is_some());
            if start.mode.is_none() || start.shift || !start.is_bank() || paged != start.page.is_some() {
                return Err(format!("start-bank {:?} is not one pad mode, with a page where it has pages", bank.layer));
            }
        }

        let mut objects: Vec<Object> = Vec::new();
        let mut row_object = vec![0; controls.len()];
        let mut owners: Vec<Owner> = vec![Owner::default()];
        let mut owner_at: HashMap<Vec<Step>, usize> = HashMap::from([(Vec::new(), 0)]);
        for (row, p) in places.iter().enumerate() {
            let object = match objects.iter().position(|o| o.place == *p) {
                Some(o) => o,
                None => {
                    let owned = owner_place(p);
                    let next = owners.len();
                    let owner = *owner_at.entry(owned.clone()).or_insert(next);
                    if owner == next {
                        owners.push(Owner { place: owned, ..Owner::default() });
                    }
                    let indices = p
                        .windows(2)
                        .filter_map(|w| match w {
                            [Step::Name(n), Step::Index(i)] => Some((n.strip_suffix('s').unwrap_or(n).to_owned(), *i)),
                            _ => None,
                        })
                        .collect();
                    let fields = Fields { indices, ..Fields::default() };
                    objects.push(Object { place: p.clone(), kind: Kind::Button, rows: Vec::new(), owner, fields });
                    objects.len() - 1
                }
            };
            objects[object].rows.push(row);
            row_object[row] = object;
        }

        for o in &mut objects {
            let rows: Vec<&Control> = o.rows.iter().map(|&r| &controls[r]).collect();
            let at = |e: String| format!("{}: {e}", rows[0].control);
            o.kind = kind(&rows).map_err(at)?;
            let ls: Vec<&Layer> = o.rows.iter().map(|&r| &layers[r]).collect();
            let names = |l: &Layer| l.indices.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>();
            o.fields.layer_indices = names(ls[0]);
            if ls.iter().any(|l| names(l) != o.fields.layer_indices) {
                return Err(at("not every layer names the same tuples".into()));
            }
            if o.fields.layer_indices.iter().any(|n| o.fields.indices.iter().any(|(m, _)| m == n)) {
                return Err(at("a layer names a tuple its path already does".into()));
            }
            o.fields.mode = ls[0].mode.is_some();
            o.fields.page = ls[0].page.is_some();
            if ls.iter().any(|l| l.mode.is_some() != o.fields.mode || l.page.is_some() != o.fields.page) {
                return Err(at("some layers name a pad mode or page and some do not".into()));
            }
            o.fields.shift = ls.iter().any(|l| l.shift);
            if ls.iter().any(|l| !l.rest.is_empty()) {
                for l in &ls {
                    if !o.fields.rest.contains(&l.rest) {
                        o.fields.rest.push(l.rest.clone());
                    }
                }
            }
            let owner = &mut owners[o.owner];
            for l in ls {
                let Some(m) = l.mode else { continue };
                let at = match owner.modes.iter().position(|&x| x == m) {
                    Some(at) => at,
                    None => {
                        owner.modes.push(m);
                        owner.pages.push(0);
                        owner.modes.len() - 1
                    }
                };
                owner.pages[at] = owner.pages[at].max(l.page.map_or(0, |p| p + 1));
            }
        }
        for (i, o) in objects.iter().enumerate() {
            let Some((Step::Name(last), parent)) = o.place.split_last() else { continue };
            let owner = &mut owners[o.owner];
            if o.kind == Kind::Button && last == "shift" && parent == owner.place.as_slice() {
                owner.shift = Some(i);
            }
        }
        let mut selects = Vec::new();
        for (row, c) in controls.iter().enumerate() {
            let Some(s) = &c.selects else {
                selects.push(None);
                continue;
            };
            let bank = read(&s.bank);
            let owner = &owners[objects[row_object[row]].owner];
            let at = bank.mode.and_then(|m| owner.modes.iter().position(|&x| x == m));
            let fits = at.is_some_and(|at| bank.page.is_none_or(|p| p < owner.pages[at]));
            if !fits || bank.shift || !bank.is_bank() {
                return Err(format!("{}: selects {:?}, no pad mode and page of its owner", c.name(), s.bank));
            }
            selects.push(Some(bank));
        }

        let mut draft = Draft::Group(Vec::new());
        for (i, o) in objects.iter().enumerate() {
            let rows = own_rows(o, &layers);
            insert(&mut draft, &o.place, Node::Leaf { object: i, rows, bank: false }, &o.place)?;
        }
        for (row, layer) in layers.iter().enumerate() {
            if !layer.is_bank() || (layer.mode.is_none() && !layer.shift) {
                continue;
            }
            let object = &objects[row_object[row]];
            let owner = &owners[object.owner];
            let mut bank = owner.place.clone();
            if let Some(m) = layer.mode {
                bank.extend([Step::Name("modes".into()), Step::Name(modes[m].clone())]);
            }
            if let Some(p) = layer.page {
                bank.extend([Step::Name("pages".into()), Step::Index(p)]);
            }
            if layer.shift {
                bank.push(Step::Name("shifted".into()));
            }
            bank.extend_from_slice(&object.place[owner.place.len()..]);
            insert(&mut draft, &bank, Node::Leaf { object: row_object[row], rows: vec![row], bank: true }, &bank)?;
        }
        let moded: HashMap<Vec<Step>, usize> =
            owners.iter().enumerate().filter(|(_, o)| !o.modes.is_empty()).map(|(i, o)| (o.place.clone(), i)).collect();
        let root = finish(draft, &moded, &mut Vec::new())?;
        Ok(Surface { model, modes, layers, selects, row_object, objects, owners, root, start })
    }

    /// Whether a leaf of `rows` takes writes: a bank's one row with an output, or any row with an
    /// output whose layer is a bank.
    pub fn writable(&self, rows: &[usize], bank: bool) -> bool {
        rows.iter().any(|&r| self.model.controls()[r].output.is_some() && (bank || self.layers[r].is_bank()))
    }

    /// The object `row` belongs to.
    pub fn object_of(&self, row: usize) -> &Object {
        &self.objects[self.row_object[row]]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flx10() -> &'static Surface {
        surface(Model::named("DDJ-FLX10").unwrap())
    }

    fn at<'a>(node: &'a Node, path: &[&str]) -> &'a Node {
        path.iter().fold(node, |node, step| match (node, step.parse::<usize>()) {
            (Node::Tuple(items), Ok(i)) => &items[i],
            (Node::Group { entries, .. }, _) => {
                &entries.iter().find(|(n, _)| n == step).unwrap_or_else(|| panic!("no {step} in {path:?}")).1
            }
            _ => panic!("{step} of {path:?}"),
        })
    }

    fn rows(node: &Node) -> Vec<String> {
        let Node::Leaf { rows, .. } = node else { panic!("{node:?} is no leaf") };
        rows.iter().map(|&r| flx10().model.controls()[r].name()).collect()
    }

    #[test]
    fn every_model_has_a_surface() {
        for model in models() {
            surface(model);
        }
    }

    #[test]
    fn numbered_segments_are_tuples_and_layers_are_banks_under_their_deck() {
        let root = &flx10().root;
        assert_eq!(rows(at(root, &["decks", "0", "playPause"])), ["deck1.play-pause", "deck1.play-pause (shift)"]);
        assert_eq!(rows(at(root, &["decks", "1", "pads", "4"])).len(), 32);
        assert_eq!(
            rows(at(root, &["decks", "1", "modes", "keyboard", "pages", "1", "shifted", "pads", "7"])),
            ["deck2.pad8 (shift keyboard page-2)"]
        );
        assert_eq!(rows(at(root, &["decks", "0", "modes", "hotCue", "page", "left"])), ["deck1.page.left (hot-cue)"]);
        assert_eq!(rows(at(root, &["decks", "0", "shifted", "playPause"])), ["deck1.play-pause (shift)"]);
        assert_eq!(rows(at(root, &["mixer", "channels", "2", "fader"])), ["mixer.channel3.fader"]);
        assert_eq!(rows(at(root, &["decks", "3", "4BeatExit"])), ["deck4.4-beat-exit", "deck4.4-beat-exit (shift)"]);
    }

    #[test]
    fn a_deck_owns_its_pad_modes_shift_button_and_mode_buttons() {
        let s = flx10();
        let Node::Group { owner: Some(deck), .. } = at(&s.root, &["decks", "2"]) else {
            panic!("deck 3 owns no modes")
        };
        let owner = &s.owners[*deck];
        let names: Vec<&str> = owner.modes.iter().map(|&m| s.modes[m].as_str()).collect();
        assert_eq!(names.len(), 8);
        assert!(names.contains(&"hotCue") && names.contains(&"padFx1"));
        assert!(owner.pages.iter().all(|&p| p == 2));
        assert_eq!(s.objects[owner.shift.unwrap()].place, place("deck3.shift"));
        let selected: Vec<String> = (0..s.layers.len())
            .filter(|&r| s.objects[s.row_object[r]].owner == *deck)
            .filter_map(|r| Some(s.modes[s.selects[r].as_ref()?.mode?].clone()))
            .collect();
        assert_eq!(selected.len(), 8 + 32, "4 mode buttons plain and shifted, 8 modes' PAGE ◀ and ▶ plain and shifted");
        for mode in ["hotCue", "keyboard", "padFx1", "padFx2", "beatJump", "beatLoop", "sampler", "keyShift"] {
            assert!(selected.iter().any(|m| m == mode), "{mode}");
        }
    }

    #[test]
    fn a_shared_press_names_its_deck_and_extra_words_stay_its_layer() {
        let s = flx10();
        let press = s.objects.iter().find(|o| o.place == place("browser.press")).unwrap();
        assert_eq!((press.fields.layer_indices.clone(), press.fields.shift), (vec!["deck".to_owned()], true));
        let platter = s.objects.iter().find(|o| o.place == place("deck1.jog.platter")).unwrap();
        assert_eq!(platter.fields.rest, ["vinyl-on", "vinyl-off", "4-beat-jump", ""]);
        assert_eq!(platter.fields.indices, [("deck".to_owned(), 0)]);
    }

    fn file(controls: &str) -> String {
        format!(
            r#"{{"model": "T", "usb": {{"vendor": "0000", "product": "0001", "source": "test"}}, "hardware": "none", "sources": {{}}, "controls": [{controls}]}}"#
        )
    }

    fn build(controls: &str) -> Result<Surface, String> {
        let model: &'static Model = Box::leak(Box::new(Model::parse(&file(controls)).unwrap()));
        Surface::build(model)
    }

    #[test]
    fn a_surface_refuses_what_it_cannot_name() {
        let bad = [
            r#"{"control": "a", "in": "button", "midi": "90 00", "source": ""}, {"control": "a.b", "in": "button", "midi": "90 01", "source": ""}"#,
            r#"{"control": "deck2.a", "in": "button", "midi": "90 00", "source": ""}"#,
            r#"{"control": "a", "in": "button", "midi": "90 00", "source": ""}, {"control": "a", "layer": "x", "in": "pad", "midi": "90 01", "source": ""}"#,
            r#"{"control": "deck1.modes", "in": "button", "midi": "90 00", "source": ""}"#,
            r#"{"control": "a", "in": "absolute", "out": "value", "range": [0, 1], "midi": "B0 00", "source": ""}"#,
            r#"{"control": "p", "layer": "m page-1", "in": "pad", "midi": "90 00", "source": ""}, {"control": "p", "in": "pad", "midi": "90 01", "source": ""}"#,
        ];
        for controls in bad {
            assert!(build(controls).is_err(), "{controls}");
        }
    }

    #[test]
    fn a_start_bank_names_one_pad_mode_and_its_page() {
        let pads = r#"{"control": "deck1.pad1", "layer": "m page-1", "in": "pad", "midi": "90 00", "source": ""}"#;
        let with = |layer: &str| {
            let bank = format!(r#""start-bank": {{"layer": "{layer}", "source": "test"}}, "controls""#);
            let model: &'static Model =
                Box::leak(Box::new(Model::parse(&file(pads).replacen(r#""controls""#, &bank, 1)).unwrap()));
            Surface::build(model)
        };
        assert_eq!(with("m page-1").unwrap().start.and_then(|l| l.page), Some(0));
        for bad in ["m", "page-1", "shift m page-1", "n page-1", "m page-1 x"] {
            assert!(with(bad).is_err(), "{bad}");
        }
    }
}
