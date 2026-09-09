mod agent;
mod paths;
mod plugins;
mod sessions;
mod settings;
mod skills;

use agent::{AgentHub, StartSessionRequest};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GrokStatus {
    found: bool,
    path: Option<String>,
    version: Option<String>,
    browser_auth: bool,
}

#[tauri::command]
fn grok_status(app: AppHandle) -> GrokStatus {
    let path = paths::find_grok_binary(&app);
    let version = path.as_ref().and_then(|p| {
        let output = std::process::Command::new(p)
            .arg("--version")
            .output()
            .ok()?;
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    });
    GrokStatus {
        found: path.is_some(),
        path: path.map(|p| p.display().to_string()),
        version,
        browser_auth: paths::auth_path().is_file(),
    }
}

#[tauri::command]
fn get_settings() -> Result<settings::AppSettings, String> {
    settings::load_settings()
}

#[tauri::command]
fn save_settings(patch: settings::SettingsPatch) -> Result<settings::AppSettings, String> {
    settings::save_settings(patch)
}

#[tauri::command]
fn list_models(app: AppHandle) -> Result<settings::ModelCatalog, String> {
    settings::list_models(paths::find_grok_binary(&app).as_deref())
}

#[tauri::command]
fn list_sessions() -> Result<Vec<sessions::SessionSummary>, String> {
    sessions::list_sessions()
}

#[tauri::command]
fn load_history(session_id: String) -> Result<Vec<sessions::HistoryMessage>, String> {
    sessions::load_history(&session_id)
}

#[tauri::command]
async fn list_skills(project_dir: Option<String>) -> Result<Vec<skills::SkillInfo>, String> {
    tokio::task::spawn_blocking(move || skills::list_skills(project_dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_skill_enabled(name: String, enabled: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || skills::set_skill_enabled(&name, enabled))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_plugins(app: AppHandle) -> Result<plugins::PluginSnapshot, String> {
    plugins::list_plugins(&app).await
}

#[tauri::command]
async fn set_plugin_enabled(app: AppHandle, name: String, enabled: bool) -> Result<(), String> {
    plugins::set_plugin_enabled(&app, &name, enabled).await
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new("explorer");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn login_browser(app: AppHandle) -> Result<String, String> {
    let grok = paths::find_grok_binary(&app).ok_or("Grok CLI not found")?;
    std::process::Command::new(grok)
        .args(["login", "--oauth"])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok("started".into())
}

#[tauri::command]
fn logout_browser(app: AppHandle) -> Result<(), String> {
    let grok = paths::find_grok_binary(&app).ok_or("Grok CLI not found")?;
    let status = std::process::Command::new(grok)
        .arg("logout")
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Logout failed".into())
    }
}

#[tauri::command]
async fn start_session(
    app: AppHandle,
    hub: State<'_, AgentHub>,
    request: StartSessionRequest,
) -> Result<agent::StartSessionResult, String> {
    hub.start(app, request).await
}

#[tauri::command]
async fn send_prompt(
    hub: State<'_, AgentHub>,
    session_id: String,
    text: String,
) -> Result<Value, String> {
    let result = hub.prompt(&session_id, &text).await?;
    if result.get("error").is_some() {
        return Err(result["error"].to_string());
    }
    Ok(result)
}

#[tauri::command]
async fn cancel_prompt(hub: State<'_, AgentHub>, session_id: String) -> Result<(), String> {
    hub.cancel(&session_id).await
}

#[tauri::command]
async fn respond_permission(
    hub: State<'_, AgentHub>,
    rpc_id: Value,
    option_id: String,
) -> Result<(), String> {
    hub.respond_permission(rpc_id, &option_id).await
}

#[tauri::command]
async fn stop_session(hub: State<'_, AgentHub>) -> Result<(), String> {
    hub.stop().await;
    Ok(())
}

#[tauri::command]
fn default_workspace_preview() -> String {
    paths::next_default_workspace().display().to_string()
}

#[tauri::command]
fn prepare_workspace(path: Option<String>) -> Result<String, String> {
    paths::prepare_workspace(path)
}

#[cfg(target_os = "macos")]
fn apply_dock_icon() {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let data = NSData::with_bytes(include_bytes!("../icons/icon.png"));
    let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
        return;
    };
    let app = NSApplication::sharedApplication(mtm);
    unsafe {
        app.setApplicationIconImage(Some(&image));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            apply_dock_icon();
            Ok(())
        })
        .manage(AgentHub::new())
        .invoke_handler(tauri::generate_handler![
            grok_status,
            get_settings,
            save_settings,
            list_models,
            list_sessions,
            load_history,
            list_skills,
            set_skill_enabled,
            list_plugins,
            set_plugin_enabled,
            open_path,
            login_browser,
            logout_browser,
            start_session,
            send_prompt,
            cancel_prompt,
            respond_permission,
            stop_session,
            default_workspace_preview,
            prepare_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running Grok Desktop");
}
