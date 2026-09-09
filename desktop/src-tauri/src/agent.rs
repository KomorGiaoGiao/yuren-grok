use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

use crate::paths::find_grok_binary;

pub struct AgentHub {
    inner: Mutex<Option<LiveAgent>>,
    suppress_updates: Arc<AtomicBool>,
    epoch: Arc<AtomicU64>,
}

struct LiveAgent {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    next_id: Arc<AtomicU64>,
    pending: PendingMap,
    model: Option<String>,
    reasoning_effort: Option<String>,
}

type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSessionRequest {
    pub cwd: String,
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSessionResult {
    pub session_id: String,
    pub grok_path: String,
}

impl AgentHub {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            suppress_updates: Arc::new(AtomicBool::new(false)),
            epoch: Arc::new(AtomicU64::new(0)),
        }
    }

    pub async fn start(
        &self,
        app: AppHandle,
        req: StartSessionRequest,
    ) -> Result<StartSessionResult, String> {
        let grok = find_grok_binary(&app).ok_or_else(|| {
            "Grok engine was not found. Reinstall the app.".to_string()
        })?;

        let reused = match self.live().await {
            Ok(agent) if runtime_matches(&agent, &req) => self.attach_existing(&agent, &req).await,
            _ => None,
        };
        if let Some(session_id) = reused {
            return Ok(StartSessionResult {
                session_id,
                grok_path: grok.display().to_string(),
            });
        }

        self.stop().await;

        let mut command = Command::new(&grok);
        command.arg("agent");
        if let Some(model) = &req.model {
            command.arg("-m").arg(model);
        }
        if let Some(effort) = &req.reasoning_effort {
            if !effort.is_empty() {
                command.arg("--reasoning-effort").arg(effort);
            }
        }
        command
            .arg("stdio")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .current_dir(&req.cwd);

        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to start Grok: {e}"))?;
        let stdin = child.stdin.take().ok_or("Missing stdin")?;
        let stdout = child.stdout.take().ok_or("Missing stdout")?;
        let stderr = child.stderr.take().ok_or("Missing stderr")?;

        let stdin = Arc::new(Mutex::new(stdin));
        let next_id = Arc::new(AtomicU64::new(1));
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));

        let epoch = self.epoch.load(Ordering::SeqCst);
        spawn_stdout_reader(
            app.clone(),
            stdout,
            pending.clone(),
            stdin.clone(),
            self.suppress_updates.clone(),
            self.epoch.clone(),
            epoch,
        );
        spawn_stderr_reader(app.clone(), stderr);

        {
            let mut guard = self.inner.lock().await;
            *guard = Some(LiveAgent {
                child,
                stdin: stdin.clone(),
                next_id: next_id.clone(),
                pending: pending.clone(),
                model: req.model.clone(),
                reasoning_effort: req.reasoning_effort.clone(),
            });
        }

        let _init = rpc(
            &stdin,
            &next_id,
            &pending,
            "initialize",
            120,
            json!({
                "protocolVersion": 1,
                "clientInfo": { "name": "Grok Desktop", "version": "0.1.0" },
                "clientCapabilities": {
                    "fs": { "readTextFile": false, "writeTextFile": false },
                    "terminal": false
                }
            }),
        )
        .await?;

        let _quiet = SuppressGuard::new(self.suppress_updates.clone());
        let session_id = if let Some(existing) = req.session_id.clone() {
            match rpc(
                &stdin,
                &next_id,
                &pending,
                "session/load",
                120,
                session_params(&req.cwd, Some(&existing)),
            )
            .await
            {
                Ok(_) => existing,
                Err(err) => {
                    return Err(format!("Failed to resume session {existing}: {err}"));
                }
            }
        } else {
            create_session(&stdin, &next_id, &pending, &req.cwd).await?
        };

        Ok(StartSessionResult {
            session_id,
            grok_path: grok.display().to_string(),
        })
    }

    pub async fn prompt(&self, session_id: &str, text: &str) -> Result<Value, String> {
        let agent = self.live().await?;
        rpc(
            &agent.stdin,
            &agent.next_id,
            &agent.pending,
            "session/prompt",
            1800,
            json!({
                "sessionId": session_id,
                "prompt": [{ "type": "text", "text": text }]
            }),
        )
        .await
    }

    pub async fn cancel(&self, session_id: &str) -> Result<(), String> {
        let agent = self.live().await?;
        notify(
            &agent.stdin,
            "session/cancel",
            json!({ "sessionId": session_id }),
        )
        .await
    }

    pub async fn respond_permission(&self, rpc_id: Value, option_id: &str) -> Result<(), String> {
        let agent = self.live().await?;
        let mut stdin = agent.stdin.lock().await;
        let payload = json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": permission_result(option_id)
        });
        write_line(&mut stdin, &payload).await
    }

    pub async fn stop(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        let mut guard = self.inner.lock().await;
        if let Some(mut agent) = guard.take() {
            fail_pending(&agent.pending, "Agent stopped").await;
            let _ = agent.child.kill().await;
        }
    }

    async fn attach_existing(
        &self,
        agent: &LiveAgentHandles,
        req: &StartSessionRequest,
    ) -> Option<String> {
        let _quiet = SuppressGuard::new(self.suppress_updates.clone());
        if let Some(existing) = &req.session_id {
            rpc(
                &agent.stdin,
                &agent.next_id,
                &agent.pending,
                "session/load",
                120,
                session_params(&req.cwd, Some(existing)),
            )
            .await
            .ok()?;
            Some(existing.clone())
        } else {
            create_session(&agent.stdin, &agent.next_id, &agent.pending, &req.cwd)
                .await
                .ok()
        }
    }

    async fn live(&self) -> Result<LiveAgentHandles, String> {
        let guard = self.inner.lock().await;
        let agent = guard.as_ref().ok_or("Agent is not running")?;
        Ok(LiveAgentHandles {
            stdin: agent.stdin.clone(),
            next_id: agent.next_id.clone(),
            pending: agent.pending.clone(),
            model: agent.model.clone(),
            reasoning_effort: agent.reasoning_effort.clone(),
        })
    }
}

