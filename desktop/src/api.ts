import { invoke } from "@tauri-apps/api/core";
import { listen, TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AgentUpdate,
  AppSettings,
  GrokStatus,
  HistoryMessage,
  ModelCatalog,
  PluginSnapshot,
  SessionSummary,
  SkillInfo,
} from "./types";

export const api = {
  grokStatus: () => invoke<GrokStatus>("grok_status"),
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (patch: Record<string, unknown>) =>
    invoke<AppSettings>("save_settings", { patch }),
  listModels: () => invoke<ModelCatalog>("list_models"),
  listSessions: () => invoke<SessionSummary[]>("list_sessions"),
  loadHistory: (sessionId: string) =>
    invoke<HistoryMessage[]>("load_history", { sessionId }),
  listSkills: (projectDir?: string) =>
    invoke<SkillInfo[]>("list_skills", { projectDir: projectDir ?? null }),
  setSkillEnabled: (name: string, enabled: boolean) =>
    invoke("set_skill_enabled", { name, enabled }),
  listPlugins: () => invoke<PluginSnapshot>("list_plugins"),
  setPluginEnabled: (name: string, enabled: boolean) =>
    invoke("set_plugin_enabled", { name, enabled }),
  openPath: (path: string) => invoke("open_path", { path }),
  loginBrowser: () => invoke<string>("login_browser"),
  logoutBrowser: () => invoke("logout_browser"),
  startSession: (cwd: string, sessionId?: string, model?: string, reasoningEffort?: string) =>
    invoke<{ sessionId: string; grokPath: string }>("start_session", {
      request: {
        cwd,
        sessionId: sessionId ?? null,
        model: model ?? null,
        reasoningEffort: reasoningEffort ?? null,
      },
    }),
  sendPrompt: (sessionId: string, text: string) =>
    invoke("send_prompt", { sessionId, text }),
  cancelPrompt: (sessionId: string) => invoke("cancel_prompt", { sessionId }),
  respondPermission: (rpcId: unknown, optionId: string) =>
    invoke("respond_permission", { rpcId, optionId }),
  stopSession: () => invoke("stop_session"),
  pickFolder: async () => {
    const selected = await open({ directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  },
  pickFiles: async () => pickDialog({ multiple: true, directory: false }),
  pickFolders: async () => pickDialog({ multiple: true, directory: true }),
  defaultWorkspacePreview: () => invoke<string>("default_workspace_preview"),
  prepareWorkspace: (path?: string | null) =>
    invoke<string>("prepare_workspace", { path: path ?? null }),
};

async function pickDialog(options: { multiple: boolean; directory: boolean }) {
  const selected = await open(options);
  if (Array.isArray(selected)) return selected.filter((item) => typeof item === "string");
  return typeof selected === "string" ? [selected] : [];
}

export async function listenFileDrop(
  onHover: (over: boolean) => void,
  onDrop: (paths: string[]) => void,
): Promise<UnlistenFn> {
  const enter = await listen<{ paths?: string[] }>(TauriEvent.DRAG_ENTER, () => onHover(true));
  const over = await listen(TauriEvent.DRAG_OVER, () => onHover(true));
  const leave = await listen(TauriEvent.DRAG_LEAVE, () => onHover(false));
  const drop = await listen<{ paths?: string[] }>(TauriEvent.DRAG_DROP, (event) => {
    onHover(false);
    const paths = event.payload?.paths?.filter((path) => typeof path === "string" && path.length > 0) ?? [];
    if (paths.length) onDrop(paths);
  });
  return () => {
    enter();
    over();
    leave();
    drop();
  };
}

export async function listenAgent(
  onUpdate: (update: AgentUpdate) => void,
  onPermission: (payload: unknown) => void,
  onLog: (line: string) => void,
  onExit?: (payload: unknown) => void,
): Promise<UnlistenFn[]> {
  const a = await listen<AgentUpdate>("agent-update", (e) => onUpdate(e.payload));
  const b = await listen("agent-permission", (e) => onPermission(e.payload));
  const c = await listen<string>("agent-log", (e) => onLog(e.payload));
  const d = await listen("agent-exit", (e) => onExit?.(e.payload));
  return [a, b, c, d];
}
