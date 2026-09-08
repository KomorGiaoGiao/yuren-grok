//! Native OS folder picker for choosing a dashboard working directory.
//!
//! Used by the location picker's **Browse…** action. The TUI suspends (leaves raw
//! mode) before calling into this module so the system dialog can take focus.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Result of asking the OS for a folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FolderPickOutcome {
    /// User picked an existing directory.
    Picked(PathBuf),
    /// User cancelled the dialog (or closed it without choosing).
    Cancelled,
    /// The platform has no supported picker, or the helper failed to launch.
    Unavailable(String),
}

/// Open a native "choose folder" dialog.
///
/// `initial` is a hint for the starting folder when the platform supports it.
/// On cancel, returns [`FolderPickOutcome::Cancelled`].
pub fn pick_folder(initial: Option<&Path>) -> FolderPickOutcome {
    #[cfg(target_os = "macos")]
    {
        return pick_folder_macos(initial);
    }
    #[cfg(target_os = "linux")]
    {
        return pick_folder_linux(initial);
    }
    #[cfg(target_os = "windows")]
    {
        return pick_folder_windows(initial);
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = initial;
        FolderPickOutcome::Unavailable("Native folder picker is not supported on this OS".into())
    }
}

#[cfg(target_os = "macos")]
fn pick_folder_macos(initial: Option<&Path>) -> FolderPickOutcome {
    let mut script = String::from(
        "try\n  set chosen to choose folder with prompt \"Choose working directory\"",
    );
    if let Some(dir) = initial.filter(|p| p.is_dir()) {
        let escaped = escape_applescript_string(&dir.to_string_lossy());
        script.push_str(&format!(
            " default location (POSIX file \"{escaped}\")"
        ));
    }
    script.push_str("\n  return POSIX path of chosen\non error\n  return \"\"\nend try\n");

    match Command::new("osascript").arg("-e").arg(&script).output() {
        Ok(output) if output.status.success() => {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if path.is_empty() {
                FolderPickOutcome::Cancelled
            } else {
                // AppleScript POSIX paths often end with `/`
                let cleaned = path.trim_end_matches('/');
                let pb = PathBuf::from(if cleaned.is_empty() { "/" } else { cleaned });
                if pb.is_dir() {
                    FolderPickOutcome::Picked(pb)
                } else {
                    FolderPickOutcome::Unavailable(format!("Not a directory: {path}"))
                }
            }
        }
        Ok(output) => {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if err.is_empty() {
                FolderPickOutcome::Cancelled
            } else {
                FolderPickOutcome::Unavailable(err)
            }
        }
        Err(err) => FolderPickOutcome::Unavailable(format!("failed to run osascript: {err}")),
    }
}

#[cfg(target_os = "macos")]
fn escape_applescript_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(target_os = "linux")]
fn pick_folder_linux(initial: Option<&Path>) -> FolderPickOutcome {
    // Prefer zenity, then kdialog.
    if which("zenity") {
        let mut cmd = Command::new("zenity");
        cmd.args(["--file-selection", "--directory", "--title=Choose working directory"]);
        if let Some(dir) = initial.filter(|p| p.is_dir()) {
            cmd.arg(format!("--filename={}", dir.display()));
        }
        return run_path_stdout(cmd);
    }
    if which("kdialog") {
        let mut cmd = Command::new("kdialog");
        cmd.arg("--getexistingdirectory");
        if let Some(dir) = initial.filter(|p| p.is_dir()) {
            cmd.arg(dir);
        } else {
            cmd.arg(std::env::var_os("HOME").unwrap_or_else(|| "/".into()));
        }
        cmd.arg("--title");
        cmd.arg("Choose working directory");
        return run_path_stdout(cmd);
    }
    FolderPickOutcome::Unavailable(
        "Install zenity or kdialog to browse for a folder".into(),
    )
}

#[cfg(target_os = "windows")]
fn pick_folder_windows(initial: Option<&Path>) -> FolderPickOutcome {
    let initial_ps = initial
        .filter(|p| p.is_dir())
        .map(|p| {
            format!(
                "$b.SelectedPath = '{}'; ",
                p.to_string_lossy().replace('\'', "''")
            )
        })
        .unwrap_or_default();
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; \
         $b = New-Object System.Windows.Forms.FolderBrowserDialog; \
         $b.Description = 'Choose working directory'; \
         $b.ShowNewFolderButton = $true; \
         {initial_ps}\
         if ($b.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ $b.SelectedPath }} else {{ '' }}"
    );
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-Command", &script]);
    run_path_stdout(cmd)
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn run_path_stdout(mut cmd: Command) -> FolderPickOutcome {
    match cmd.output() {
        Ok(output) if output.status.success() => {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if path.is_empty() {
                FolderPickOutcome::Cancelled
            } else {
                let pb = PathBuf::from(&path);
                if pb.is_dir() {
                    FolderPickOutcome::Picked(pb)
                } else {
                    FolderPickOutcome::Unavailable(format!("Not a directory: {path}"))
                }
            }
        }
        Ok(_) => FolderPickOutcome::Cancelled,
        Err(err) => FolderPickOutcome::Unavailable(format!("folder dialog failed: {err}")),
    }
}

#[cfg(target_os = "linux")]
fn which(bin: &str) -> bool {
    Command::new("which")
        .arg(bin)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    #[test]
    fn applescript_escape_quotes_and_backslashes() {
        assert_eq!(
            super::escape_applescript_string(r#"C:\foo"bar"#),
            r#"C:\\foo\"bar"#
        );
    }
}
