use std::env;
use std::path::PathBuf;
use std::process::{Command, ExitCode};

fn default_node_script_from_exe(exe_name: &str) -> Option<PathBuf> {
    let lower = exe_name.to_ascii_lowercase();
    if lower.contains("gemini") {
        return Some(PathBuf::from(
            r"C:\Users\hithe\AppData\Roaming\npm\node_modules\@google\gemini-cli\dist\index.js",
        ));
    }
    if lower.contains("codex") {
        return Some(PathBuf::from(
            r"C:\Users\hithe\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js",
        ));
    }
    None
}

fn main() -> ExitCode {
    let mut args = env::args();
    let exe_name = args.next().unwrap_or_default();
    let rest: Vec<String> = args.collect();

    let script = match env::var("FORGE_AGENT_SCRIPT") {
        Ok(v) if !v.trim().is_empty() => PathBuf::from(v),
        _ => match default_node_script_from_exe(&exe_name) {
            Some(p) => p,
            None => {
                eprintln!(
                    "FORGE_AGENT_SCRIPT is not set and script cannot be inferred from shim name: {}",
                    exe_name
                );
                return ExitCode::from(2);
            }
        },
    };

    let status = Command::new("node").arg(script).args(rest).status();
    match status {
        Ok(s) => ExitCode::from(s.code().unwrap_or(1) as u8),
        Err(err) => {
            eprintln!("failed to launch target process: {err}");
            ExitCode::from(1)
        }
    }
}
