//! ekorn launcher.
//!
//! Runs the ekorn core binary when it is installed. Without the core,
//! `ekorn hook ...` is a silent no-op (so agent hooks keep working unchanged)
//! and other commands explain where to get the core.

use std::env;
use std::path::PathBuf;
use std::process::{self, Command};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const RELEASES: &str = "https://github.com/ekornhq/ekorn/releases";

fn core_path() -> PathBuf {
    if let Some(p) = env::var_os("EKORN_CORE") {
        return PathBuf::from(p);
    }
    let home = env::var_os("EKORN_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HOME")
                .or_else(|| env::var_os("USERPROFILE"))
                .map(|h| PathBuf::from(h).join(".ekorn"))
        })
        .unwrap_or_else(|| PathBuf::from(".ekorn"));
    let exe = if cfg!(windows) { "ekorn-core.exe" } else { "ekorn-core" };
    home.join("bin").join(exe)
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let core = core_path();
    let have_core = core.is_file();

    // --version prints both halves so a bug report can say which core and which shim are in play.
    if matches!(args.first().map(String::as_str), Some("--version") | Some("-V") | Some("version")) {
        if have_core {
            let _ = Command::new(&core).arg("--version").status();
        } else {
            println!("ekorn-core: not installed (expected at {})", core.display());
        }
        println!("ekorn shim {} (crates.io)", VERSION);
        process::exit(0);
    }

    if have_core {
        match Command::new(&core).args(&args).status() {
            Ok(status) => process::exit(status.code().unwrap_or(1)),
            Err(e) => {
                eprintln!("ekorn: failed to run {}: {}", core.display(), e);
                process::exit(1);
            }
        }
    }

    if args.first().map(String::as_str) == Some("hook") {
        process::exit(0);
    }

    eprintln!(
        "ekorn: core binary not found at {}\nDownload ekorn-core for your platform from {}, verify it against sha256sums.txt,\nmake it executable and place it there, or point EKORN_CORE at it.",
        core.display(),
        RELEASES
    );
    process::exit(2);
}
