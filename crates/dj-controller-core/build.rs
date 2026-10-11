// Concern: writes every model's typed module into the core from its file, so a model stays data alone | Non-concern: what is written (the model crate's generate) | IO: (models) -> $OUT_DIR/models.rs
use std::{env, fs, path::Path};

use dj_controller_model::generate::{module, pascal, rust};
use dj_controller_model::model::models;

fn main() {
    let mut out = String::new();
    let (mut variants, mut arms) = (String::new(), String::new());
    for model in models() {
        let (m, p) = (module(model), pascal(&model.name));
        out.push_str(&format!("/// The {}, typed.\npub mod {m} {{\n{}\n}}\n\n", model.name, rust(model)));
        variants.push_str(&format!("    {p}({m}::Input),\n"));
        arms.push_str(&format!("        {m}::MODEL => Input::{p}({m}::Input::of(row, value)),\n"));
    }
    out.push_str(&format!(
        "/// Any model's input, typed.\n#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]\n#[serde(untagged)]\npub enum Input {{\n{variants}}}\n\n/// The input `value` on `row` of `model`'s controls is.\npub fn input(model: &crate::model::Model, row: usize, value: crate::decode::Value) -> Input {{\n    match model.name.as_str() {{\n{arms}        name => unreachable!(\"no typed module for {{name}}\"),\n    }}\n}}\n"
    ));
    fs::write(Path::new(&env::var("OUT_DIR").unwrap()).join("models.rs"), out).unwrap();
}
