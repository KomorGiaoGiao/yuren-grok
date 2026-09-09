use std::path::PathBuf;

use tauri::{AppHandle, Manager};

pub fn grok_home() -> PathBuf {
    if let Ok(home) = std::env::var("GROK_HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(home);
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .join(".grok")
}

pub fn config_path() -> PathBuf {
    grok_home().join("config.toml")
}

pub fn sessions_dir() -> PathBuf {
    grok_home().join("sessions")
}

pub fn auth_path() -> PathBuf {
    grok_home().join("auth.json")
}

pub fn find_grok_binary(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(resource) = app.path().resource_dir() {
        candidates.push(resource.join("grok"));
        candidates.push(resource.join("binaries").join("grok"));
    }

    let home = grok_home();
    candidates.push(home.join("bin").join("grok"));

    if let Ok(path) = which("grok") {
        candidates.push(path);
    }

    candidates.into_iter().find(|p| p.exists())
}

pub fn workspace_root() -> PathBuf {
    dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("grokDesktop")
        .join("project")
}

pub fn next_default_workspace() -> PathBuf {
    let root = workspace_root();
    for i in 1..10_000 {
        let path = root.join(format!("untitled-{i}"));
        if !path.exists() {
            return path;
        }
    }
    root.join("untitled")
}

pub fn prepare_workspace(preferred: Option<String>) -> Result<String, String> {
    let path = match preferred {
        Some(value) if !value.trim().is_empty() => PathBuf::from(value.trim()),
        _ => next_default_workspace(),
    };
    std::fs::create_dir_all(&path).map_err(|e| format!("Failed to create workspace: {e}"))?;
    Ok(path.display().to_string())
}

fn which(name: &str) -> Result<PathBuf, ()> {
    let path = std::env::var("PATH").map_err(|_| ())?;
    let sep = if cfg!(windows) { ';' } else { ':' };
    for dir in path.split(sep) {
        let candidate = PathBuf::from(dir).join(name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(())
}
