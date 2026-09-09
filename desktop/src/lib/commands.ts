import type { Locale } from "../i18n";

export type CommandKind = "agent" | "local";

export interface GrokCommand {
  name: string;
  aliases?: string[];
  hint?: string;
  kind: CommandKind;
  group: "session" | "mode" | "work" | "ext";
  description: Record<Locale, string>;
}

export const GROK_COMMANDS: GrokCommand[] = [
  {
    name: "new",
    aliases: ["clear"],
    kind: "local",
    group: "session",
    description: {
      "zh-CN": "开始新会话",
      "zh-TW": "開始新工作階段",
      en: "Start a new session",
    },
  },
  {
    name: "compact",
    hint: "keep …",
    kind: "agent",
    group: "session",
    description: {
      "zh-CN": "压缩对话，腾出上下文",
      "zh-TW": "壓縮對話，騰出上下文",
      en: "Compact conversation to free context",
    },
  },
  {
    name: "rewind",
    aliases: ["undo"],
    kind: "agent",
    group: "session",
    description: {
      "zh-CN": "回退到上一轮",
      "zh-TW": "回到上一輪",
      en: "Rewind to an earlier turn",
    },
  },
  {
    name: "context",
    kind: "agent",
    group: "session",
    description: {
      "zh-CN": "查看上下文占用",
      "zh-TW": "查看上下文占用",
      en: "Show context window usage",
    },
  },
  {
    name: "session-info",
    aliases: ["status", "info"],
    kind: "agent",
    group: "session",
    description: {
      "zh-CN": "会话信息与用量",
      "zh-TW": "工作階段資訊與用量",
      en: "Session details and usage",
    },
  },
  {
    name: "fork",
    kind: "agent",
    group: "session",
    description: {
      "zh-CN": "分叉出并行 Agent",
      "zh-TW": "分叉出並行 Agent",
      en: "Fork a parallel agent",
    },
  },
  {
    name: "rename",
    aliases: ["title"],
    hint: "title",
    kind: "agent",
    group: "session",
    description: {
      "zh-CN": "重命名当前会话",
      "zh-TW": "重新命名目前工作階段",
      en: "Rename this session",
    },
  },
  {
    name: "export",
    kind: "agent",
    group: "session",
    description: {
      "zh-CN": "导出对话",
      "zh-TW": "匯出對話",
      en: "Export the conversation",
    },
  },
  {
    name: "copy",
    kind: "agent",
    group: "session",
    description: {
      "zh-CN": "复制最近回复",
      "zh-TW": "複製最近回覆",
      en: "Copy the latest reply",
    },
  },
  {
    name: "plan",
    hint: "description",
    kind: "agent",
    group: "mode",
    description: {
      "zh-CN": "进入计划模式",
      "zh-TW": "進入計畫模式",
      en: "Enter plan mode",
    },
  },
  {
    name: "view-plan",
    aliases: ["show-plan", "plan-view"],
    kind: "agent",
    group: "mode",
    description: {
      "zh-CN": "查看当前计划",
      "zh-TW": "查看目前計畫",
      en: "View the current plan",
    },
  },
  {
    name: "always-approve",
    kind: "agent",
    group: "mode",
    description: {
      "zh-CN": "切换始终允许",
      "zh-TW": "切換始終允許",
      en: "Toggle always-approve",
    },
  },
  {
    name: "auto",
    kind: "agent",
    group: "mode",
    description: {
      "zh-CN": "切换自动批准安全操作",
      "zh-TW": "切換自動核准安全操作",
      en: "Toggle auto permission mode",
    },
  },
  {
    name: "model",
    aliases: ["m"],
    hint: "grok-4.6",
    kind: "agent",
    group: "mode",
    description: {
      "zh-CN": "切换模型",
      "zh-TW": "切換模型",
      en: "Switch model",
    },
  },
  {
    name: "effort",
    hint: "low|medium|high|xhigh",
    kind: "agent",
    group: "mode",
    description: {
      "zh-CN": "设置思考强度",
      "zh-TW": "設定思考強度",
      en: "Set reasoning effort",
    },
  },
  {
    name: "mcps",
    kind: "agent",
    group: "ext",
    description: {
      "zh-CN": "MCP 服务器",
      "zh-TW": "MCP 伺服器",
      en: "Manage MCP servers",
    },
  },
  {
    name: "plugins",
    hint: "list|install …",
    kind: "agent",
    group: "ext",
    description: {
      "zh-CN": "插件：列表 / 安装 / 卸载",
      "zh-TW": "外掛：列表 / 安裝 / 解除安裝",
      en: "Plugins: list / install / uninstall",
    },
  },
  {
    name: "marketplace",
    kind: "agent",
    group: "ext",
    description: {
      "zh-CN": "浏览插件市场",
      "zh-TW": "瀏覽外掛市集",
      en: "Browse plugin marketplace",
    },
  },
  {
    name: "hooks",
    kind: "agent",
    group: "ext",
    description: {
      "zh-CN": "查看与管理 Hooks",
      "zh-TW": "查看與管理 Hooks",
      en: "View and manage hooks",
    },
  },
  {
    name: "skills",
    kind: "local",
    group: "ext",
    description: {
      "zh-CN": "打开技能页",
      "zh-TW": "開啟技能頁",
      en: "Open the skills page",
    },
  },
  {
    name: "settings",
    kind: "local",
    group: "ext",
    description: {
      "zh-CN": "打开设置",
      "zh-TW": "開啟設定",
      en: "Open settings",
    },
  },
  {
    name: "workflow",
    hint: "name | runs",
    kind: "agent",
    group: "work",
    description: {
      "zh-CN": "运行或管理 workflow",
      "zh-TW": "執行或管理工作流程",
      en: "Run or manage a workflow",
    },
  },
  {
    name: "deep-research",
    hint: "query",
    kind: "agent",
    group: "work",
    description: {
      "zh-CN": "启动深度调研",
      "zh-TW": "啟動深度調研",
      en: "Start deep research",
    },
  },
  {
    name: "loop",
    hint: "30m prompt",
    kind: "agent",
    group: "work",
    description: {
      "zh-CN": "按间隔循环执行",
      "zh-TW": "依間隔循環執行",
      en: "Run a prompt on a schedule",
    },
  },
  {
    name: "remember",
    hint: "note",
    kind: "agent",
    group: "work",
    description: {
      "zh-CN": "写入记忆",
      "zh-TW": "寫入記憶",
      en: "Save a note to memory",
    },
  },
  {
    name: "btw",
    hint: "question",
    kind: "agent",
    group: "work",
    description: {
      "zh-CN": "旁路提问，不打断当前任务",
      "zh-TW": "旁路提問，不打斷目前任務",
      en: "Ask a side question without derailing",
    },
  },
];

export interface AgentCommand {
  name: string;
  description?: string;
  input?: { hint?: string };
}

export function commandMatches(cmd: { name: string; aliases?: string[]; description: string }, query: string) {
  const q = query.toLowerCase();
  if (!q) return true;
  if (cmd.name.toLowerCase().includes(q)) return true;
  if (cmd.aliases?.some((alias) => alias.toLowerCase().includes(q))) return true;
  return cmd.description.toLowerCase().includes(q);
}

export function findCommand(name: string): GrokCommand | undefined {
  const key = name.toLowerCase();
  return GROK_COMMANDS.find(
    (cmd) => cmd.name === key || cmd.aliases?.some((alias) => alias.toLowerCase() === key),
  );
}

export function parseSlash(text: string): { name: string; rest: string } | null {
  const match = text.trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1], rest: (match[2] || "").trim() };
}
