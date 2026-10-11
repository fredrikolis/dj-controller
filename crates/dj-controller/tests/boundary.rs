// Concern: runs the package's Node boundary tests under cargo test: the package built, packed, installed, then node --test | Non-concern: the scenarios (*.test.mjs) | IO: (package) -> pass, or a report
use std::fs;
use std::path::Path;
use std::process::Command;

#[test]
fn the_package_keeps_its_contract_against_a_stand_in_web_midi() {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = crate_dir.join("../..").canonicalize().unwrap();
    let target = root.join("target/boundary");
    let pkg = target.join("pkg");
    let built = Command::new(env!("CARGO"))
        .args(["run", "--quiet", "-p", "dj-controller-cli", "--", "package", "--dev"])
        .arg(&pkg)
        .current_dir(&root)
        .env("CARGO_TARGET_DIR", &target)
        .status()
        .expect("cargo runs");
    assert!(built.success(), "dj-controller-cli package failed");
    // Installed from its tarball, as a consumer gets it, so a file the tarball lacks fails here.
    let packed = Command::new("npm")
        .args(["pack", "--quiet", "--pack-destination"])
        .arg(&target)
        .arg(&pkg)
        .output()
        .expect("npm runs");
    assert!(packed.status.success(), "{}", String::from_utf8_lossy(&packed.stderr));
    let tarball = target.join(String::from_utf8(packed.stdout).unwrap().trim());
    let consumer = target.join("consumer");
    if consumer.exists() {
        fs::remove_dir_all(&consumer).unwrap();
    }
    fs::create_dir_all(&consumer).unwrap();
    fs::write(consumer.join("package.json"), r#"{ "private": true }"#).unwrap();
    let installed = Command::new("npm")
        .args(["install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", "--offline"])
        .arg(&tarball)
        .current_dir(&consumer)
        .output()
        .expect("npm runs");
    assert!(installed.status.success(), "{}", String::from_utf8_lossy(&installed.stderr));
    let report = Command::new("node")
        .args(["--test", "--test-reporter=spec"])
        .args(["connect", "load", "twin", "package"].map(|t| crate_dir.join(format!("tests/{t}.test.mjs"))))
        .env("DJ_CONTROLLER_PKG", consumer.join("node_modules/dj-controller"))
        .env("DJ_CONTROLLER_BUILD", &pkg)
        .output()
        .expect("node runs");
    let text = String::from_utf8_lossy(&report.stdout).into_owned() + &String::from_utf8_lossy(&report.stderr);
    assert!(report.status.success(), "{text}");
}
