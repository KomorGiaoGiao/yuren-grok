use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use tokio::process::Command;

use crate::paths::find_grok_binary;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub name: String,
    pub enabled: bool,
    pub trusted: bool,
    pub source: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceInfo {
    pub name: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSnapshot {
    pub installed: Vec<PluginInfo>,
    pub available: Vec<PluginInfo>,
    pub marketplaces: Vec<MarketplaceInfo>,
}

pub async fn list_plugins(app: &AppHandle) -> Result<PluginSnapshot, String> {
    let grok = find_grok_binary(app).ok_or_else(|| "Grok CLI not found".to_string())?;

    // Installed plugins only. `--available` pulls the whole marketplace catalog
    // and can freeze the UI; do not fetch it on page open.
    let installed = run_json(&grok, &["plugin", "list", "--json"]).await?;
    let marketplaces = parse_marketplaces(
        run_text(&grok, &["plugin", "marketplace", "list"])
            .await
            .unwrap_or_default(),
    );

    Ok(PluginSnapshot {
        installed: parse_plugins(&installed, true),
        available: Vec::new(),
        marketplaces,
    })
}

pub async fn set_plugin_enabled(app: &AppHandle, name: &str, enabled: bool) -> Result<(), String> {
    let grok = find_grok_binary(app).ok_or_else(|| "Grok CLI not found".to_string())?;
    let cmd = if enabled { "enable" } else { "disable" };
    let text = run_text(&grok, &["plugin", cmd, name]).await?;
    let _ = text;
    Ok(())
}

async fn run_json(bin: &PathBuf, args: &[&str]) -> Result<Value, String> {
    let text = run_text(bin, args).await?;
    if text.trim().is_empty() {
        return Ok(Value::Array(vec![]));
    }
    serde_json::from_str(&text).map_err(|e| format!("Invalid plugin JSON: {e}"))
}

async fn run_text(bin: &PathBuf, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new(bin);
    command
        .args(args)
        .kill_on_drop(true)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let child = command.spawn().map_err(|e| e.to_string())?;
    match tokio::time::timeout(Duration::from_secs(4), child.wait_with_output()).await {
        Ok(Ok(output)) => {
            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if err.is_empty() {
                    return Ok(String::from_utf8_lossy(&output.stdout).to_string());
                }
                return Err(err);
            }
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        }
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("Timed out talking to Grok plugin commands".into()),
    }
}

fn parse_plugins(value: &Value, installed_fallback: bool) -> Vec<PluginInfo> {
    let items = if let Some(arr) = value.as_array() {
        arr.clone()
    } else if let Some(arr) = value.get("plugins").and_then(|v| v.as_array()) {
        arr.clone()
    } else if let Some(arr) = value.get("installed").and_then(|v| v.as_array()) {
        arr.clone()
    } else {
        Vec::new()
    };

    items
        .into_iter()
        .filter_map(|item| {
            let name = item
                .get("name")
                .or_else(|| item.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() {
                return None;
            }
            Some(PluginInfo {
                enabled: item
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(installed_fallback),
                trusted: item
                    .get("trusted")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                source: item
                    .get("source")
                    .or_else(|| item.get("url"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                description: item
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                name,
            })
        })
        .collect()
}

fn parse_marketplaces(text: String) -> Vec<MarketplaceInfo> {
    text.lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with("No ") || line.starts_with("error:") {
                return None;
            }
            if let Some((name, source)) = line.split_once(':') {
                Some(MarketplaceInfo {
                    name: name.trim().to_string(),
                    source: source.trim().to_string(),
                })
            } else {
                Some(MarketplaceInfo {
                    name: line.to_string(),
                    source: String::new(),
                })
            }
        })
        .collect()
}
