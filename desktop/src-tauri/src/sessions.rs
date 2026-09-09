use serde::Serialize;
use serde_json::Value;

use crate::paths::sessions_dir;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub model: String,
    pub updated_at: String,
    pub created_at: String,
    pub message_count: u64,
    pub last_turn: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMessage {
    pub role: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diffs: Option<Vec<FileDiff>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub old_text: String,
    pub new_text: String,
    pub unified: bool,
}

pub fn list_sessions() -> Result<Vec<SessionSummary>, String> {
    let root = sessions_dir();
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    let groups = std::fs::read_dir(&root).map_err(|e| e.to_string())?;
    for group in groups.flatten() {
        let group_path = group.path();
        if !group_path.is_dir() {
            continue;
        }
        let sessions = std::fs::read_dir(&group_path).map_err(|e| e.to_string())?;
        for session in sessions.flatten() {
            let session_path = session.path();
            let summary_path = session_path.join("summary.json");
            if !summary_path.is_file() {
                continue;
            }
            let raw = std::fs::read_to_string(&summary_path).unwrap_or_default();
            let Ok(value) = serde_json::from_str::<Value>(&raw) else {
                continue;
            };
            let id = value
                .pointer("/info/id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if id.is_empty() {
                continue;
            }
            let cwd = value
                .pointer("/info/cwd")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let title = first_nonempty(
                &value,
                &["generated_title", "session_summary", "last_turn_summary"],
            );
            let message_count = value
                .get("num_messages")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            // session/new leaves untitled stubs (system prompt only) that drown the real history.
            if title.is_empty() && message_count == 0 {
                continue;
            }
            out.push(SessionSummary {
                id,
                title,
                cwd,
                model: value
                    .get("current_model_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                updated_at: value
                    .get("updated_at")
                    .or_else(|| value.get("last_active_at"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                created_at: value
                    .get("created_at")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                message_count,
                last_turn: value
                    .get("last_turn_summary")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            });
        }
    }

    out.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.id.cmp(&a.id))
    });
    Ok(out)
}

const RECENT_USER_TURNS: usize = 20;

pub fn load_history(session_id: &str) -> Result<Vec<HistoryMessage>, String> {
    if let Some(path) = find_session_file(session_id, "updates.jsonl") {
        let messages = load_updates_recent(&path, RECENT_USER_TURNS)?;
        if !messages.is_empty() {
            return Ok(messages);
        }
    }
    Ok(take_last_user_turns(
        load_chat_history(session_id)?,
        RECENT_USER_TURNS,
    ))
}

fn load_updates_recent(
    path: &std::path::Path,
    max_turns: usize,
) -> Result<Vec<HistoryMessage>, String> {
    use std::io::{Read, Seek, SeekFrom};

    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    if len == 0 {
        return Ok(Vec::new());
    }

    let mut window = 256 * 1024u64;
    loop {
        let start = len.saturating_sub(window);
        file.seek(SeekFrom::Start(start))
            .map_err(|e| e.to_string())?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        let bytes = if start > 0 {
            match buf.iter().position(|&b| b == b'\n') {
                Some(i) => &buf[i + 1..],
                None if start == 0 => buf.as_slice(),
                None => {
                    if window >= len {
                        buf.as_slice()
                    } else {
                        window = window.saturating_mul(4).min(len);
                        continue;
                    }
                }
            }
        } else {
            buf.as_slice()
        };
        let text = String::from_utf8_lossy(bytes);
        let messages = parse_update_text(&text);
        let users = messages.iter().filter(|m| m.role == "user").count();
        if users >= max_turns || start == 0 {
            return Ok(take_last_user_turns(messages, max_turns));
        }
        let next = window.saturating_mul(4).min(len);
        if next == window {
            return Ok(take_last_user_turns(messages, max_turns));
        }
        window = next;
    }
}

