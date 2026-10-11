// Concern: embeds every model file under models/ into the crate, so a model is added as data alone | Non-concern: reading or checking a model (src/model.rs) | IO: (models/*) -> $OUT_DIR/{models,mml}.rs
use std::{env, fs, path::Path};

fn main() {
    let dir = Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap()).join("models");
    println!("cargo::rerun-if-changed={}", dir.display());
    let mut files: Vec<String> =
        fs::read_dir(&dir).unwrap().map(|entry| entry.unwrap().path().display().to_string()).collect();
    files.sort();
    let out = Path::new(&env::var("OUT_DIR").unwrap()).to_owned();
    let list = |suffix: &str, pair: fn(&str) -> String| -> String {
        let items: String =
            files.iter().filter(|f| f.ends_with(suffix)).map(|f| format!("    {},\n", pair(f))).collect();
        format!("&[\n{items}]")
    };
    fs::write(out.join("models.rs"), list(".json", |f| format!("include_str!({f:?})"))).unwrap();
    let mml = |f: &str| {
        let model = f.strip_suffix(".mml").unwrap().to_owned() + ".json";
        format!("(include_str!({model:?}), include_str!({f:?}))")
    };
    fs::write(out.join("mml.rs"), list(".mml", mml)).unwrap();
}