struct LiveAgentHandles {
    stdin: Arc<Mutex<ChildStdin>>,
    next_id: Arc<AtomicU64>,
    pending: PendingMap,
    model: Option<String>,
    reasoning_effort: Option<String>,
}

fn runtime_matches(agent: &LiveAgentHandles, req: &StartSessionRequest) -> bool {
    agent.model == req.model && agent.reasoning_effort == req.reasoning_effort
}

async fn fail_pending(pending: &PendingMap, message: &str) {
    let mut map = pending.lock().await;
    for (_, tx) in map.drain() {
        let _ = tx.send(json!({ "error": { "message": message } }));
    }
}

struct SuppressGuard(Arc<AtomicBool>);

impl SuppressGuard {
    fn new(flag: Arc<AtomicBool>) -> Self {
        flag.store(true, Ordering::SeqCst);
        Self(flag)
    }
}

impl Drop for SuppressGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

// ponytail: empty optionId = ACP cancelled; never invent an allow id
fn permission_result(option_id: &str) -> Value {
    if option_id.is_empty() {
        json!({ "outcome": { "outcome": "cancelled" } })
    } else {
        json!({
            "outcome": {
                "outcome": "selected",
                "optionId": option_id
            }
        })
    }
}

fn session_params(cwd: &str, session_id: Option<&str>) -> Value {
    let mut params = json!({
        "cwd": cwd,
        "mcpServers": []
    });
    if let Some(id) = session_id {
        params["sessionId"] = json!(id);
    }
    params
}

async fn create_session(
    stdin: &Arc<Mutex<ChildStdin>>,
    next_id: &Arc<AtomicU64>,
    pending: &PendingMap,
    cwd: &str,
) -> Result<String, String> {
    let result = rpc(
        stdin,
        next_id,
        pending,
        "session/new",
        120,
        session_params(cwd, None),
    )
    .await?;
    result
        .get("sessionId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Grok did not return a session id".to_string())
}

