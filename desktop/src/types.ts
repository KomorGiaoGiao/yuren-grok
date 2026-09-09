export type Page = "chat" | "settings" | "skills" | "plugins";

export interface GrokStatus {
  found: boolean;
  path?: string | null;
  version?: string | null;
  browserAuth: boolean;
}

export interface AppSettings {
  grokHome: string;
  baseUrl: string;
  model: string;
  reasoningEffort: string;
  apiKeyConfigured: boolean;
  apiKeyPreview: string;
  browserAuth: boolean;
  lastProjectDir: string;
}

export interface ModelCatalog {
  models: string[];
  defaultModel: string;
  reasoningEffort: string;
  efforts: string[];
}

export interface SessionSummary {
  id: string;
  title: string;
  cwd: string;
  model: string;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
  lastTurn: string;
}

export interface HistoryMessage {
  role: "user" | "assistant" | "thought" | "tool" | string;
  text: string;
  title?: string;
  toolCallId?: string;
  toolKind?: string;
  diffs?: FileDiff[];
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  source: string;
  enabled: boolean;
}

export interface PluginInfo {
  name: string;
  enabled: boolean;
  trusted: boolean;
  source: string;
  description: string;
}

export interface PluginSnapshot {
  installed: PluginInfo[];
  available: PluginInfo[];
  marketplaces: { name: string; source: string }[];
}

export interface FileDiff {
  path: string;
  oldText: string;
  newText: string;
  unified?: boolean;
}

export type TurnPhase = "idle" | "received" | "thinking" | "tool" | "responding";

export interface ChatBlock {
  id: string;
  kind: "user" | "assistant" | "thought" | "tool";
  text: string;
  title?: string;
  status?: string;
  diffs?: FileDiff[];
  streaming?: boolean;
  toolKind?: string;
  description?: string;
  startedAt?: number;
  durationMs?: number;
}

export interface PermissionRequest {
  rpcId: unknown;
  title: string;
  description: string;
  options: { optionId: string; name: string; kind?: string }[];
}

export interface AgentUpdate {
  sessionUpdate?: string;
  sessionId?: string;
  update?: AgentUpdate;
  content?: unknown;
  title?: string;
  status?: string;
  kind?: string;
  toolCallId?: string;
  locations?: { path?: string }[];
  rawInput?: Record<string, unknown>;
  _meta?: { "x.ai/tool"?: { name?: string; kind?: string; label?: string; input?: Record<string, unknown> } };
  availableCommands?: { name: string; description?: string; input?: { hint?: string } }[];
  entries?: { content?: string; status?: string; priority?: string }[];
  description?: string;
  command?: string;
  task_id?: string;
  taskId?: string;
  tool_call_id?: string;
  task_snapshot?: TaskSnapshot;
  taskSnapshot?: TaskSnapshot;
}

export interface TaskSnapshot {
  task_id?: string;
  description?: string;
  command?: string;
  exit_code?: number | null;
  signal?: number | string | null;
  output?: string;
  start_time?: { secs_since_epoch?: number };
  end_time?: { secs_since_epoch?: number };
}
