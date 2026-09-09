use serde::{Deserialize, Serialize};
use toml_edit::{value, DocumentMut, Item, Table};

use crate::paths::{auth_path, config_path, grok_home};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub grok_home: String,
    pub base_url: String,
    pub model: String,
    pub reasoning_effort: String,
    pub api_key_configured: bool,
    pub api_key_preview: String,
    pub browser_auth: bool,
    pub last_project_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub api_key: Option<String>,
    pub last_project_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalog {
    pub models: Vec<String>,
    pub default_model: String,
    pub reasoning_effort: String,
    pub efforts: Vec<String>,
}

pub fn effort_levels() -> Vec<String> {
    ["none", "minimal", "low", "medium", "high", "xhigh", "max"]
        .into_iter()
        .map(str::to_string)
        .collect()
}

pub fn load_settings() -> Result<AppSettings, String> {
    let raw = std::fs::read_to_string(config_path()).unwrap_or_default();
    let doc = raw
        .parse::<DocumentMut>()
        .map_err(|e| format!("Failed to parse config.toml: {e}"))?;

    let model = string_at(&doc, &["models", "default"]).unwrap_or_else(|| "grok-4.6".into());
    let reasoning_effort = string_at(&doc, &["models", "default_reasoning_effort"])
        .or_else(|| string_at(&doc, &["model", &model, "reasoning_effort"]))
        .unwrap_or_else(|| "high".into());
    let base_url = string_at(&doc, &["model", &model, "base_url"])
        .or_else(|| string_at(&doc, &["endpoints", "models_base_url"]))
        .unwrap_or_default();
    let api_key = string_at(&doc, &["model", &model, "api_key"]).unwrap_or_default();
    let last_project_dir = desktop_state_string("last_project_dir").unwrap_or_default();

    Ok(AppSettings {
        grok_home: grok_home().display().to_string(),
        base_url,
        model,
        reasoning_effort,
        api_key_configured: !api_key.is_empty(),
        api_key_preview: preview_secret(&api_key),
        browser_auth: auth_path().is_file(),
        last_project_dir,
    })
}

pub fn save_settings(patch: SettingsPatch) -> Result<AppSettings, String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    let mut doc = if raw.trim().is_empty() {
        DocumentMut::new()
    } else {
        raw.parse::<DocumentMut>()
            .map_err(|e| format!("Failed to parse config.toml: {e}"))?
    };

    let current = load_settings()?;
    let model = patch.model.clone().unwrap_or(current.model);

    ensure_table(&mut doc, "models");
    doc["models"]["default"] = value(&model);
    if let Some(effort) = patch.reasoning_effort {
        let trimmed = effort.trim();
        if !trimmed.is_empty() {
            doc["models"]["default_reasoning_effort"] = value(trimmed);
        }
    }

    ensure_table(&mut doc, "model");
    if !doc["model"].as_table().unwrap().contains_key(&model) {
        doc["model"][&model] = Item::Table(Table::new());
    }
    if let Some(base_url) = patch.base_url {
        doc["model"][&model]["base_url"] = value(base_url.trim());
        doc["model"][&model]["model"] = value(&model);
    }
    if let Some(api_key) = patch.api_key {
        let trimmed = api_key.trim();
        if !trimmed.is_empty() {
            doc["model"][&model]["api_key"] = value(trimmed);
        }
    }

    std::fs::write(&path, doc.to_string()).map_err(|e| e.to_string())?;

    if let Some(dir) = patch.last_project_dir {
        write_desktop_state("last_project_dir", &dir)?;
    }

    load_settings()
}

pub fn list_models(grok_bin: Option<&std::path::Path>) -> Result<ModelCatalog, String> {
    let settings = load_settings()?;
    let mut models = Vec::new();

    if let Some(bin) = grok_bin {
        if let Ok(output) = std::process::Command::new(bin).arg("models").output() {
            if output.status.success() {
                for line in String::from_utf8_lossy(&output.stdout).lines() {
                    let line = line.trim();
                    let body = line
                        .strip_prefix('*')
                        .or_else(|| line.strip_prefix('-'))
                        .unwrap_or("")
                        .trim();
                    if body.is_empty() {
                        continue;
                    }
                    let id = body
                        .split_whitespace()
                        .next()
                        .unwrap_or("")
                        .trim_matches(|c| c == '(' || c == ')')
                        .to_string();
                    if !id.is_empty() && id != "Available" && id != "Default" && id != "Model" {
                        push_unique(&mut models, id);
                    }
                }
            }
        }
    }

    let raw = std::fs::read_to_string(config_path()).unwrap_or_default();
    if let Ok(doc) = raw.parse::<DocumentMut>() {
        if let Some(table) = doc.get("model").and_then(|item| item.as_table()) {
            for (key, _) in table.iter() {
                push_unique(&mut models, key.to_string());
            }
        }
    }

    if models.is_empty() {
        models.push("grok-4.6".into());
        models.push("grok-4.5".into());
    }
    if !models.iter().any(|m| m == &settings.model) {
        models.insert(0, settings.model.clone());
    }

    Ok(ModelCatalog {
        default_model: settings.model,
        reasoning_effort: settings.reasoning_effort,
        efforts: effort_levels(),
        models,
    })
}

fn push_unique(items: &mut Vec<String>, value: String) {
    if !items.iter().any(|item| item == &value) {
        items.push(value);
    }
}

fn desktop_state_path() -> std::path::PathBuf {
    grok_home().join("desktop-state.toml")
}

fn desktop_state_string(key: &str) -> Option<String> {
    let raw = std::fs::read_to_string(desktop_state_path()).ok()?;
    let doc = raw.parse::<DocumentMut>().ok()?;
    doc.get(key)?.as_str().map(|s| s.to_string())
}

fn write_desktop_state(key: &str, value_str: &str) -> Result<(), String> {
    let path = desktop_state_path();
    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    let mut doc = if raw.trim().is_empty() {
        DocumentMut::new()
    } else {
        raw.parse::<DocumentMut>().map_err(|e| e.to_string())?
    };
    doc[key] = value(value_str);
    std::fs::write(path, doc.to_string()).map_err(|e| e.to_string())
}

fn ensure_table(doc: &mut DocumentMut, key: &str) {
    if !doc.contains_key(key) {
        doc[key] = Item::Table(Table::new());
    }
}

fn string_at(doc: &DocumentMut, path: &[&str]) -> Option<String> {
    let mut item: &Item = doc.as_item();
    for key in path {
        item = item.get(key)?;
    }
    item.as_str().map(|s| s.to_string())
}

fn preview_secret(secret: &str) -> String {
    if secret.is_empty() {
        return String::new();
    }
    let tail: String = secret
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    format!("••••{tail}")
}