fn parse_update_text(raw: &str) -> Vec<HistoryMessage> {
    let mut messages = Vec::new();
    for line in raw.lines() {
        if !is_history_update_line(line) {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let update = value
            .pointer("/params/update")
            .or_else(|| value.get("update"))
            .unwrap_or(&Value::Null);
        let kind = update
            .get("sessionUpdate")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let (role, text, title, tool_call_id, diffs) = match kind {
            "user_message_chunk" => ("user", extract_text(update), None, None, None),
            "agent_thought_chunk" => ("thought", extract_text(update), None, None, None),
            "agent_message_chunk" => ("assistant", extract_text(update), None, None, None),
            "tool_call" | "tool_call_update" => {
                let title = tool_title(update);
                let id = update
                    .get("toolCallId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let diffs = extract_diffs(update);
                (
                    "tool",
                    extract_text(update),
                    title,
                    id,
                    if diffs.is_empty() { None } else { Some(diffs) },
                )
            }
            _ => continue,
        };
        let cleaned = if role == "user" {
            let stripped = strip_user_query(&text);
            if is_meta_user(&text) && !text.contains("<user_query>") {
                continue;
            }
            stripped
        } else {
            text
        };
        if cleaned.trim().is_empty() && title.is_none() && diffs.is_none() {
            continue;
        }
        push_or_merge(
            &mut messages,
            role,
            cleaned,
            title,
            tool_call_id,
            if role == "tool" {
                tool_kind(update)
            } else {
                None
            },
            diffs,
        );
    }
    messages
}

fn take_last_user_turns(messages: Vec<HistoryMessage>, max_turns: usize) -> Vec<HistoryMessage> {
    if max_turns == 0 || messages.is_empty() {
        return messages;
    }
    let mut seen = 0usize;
    let mut start = 0usize;
    for (i, message) in messages.iter().enumerate().rev() {
        if message.role == "user" {
            seen += 1;
            start = i;
            if seen >= max_turns {
                break;
            }
        }
    }
    messages[start..].to_vec()
}

fn is_history_update_line(line: &str) -> bool {
    let head = utf8_prefix(line, 1200);
    head.contains("user_message_chunk")
        || head.contains("agent_thought_chunk")
        || head.contains("agent_message_chunk")
        || head.contains("tool_call")
}

fn utf8_prefix(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

fn load_chat_history(session_id: &str) -> Result<Vec<HistoryMessage>, String> {
    let Some(path) = find_session_file(session_id, "chat_history.jsonl") else {
        return Ok(Vec::new());
    };
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut messages = Vec::new();
    for line in raw.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let kind = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match kind {
            "user" => {
                let text = extract_text(&value);
                if is_meta_user(&text) && !text.contains("<user_query>") {
                    continue;
                }
                let cleaned = strip_user_query(&text);
                if cleaned.trim().is_empty() {
                    continue;
                }
                push_or_merge(&mut messages, "user", cleaned, None, None, None, None);
            }
            "assistant" => {
                let text = extract_text(&value);
                if text.trim().is_empty() {
                    continue;
                }
                push_or_merge(&mut messages, "assistant", text, None, None, None, None);
            }
            "reasoning" => {
                let text = reasoning_summary(&value);
                if text.trim().is_empty() {
                    continue;
                }
                push_or_merge(&mut messages, "thought", text, None, None, None, None);
            }
            _ => continue,
        }
    }
    Ok(messages)
}

fn push_or_merge(
    messages: &mut Vec<HistoryMessage>,
    role: &str,
    text: String,
    title: Option<String>,
    tool_call_id: Option<String>,
    tool_kind: Option<String>,
    diffs: Option<Vec<FileDiff>>,
) {
    if role == "tool" {
        if let Some(existing) = messages.iter_mut().rev().find(|item| {
            item.role == "tool"
                && match (&item.tool_call_id, &tool_call_id) {
                    (Some(a), Some(b)) => a == b,
                    _ => item.title == title,
                }
        }) {
            if !text.is_empty() {
                if !existing.text.is_empty() && existing.text != text {
                    existing.text.push('\n');
                    existing.text.push_str(&text);
                } else if existing.text.is_empty() {
                    existing.text = text;
                }
            }
            if title_score(title.as_deref()) >= title_score(existing.title.as_deref()) {
                existing.title = title;
            }
            if let Some(kind) = tool_kind {
                if existing.tool_kind.as_deref().unwrap_or("other") == "other" || kind != "other" {
                    existing.tool_kind = Some(kind);
                }
            }
            if diffs.is_some() {
                existing.diffs = diffs;
            }
            return;
        }
        messages.push(HistoryMessage {
            role: role.into(),
            text,
            title,
            tool_call_id,
            tool_kind,
            diffs,
        });
        return;
    }
    if let Some(last) = messages.last_mut() {
        if last.role == role && title.is_none() {
            last.text.push_str(&text);
            return;
        }
    }
    messages.push(HistoryMessage {
        role: role.into(),
        text,
        title,
        tool_call_id: None,
        tool_kind: None,
        diffs: None,
    });
}

fn tool_kind(update: &Value) -> Option<String> {
    update
        .pointer("/_meta/x.ai/tool/kind")
        .and_then(|v| v.as_str())
        .filter(|kind| !kind.is_empty())
        .or_else(|| {
            update
                .get("kind")
                .and_then(|v| v.as_str())
                .filter(|kind| *kind != "other" && !kind.is_empty())
        })
        .or_else(|| {
            update
                .pointer("/_meta/x.ai/tool/name")
                .and_then(|v| v.as_str())
        })
        .map(|s| s.to_string())
}

fn tool_title(update: &Value) -> Option<String> {
    let desc = update
        .pointer("/rawInput/description")
        .or_else(|| update.pointer("/_meta/x.ai/tool/input/description"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let kind = tool_kind(update).unwrap_or_default();
    if matches!(kind.as_str(), "execute" | "shell") && !desc.is_empty() && desc != "Run Command" {
        return Some(format!("Run {desc}"));
    }
    let raw = update.get("title").and_then(|v| v.as_str()).unwrap_or("");
    if raw.starts_with("Execute `") && !desc.is_empty() && desc != "Run Command" {
        return Some(format!("Run {desc}"));
    }
    if !raw.is_empty() && raw != "tool" && !raw.starts_with("Execute `") {
        return Some(raw.to_string());
    }
    update
        .pointer("/_meta/x.ai/tool/label")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty() && *s != "Run Command")
        .map(|s| s.to_string())
}

fn title_score(title: Option<&str>) -> u8 {
    let Some(title) = title else { return 0 };
    if title.is_empty() || title == "tool" || title == "工具" {
        return 0;
    }
    if matches!(
        title,
        "read_file"
            | "list_dir"
            | "grep"
            | "search_replace"
            | "run_terminal_command"
            | "search_tool"
            | "todo_write"
    ) {
        return 1;
    }
    if title.starts_with("Read ")
        || title.starts_with("Edit ")
        || title.starts_with("List ")
        || title.starts_with("Run ")
        || title.starts_with("Searched ")
        || title.starts_with("Execute ")
    {
        if title.starts_with("Execute `") {
            return 1;
        }
        return 3;
    }
    2
}

fn find_session_file(session_id: &str, filename: &str) -> Option<std::path::PathBuf> {
    let root = sessions_dir();
    let groups = std::fs::read_dir(root).ok()?;
    for group in groups.flatten() {
        let candidate = group.path().join(session_id).join(filename);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn first_nonempty(value: &Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(text) = value.get(*key).and_then(|v| v.as_str()).map(str::trim) {
            if !text.is_empty() {
                return text.to_string();
            }
        }
    }
    String::new()
}

fn is_meta_user(text: &str) -> bool {
    text.contains("<user_info>") || text.contains("<system-reminder>")
}

fn reasoning_summary(value: &Value) -> String {
    if let Some(arr) = value.get("summary").and_then(|v| v.as_array()) {
        let text = arr
            .iter()
            .filter_map(|item| item.get("text").and_then(|v| v.as_str()))
            .collect::<Vec<_>>()
            .join("\n");
        if !text.trim().is_empty() {
            return text;
        }
    }
    extract_text(value)
}

fn extract_text(value: &Value) -> String {
    let Some(content) = value.get("content") else {
        return String::new();
    };
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    if let Some(s) = content.get("text").and_then(|v| v.as_str()) {
        return s.to_string();
    }
    if let Some(arr) = content.as_array() {
        return arr
            .iter()
            .filter_map(item_text)
            .collect::<Vec<_>>()
            .join("\n");
    }
    String::new()
}

fn item_text(item: &Value) -> Option<String> {
    if item.get("type").and_then(|v| v.as_str()) == Some("diff") {
        return None;
    }
    if let Some(s) = item.get("text").and_then(|v| v.as_str()) {
        if !s.is_empty() {
            return Some(s.to_string());
        }
    }
    if let Some(nested) = item.get("content") {
        if let Some(s) = nested.get("text").and_then(|v| v.as_str()) {
            return Some(s.to_string());
        }
        if let Some(s) = nested.as_str() {
            return Some(s.to_string());
        }
    }
    None
}

fn extract_diffs(update: &Value) -> Vec<FileDiff> {
    let mut out = Vec::new();
    visit_diffs(update.get("content").unwrap_or(&Value::Null), &mut out);
    out
}

fn visit_diffs(value: &Value, out: &mut Vec<FileDiff>) {
    if let Some(arr) = value.as_array() {
        for item in arr {
            visit_diffs(item, out);
        }
        return;
    }
    let Some(obj) = value.as_object() else {
        return;
    };
    if obj.get("type").and_then(|v| v.as_str()) == Some("content") {
        if let Some(nested) = obj.get("content") {
            visit_diffs(nested, out);
        }
        return;
    }
    let is_diff = obj.get("type").and_then(|v| v.as_str()) == Some("diff")
        || (obj.get("path").and_then(|v| v.as_str()).is_some()
            && (obj.get("oldText").is_some() || obj.get("newText").is_some()));
    if !is_diff {
        return;
    }
    let path = obj
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("file")
        .to_string();
    if let Some(patch) = obj
        .get("patch")
        .and_then(|v| v.get("text"))
        .and_then(|v| v.as_str())
    {
        out.push(FileDiff {
            path,
            old_text: String::new(),
            new_text: patch.to_string(),
            unified: true,
        });
        return;
    }
    out.push(FileDiff {
        path,
        old_text: obj
            .get("oldText")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        new_text: obj
            .get("newText")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        unified: false,
    });
}

fn strip_user_query(text: &str) -> String {
    if let Some(start) = text.find("<user_query>") {
        let rest = &text[start + "<user_query>".len()..];
        if let Some(end) = rest.find("</user_query>") {
            return rest[..end].trim().to_string();
        }
    }
    text.trim().to_string()
}