async fn rpc(
    stdin: &Arc<Mutex<ChildStdin>>,
    next_id: &Arc<AtomicU64>,
    pending: &PendingMap,
    method: &str,
    timeout_secs: u64,
    params: Value,
) -> Result<Value, String> {
    let id = next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel();
    pending.lock().await.insert(id, tx);
    {
        let mut writer = stdin.lock().await;
        write_line(
            &mut writer,
            &json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": method,
                "params": params
            }),
        )
        .await?;
    }
    let payload = match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx).await
    {
        Ok(Ok(value)) => value,
        Ok(Err(_)) => {
            pending.lock().await.remove(&id);
            return Err(format!("Agent closed while waiting for {method}"));
        }
        Err(_) => {
            pending.lock().await.remove(&id);
            return Err(format!("Timed out waiting for {method}"));
        }
    };
    if let Some(error) = payload.get("error") {
        return Err(error.to_string());
    }
    Ok(payload)
}

async fn notify(stdin: &Arc<Mutex<ChildStdin>>, method: &str, params: Value) -> Result<(), String> {
    let mut writer = stdin.lock().await;
    write_line(
        &mut writer,
        &json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }),
    )
    .await
}

async fn write_line(stdin: &mut ChildStdin, payload: &Value) -> Result<(), String> {
    let mut line = serde_json::to_vec(payload).map_err(|e| e.to_string())?;
    line.push(b'\n');
    stdin.write_all(&line).await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())
}

fn spawn_stdout_reader(
    app: AppHandle,
    stdout: tokio::process::ChildStdout,
    pending: PendingMap,
    stdin: Arc<Mutex<ChildStdin>>,
    suppress_updates: Arc<AtomicBool>,
    epoch: Arc<AtomicU64>,
    my_epoch: u64,
) {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                let _ = app.emit("agent-log", line);
                continue;
            };
            handle_message(&app, msg, &pending, &stdin, &suppress_updates).await;
        }
        if epoch.load(Ordering::SeqCst) == my_epoch {
            fail_pending(&pending, "Agent exited").await;
            let _ = app.emit("agent-exit", json!({ "reason": "stdout-closed" }));
        }
    });
}

fn spawn_stderr_reader(app: AppHandle, stderr: tokio::process::ChildStderr) {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app.emit("agent-log", line);
        }
    });
}

async fn handle_message(
    app: &AppHandle,
    msg: Value,
    pending: &PendingMap,
    stdin: &Arc<Mutex<ChildStdin>>,
    suppress_updates: &AtomicBool,
) {
    if let Some(method) = msg.get("method").and_then(|v| v.as_str()) {
        if msg.get("id").is_some() {
            if method == "session/request_permission" {
                let _ = app.emit(
                    "agent-permission",
                    json!({
                        "rpcId": msg.get("id"),
                        "params": msg.get("params")
                    }),
                );
                return;
            }
            let id = msg.get("id").cloned().unwrap_or(Value::Null);
            let mut writer = stdin.lock().await;
            let _ = write_line(
                &mut writer,
                &json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": format!("Method not implemented: {method}") }
                }),
            )
            .await;
            return;
        }
        if method == "session/update" && !suppress_updates.load(Ordering::Relaxed) {
            let _ = app.emit(
                "agent-update",
                msg.get("params").cloned().unwrap_or(json!({})),
            );
        }
        return;
    }

    if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
        if let Some(tx) = pending.lock().await.remove(&id) {
            let payload = if let Some(error) = msg.get("error") {
                json!({ "error": error })
            } else {
                msg.get("result").cloned().unwrap_or(json!({}))
            };
            let _ = tx.send(payload);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::permission_result;

    #[test]
    fn empty_option_cancels() {
        let value = permission_result("");
        assert_eq!(value["outcome"]["outcome"], "cancelled");
        assert!(value["outcome"].get("optionId").is_none());
    }

    #[test]
    fn selected_keeps_id() {
        let value = permission_result("allow_once");
        assert_eq!(value["outcome"]["outcome"], "selected");
        assert_eq!(value["outcome"]["optionId"], "allow_once");
    }
}
