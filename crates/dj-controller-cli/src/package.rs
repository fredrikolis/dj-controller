// Concern: `package`: builds the npm package, the one tree npm publishes | Non-concern: publishing, the package's own files (crates/dj-controller) | IO: ([--dev] OUT) -> OUT/
//! Runs from a checkout: wasm-pack builds the two wasms, tsc emits the twin, the rest is copied.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The tsc the gates type-check with.
const TYPESCRIPT: &str = "typescript@5.9.3";

/// Builds the package into `OUT` as `package` in USAGE.
pub fn run(args: &[String]) -> Result<(), String> {
    let (profile, out) = match args {
        [out] => ("--release", out),
        [dev, out] if dev == "--dev" => ("--dev", out),
        _ => return Err(crate::USAGE.into()),
    };
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let source = root.join("crates/dj-controller");
    let out = std::path::absolute(out).map_err(|e| format!("{out}: {e}"))?;
    if out.exists() {
        fs::remove_dir_all(&out).map_err(|e| format!("{}: {e}", out.display()))?;
    }
    let diagnostics = out.join("diagnostics");
    wasm_pack(&source, profile, &out, &["--", "--no-default-features"])?;
    wasm_pack(&source, profile, &diagnostics, &[])?;
    // wasm-pack's .gitignore would hide the build from npm; its raw wasm exports' types no entry imports.
    for dir in [&out, &diagnostics] {
        for file in [".gitignore", "dj_controller_bg.wasm.d.ts"] {
            remove(&dir.join(file))?;
        }
        drop_init_types(&dir.join("dj_controller.d.ts"))?;
    }
    for dir in ["js", "js/public"] {
        for entry in read_dir(&source.join(dir))? {
            let name = entry.file_name().expect("a directory entry has a name");
            if entry.is_file() && !entry.ends_with("package.json") {
                copy(&entry, &out.join(name))?;
            }
        }
    }
    let twin = source.join("twin");
    let mut tsc = Command::new("npx");
    tsc.args(["--yes", "-p", TYPESCRIPT, "tsc", "-p"]).arg(&twin);
    tsc.args(["--noEmit", "false", "--noCheck", "--outDir"]).arg(out.join("twin"));
    status(&mut tsc)?;
    copy(&root.join("LICENSE"), &out.join("LICENSE"))?;
    let template = source.join("js/package.json");
    let manifest = fs::read_to_string(&template).map_err(|e| format!("{}: {e}", template.display()))?;
    let manifest = manifest.replace("__VERSION__", env!("CARGO_PKG_VERSION"));
    fs::write(out.join("package.json"), manifest).map_err(|e| format!("{}: {e}", out.display()))
}

/// Drops the glue's init types, last in its declarations: each entry loads its wasm itself, and
/// they name `WebAssembly` and `RequestInfo`, which a consumer without the DOM lib lacks.
fn drop_init_types(types: &Path) -> Result<(), String> {
    let text = fs::read_to_string(types).map_err(|e| format!("{}: {e}", types.display()))?;
    let at = text.find("export type InitInput").ok_or_else(|| format!("{}: no init types", types.display()))?;
    fs::write(types, format!("{}\n", text[..at].trim_end())).map_err(|e| format!("{}: {e}", types.display()))
}

fn wasm_pack(source: &Path, profile: &str, out: &Path, cargo: &[&str]) -> Result<(), String> {
    let mut build = Command::new("wasm-pack");
    build.args(["--quiet", "build"]).arg(source).args([profile, "--target", "web", "--no-pack", "--out-dir"]);
    status(build.arg(out).args(cargo))
}

fn status(command: &mut Command) -> Result<(), String> {
    let program = command.get_program().to_string_lossy().into_owned();
    let status = command.status().map_err(|e| format!("{program}: {e}"))?;
    status.success().then_some(()).ok_or_else(|| format!("{program} failed: {status}"))
}

fn read_dir(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    entries.map(|entry| entry.map(|e| e.path()).map_err(|e| format!("{}: {e}", dir.display()))).collect()
}

fn copy(from: &Path, to: &Path) -> Result<(), String> {
    fs::copy(from, to).map(drop).map_err(|e| format!("{}: {e}", from.display()))
}

fn remove(file: &Path) -> Result<(), String> {
    fs::remove_file(file).map_err(|e| format!("{}: {e}", file.display()))
}
