// Real backend tests, using only temporary GROK_HOME fixture data.
#[allow(dead_code)]
#[path = "../src/paths.rs"]
mod paths;
#[path = "../src/sessions.rs"]
mod sessions;
#[allow(dead_code)]
#[path = "../src/settings.rs"]
mod settings;
#[path = "../src/skills.rs"]
mod skills;
use std::sync::Mutex;
static LOCK: Mutex<()> = Mutex::new(());
fn fixture() -> (std::sync::MutexGuard<'static, ()>, std::path::PathBuf) {
    let lock = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = std::env::temp_dir().join(format!(
        "grok-audit-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    std::env::set_var("GROK_HOME", &dir);
    (lock, dir)
}
#[test]
fn audit_settings_roundtrip_preserves_unrelated_config() {
    let (_g, dir) = fixture();
    std::fs::write(dir.join("config.toml"), "[custom]\nkeep = 'yes'\n").unwrap();
    let patch = serde_json::from_value(serde_json::json!({"model":"audit-model", "baseUrl":" http://localhost:9999/v1 ", "apiKey":"not-a-real-key", "reasoningEffort":"low"})).unwrap();
    let cfg = settings::save_settings(patch).unwrap();
    assert_eq!(cfg.model, "audit-model");
    assert_eq!(cfg.base_url, "http://localhost:9999/v1");
    assert_eq!(cfg.api_key_preview, "••••-key");
    assert!(std::fs::read_to_string(dir.join("config.toml"))
        .unwrap()
        .contains("keep = 'yes'"));
}
#[test]
fn audit_malformed_config_returns_error() {
    let (_g, dir) = fixture();
    std::fs::write(dir.join("config.toml"), "[[[").unwrap();
    assert!(settings::load_settings().is_err());
}
#[test]
fn audit_history_keeps_last_twenty_turns_and_unicode() {
    let (_g, dir) = fixture();
    let session = dir.join("sessions/group/audit");
    std::fs::create_dir_all(&session).unwrap();
    let raw = (0..25).flat_map(|i| [serde_json::json!({"params":{"update":{"sessionUpdate":"user_message_chunk","content":{"text":format!("问题{i}")}}}}).to_string(), serde_json::json!({"params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"text":"回答"}}}}).to_string()]).collect::<Vec<_>>().join("\n");
    std::fs::write(session.join("updates.jsonl"), raw).unwrap();
    let history = sessions::load_history("audit").unwrap();
    assert_eq!(history.len(), 40);
    assert_eq!(history[0].text, "问题5");
}
#[test]
fn audit_corrupt_session_summary_is_skipped() {
    let (_g, dir) = fixture();
    let session = dir.join("sessions/group/broken");
    std::fs::create_dir_all(&session).unwrap();
    std::fs::write(session.join("summary.json"), "{bad").unwrap();
    assert!(sessions::list_sessions().unwrap().is_empty());
}
#[test]
fn audit_markdown_commands_keep_distinct_names() {
    let (_g, dir) = fixture();
    let commands = dir.join("commands");
    std::fs::create_dir_all(&commands).unwrap();
    std::fs::write(commands.join("audit-review.md"), "Review source code").unwrap();
    std::fs::write(commands.join("audit-test.md"), "Run project tests").unwrap();
    let names = skills::list_skills(None)
        .unwrap()
        .into_iter()
        .filter(|s| s.path.starts_with(dir.to_str().unwrap()))
        .map(|s| s.name)
        .collect::<Vec<_>>();
    assert!(
        names.contains(&"audit-review".to_string()) && names.contains(&"audit-test".to_string()),
        "Expected distinct filename-based names; got {names:?}"
    );
}
#[test]
fn audit_skill_toggle_on_clean_home() {
    let (_g, _dir) = fixture();
    assert!(skills::set_skill_enabled("audit-skill", false).is_ok());
    assert!(std::fs::read_to_string(paths::config_path())
        .unwrap()
        .contains("audit-skill"));
}
