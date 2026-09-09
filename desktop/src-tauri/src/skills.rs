use serde::Serialize;
use toml_edit::{value, Array, DocumentMut, Item, Table};

use crate::paths::{config_path, grok_home};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub path: String,
    pub source: String,
    pub enabled: bool,
}

pub fn list_skills(project_dir: Option<String>) -> Result<Vec<SkillInfo>, String> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        list_skills_inner(project_dir)
    })) {
        Ok(skills) => Ok(skills),
        Err(_) => Err("Failed to list skills".into()),
    }
}

fn list_skills_inner(project_dir: Option<String>) -> Vec<SkillInfo> {
    let disabled = disabled_skill_names();
    let mut skills = Vec::new();
    let mut roots: Vec<(String, std::path::PathBuf)> = vec![
        ("user".into(), grok_home().join("skills")),
        ("user".into(), grok_home().join("commands")),
        (
            "claude".into(),
            dirs::home_dir().unwrap_or_default().join(".claude/skills"),
        ),
        (
            "claude".into(),
            dirs::home_dir()
                .unwrap_or_default()
                .join(".claude/commands"),
        ),
        (
            "cursor".into(),
            dirs::home_dir().unwrap_or_default().join(".cursor/skills"),
        ),
    ];

    if let Some(dir) = project_dir {
        let root = std::path::PathBuf::from(dir);
        roots.push(("project".into(), root.join(".grok/skills")));
        roots.push(("project".into(), root.join(".grok/commands")));
        roots.push(("project".into(), root.join(".claude/skills")));
        roots.push(("project".into(), root.join(".agents/skills")));
    }

    for (source, dir) in roots {
        collect_skills(&dir, &source, &disabled, &mut skills);
    }

    skills.sort_by_cached_key(|skill| skill.name.to_lowercase());
    skills
}

pub fn set_skill_enabled(name: &str, enabled: bool) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    let mut doc = if raw.trim().is_empty() {
        DocumentMut::new()
    } else {
        raw.parse::<DocumentMut>().map_err(|e| e.to_string())?
    };
    if !doc.contains_key("skills") {
        doc["skills"] = Item::Table(Table::new());
    }
    let mut disabled: Vec<String> = doc
        .get("skills")
        .and_then(|skills| skills.get("disabled"))
        .and_then(|item| item.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    disabled.retain(|n| n != name);
    if !enabled {
        disabled.push(name.to_string());
    }
    let mut arr = Array::new();
    for item in disabled {
        arr.push(item);
    }
    doc["skills"]["disabled"] = value(arr);
    std::fs::write(path, doc.to_string()).map_err(|e| e.to_string())
}

fn disabled_skill_names() -> Vec<String> {
    let raw = std::fs::read_to_string(config_path()).unwrap_or_default();
    let Ok(doc) = raw.parse::<DocumentMut>() else {
        return Vec::new();
    };
    doc.get("skills")
        .and_then(|s| s.get("disabled"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn collect_skills(
    dir: &std::path::Path,
    source: &str,
    disabled: &[String],
    out: &mut Vec<SkillInfo>,
) {
    if !dir.exists() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let skill_md = if path.is_dir() {
            path.join("SKILL.md")
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            path.clone()
        } else {
            continue;
        };
        if !skill_md.is_file() {
            continue;
        }
        if let Ok(meta) = std::fs::metadata(&skill_md) {
            if meta.len() > 512_000 {
                continue;
            }
        }
        let raw = std::fs::read_to_string(&skill_md).unwrap_or_default();
        let (name, mut description) = parse_frontmatter(&raw, &skill_md);
        if description.chars().count() > 280 {
            description = description.chars().take(280).collect();
        }
        if out.iter().any(|s| s.name == name) {
            continue;
        }
        out.push(SkillInfo {
            enabled: !disabled.iter().any(|d| d == &name),
            name,
            description,
            path: skill_md.display().to_string(),
            source: source.to_string(),
        });
    }
}

fn fallback_skill_name(path: &std::path::Path) -> String {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if file_name.eq_ignore_ascii_case("SKILL.md") {
        path.parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            .unwrap_or("skill")
            .to_string()
    } else {
        path.file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("skill")
            .to_string()
    }
}

fn parse_frontmatter(raw: &str, path: &std::path::Path) -> (String, String) {
    let fallback_name = fallback_skill_name(path);
    if !raw.starts_with("---") {
        return (fallback_name, first_paragraph(raw));
    }
    let Some(rest) = raw.get(3..) else {
        return (fallback_name, first_paragraph(raw));
    };
    let Some(end) = rest.find("\n---") else {
        return (fallback_name, first_paragraph(raw));
    };
    let Some(yaml) = rest.get(..end) else {
        return (fallback_name, first_paragraph(raw));
    };
    let mut name = fallback_name;
    let mut description = String::new();
    let mut in_desc = false;
    let mut desc_lines = Vec::new();
    for line in yaml.lines() {
        if let Some(value) = line.strip_prefix("name:") {
            name = value.trim().trim_matches('"').to_string();
            in_desc = false;
        } else if let Some(value) = line.strip_prefix("description:") {
            let v = value.trim();
            if v == ">" || v == "|" || v.is_empty() {
                in_desc = true;
            } else {
                description = v.trim_matches('"').to_string();
                in_desc = false;
            }
        } else if in_desc {
            if line.starts_with(' ') || line.starts_with('\t') {
                desc_lines.push(line.trim().to_string());
            } else if line.contains(':') {
                in_desc = false;
            }
        }
    }
    if description.is_empty() {
        description = desc_lines.join(" ");
    }
    if description.is_empty() {
        description = first_paragraph(rest.get(end + 4..).unwrap_or(""));
    }
    (name, description)
}

fn first_paragraph(raw: &str) -> String {
    raw.lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#') && !line.starts_with("---"))
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_skills_does_not_panic() {
        let skills = list_skills(None).expect("list_skills should not fail");
        assert!(
            skills.iter().any(|s| s.name.contains("ponytail")),
            "expected ponytail skill, got {:?}",
            skills.iter().map(|s| &s.name).collect::<Vec<_>>()
        );
    }
}
