// Concern: writes the TypeScript of the core's errors, control types and models, and each model's wasm projection | Non-concern: a model's code (generate) | IO: (models, core) -> TS, projection.rs
use std::{env, fs, path::Path};

use dj_controller_core::error::{CloseReason, Code};
use dj_controller_model::generate::{interfaces, module, pascal, typescript, wasm};
use dj_controller_model::model::models;

/// The core's `CloseReason` and `Error` as TypeScript, each kind with what it means.
fn errors() -> String {
    let union = |names: Vec<&str>| names.iter().map(|n| format!("{n:?}")).collect::<Vec<_>>().join(" | ");
    let meanings =
        |pairs: Vec<(&str, &str)>| pairs.iter().map(|(n, m)| format!(" * - `{n}`: {m}.\n")).collect::<String>();
    let reasons = || CloseReason::ALL.into_iter();
    let codes = || Code::ALL.into_iter();
    format!(
        "/**\n * The core's `CloseReason`:\n{} */\nexport type CloseReason = {};\n\n/**\n * The core's `Error`, by its `code`:\n{} * An abort rejects with the signal's reason, a caller breaking the types with a `TypeError`.\n */\nexport interface ControllerError extends Error {{\n  readonly name: \"ControllerError\";\n  readonly code: {};\n}}\n\n",
        meanings(reasons().map(|r| (r.name(), r.meaning())).collect()),
        union(reasons().map(CloseReason::name).collect()),
        meanings(codes().map(|c| (c.name(), c.meaning())).collect()),
        union(codes().map(Code::name).collect()),
    )
}

fn main() {
    let (mut types, mut projection, mut entries, mut palettes, mut arms) =
        (errors() + &interfaces(), String::new(), String::new(), String::new(), String::new());
    for model in models() {
        types.push_str(&typescript(model));
        projection.push_str(&wasm(model));
        entries.push_str(&format!("  {:?}: {};\n", model.name, pascal(&model.name)));
        let palette = if model.palette.is_some() { "Palette" } else { "undefined" };
        palettes.push_str(&format!("  {:?}: {palette};\n", model.name));
        arms.push_str(&format!("        {:?} => {}(session, lifecycle),\n", model.name, module(model)));
    }
    types.push_str(&format!("\n/** Each known model's controller, by model name. */\nexport type Controllers = {{\n{entries}}};\n\nexport type ModelName = keyof Controllers;\n\n/** Each known model's palette, by model name, as `palette(model)` resolves to it with no connection: undefined where its file states none. */\nexport type Palettes = {{\n{palettes}}};\n"));
    projection.push_str(&format!(
        "/// The session's model as the object `connect` resolves to: its tree, then `lifecycle`.\npub fn controller(session: &djc::session::Session, lifecycle: Vec<(&'static str, JsValue)>) -> JsValue {{\n    match session.model().name.as_str() {{\n{arms}        name => unreachable!(\"no projection for {{name}}\"),\n    }}\n}}\n"
    ));
    let out = Path::new(&env::var("OUT_DIR").unwrap()).to_owned();
    fs::write(out.join("models.d.ts"), types).unwrap();
    fs::write(out.join("projection.rs"), projection).unwrap();
}
