import { t, type Locale } from "../i18n";
import type { AgentUpdate, ChatBlock } from "../types";

export type ToolVerb = "read" | "search" | "list" | "edit" | "execute" | "other";

type ToolInfo = {
  name: string;
  kind: string;
  label: string;
  path: string;
  pattern: string;
  command: string;
  description: string;
  title: string;
};

export function grokToolInfo(update: AgentUpdate): ToolInfo {
  const meta = update._meta?.["x.ai/tool"] || {};
  const input = {
    ...(typeof meta.input === "object" && meta.input ? meta.input : {}),
    ...(update.rawInput || {}),
  };
  const path = String(
    update.locations?.[0]?.path ||
      input.target_file ||
      input.path ||
      input.target_directory ||
      input.directory ||
      "",
  );
  return {
    name: String(meta.name || ""),
    kind: String(meta.kind || (update.kind !== "other" ? update.kind : "") || ""),
    label: String(meta.label || ""),
    path,
    pattern: String(input.pattern || input.query || input.regexp || ""),
    command: String(input.command || input.cmd || ""),
    description: String(input.description || ""),
    title: update.title || "",
  };
}

export function classifyTool(block: ChatBlock): ToolVerb {
  return classifyVerb(block.toolKind || "", block.title || "", block.title || "");
}

export function classifyVerb(kind: string, title: string, name: string): ToolVerb {
  const k = kind.toLowerCase();
  if (k === "read") return "read";
  if (k === "list") return "list";
  if (k === "search") return "search";
  if (k === "edit") return "edit";
  if (k === "execute" || k === "shell") return "execute";
  const hay = `${name} ${title}`.toLowerCase();
  if (/\b(read_file|view_file)\b/.test(hay) || /^read\b/.test(hay)) return "read";
  if (/\b(list_dir|list_files)\b/.test(hay) || /^list\b/.test(hay)) return "list";
  if (/\b(grep|glob|search_tool)\b/.test(hay) || /^(searched|search|rg)\b/.test(hay)) return "search";
  if (/\b(search_replace|write_file)\b/.test(hay) || /^(edit|write|update)\b/.test(hay)) return "edit";
  if (/\b(run_terminal_command|run_terminal_cmd)\b/.test(hay) || /^(run|bash|shell|execute)\b/.test(hay)) {
    return "execute";
  }
  return "other";
}

export function isGroupableTool(block: ChatBlock) {
  if (block.kind !== "tool") return false;
  const verb = classifyTool(block);
  return verb === "read" || verb === "search" || verb === "list";
}

export function formatToolTitle(info: ToolInfo): string {
  const verb = classifyVerb(info.kind, info.title, info.name);
  const path = shortPath(info.path);
  const hay = `${info.name} ${info.title}`.toLowerCase();
  if (/get_command_or_subagent_output/.test(hay)) return "Wait for command";
  if (verb === "execute") {
    const desc = info.description.trim();
    if (desc && desc !== "Run Command") return `Run ${desc}`;
    if (info.command) return `Run ${clip(oneLine(info.command), 72)}`;
  }
  if (isPrettyTitle(info.title)) return shortPathInTitle(info.title);
  switch (verb) {
    case "read":
      return path ? `Read ${path}` : info.title || "Read";
    case "list":
      return path ? `List ${path}` : info.title || "List";
    case "search":
      return info.pattern ? `Searched ${info.pattern}` : info.title || "Searched";
    case "edit":
      return path ? `Edit ${path}` : info.title || "Edit";
    case "execute":
      return info.title || "Run";
    default:
      return isGenericTitle(info.title) ? info.label || info.name || "Tool" : info.title;
  }
}

export function displayToolTitle(block: ChatBlock): string {
  return formatToolTitle({
    name: block.title || "",
    kind: block.toolKind || "",
    label: "",
    path: pathFromBlock(block),
    pattern: "",
    command: classifyTool(block) === "execute" ? firstLine(block.text) : "",
    description: block.description || "",
    title: block.title || "",
  });
}

export function formatDuration(ms: number) {
  if (ms < 10_000) {
    const value = ms / 1000;
    return `${value.toFixed(value < 1.95 ? 1 : 0).replace(/\.0$/, "")}s`;
  }
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes}m${seconds}s` : `${minutes}m`;
}

export function shortPath(path: string) {
  if (!path) return "";
  const markers = ["/Documents/grokDesktop/", "/grokDesktop/project/", "/grokDesktop/"];
  for (const marker of markers) {
    const at = path.indexOf(marker);
    if (at >= 0) return path.slice(at + marker.length) || path;
  }
  return path.replace(/^\/Users\/[^/]+/, "~");
}

export function betterTitle(next: string | undefined, prev: string | undefined): string {
  const a = next || "";
  const b = prev || "";
  return titleScore(a) >= titleScore(b) ? a : b;
}

export function summarizeTools(blocks: ChatBlock[], locale: Locale) {
  const counts = { read: 0, search: 0, list: 0 };
  let readName = "";
  for (const block of blocks) {
    const verb = classifyTool(block);
    if (verb === "read") {
      counts.read += 1;
      if (!readName) readName = pathFromBlock(block) || displayToolTitle(block).replace(/^Read\s+/i, "");
    } else if (verb === "search") counts.search += 1;
    else if (verb === "list") counts.list += 1;
  }
  const parts: string[] = [];
  if (counts.read === 1) parts.push(fill(t(locale, "readFile"), { name: readName || "1 file" }));
  else if (counts.read > 1) parts.push(fill(t(locale, "readFiles"), { count: counts.read }));
  if (counts.search === 1) parts.push(t(locale, "searchedPattern"));
  else if (counts.search > 1) parts.push(fill(t(locale, "searchedPatterns"), { count: counts.search }));
  if (counts.list === 1) parts.push(t(locale, "listedPath"));
  else if (counts.list > 1) parts.push(fill(t(locale, "listedPaths"), { count: counts.list }));
  return parts.join(", ");
}

function isPrettyTitle(title: string) {
  if (/^Execute\s+`/.test(title) || /^Execute\s+\//.test(title)) return false;
  return /^(Read|Edit|List|Run|Searched|Grep|Task)\b/.test(title) && !/^(read_file|list_dir|search_replace|run_terminal)/.test(title);
}

function isGenericTitle(title: string) {
  return !title || title === "tool" || title === "工具" || title === "Tool";
}

function titleScore(title: string) {
  if (isGenericTitle(title)) return 0;
  if (/^(read_file|list_dir|grep|search_replace|run_terminal_command|search_tool|todo_write)$/.test(title)) return 1;
  if (/^Execute\s+`/.test(title)) return 1;
  if (isPrettyTitle(title)) return 3;
  return 2;
}

function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function shortPathInTitle(title: string) {
  return title.replace(/(\s)(\/Users\/[^\s`]+)/g, (_, space, path) => `${space}${shortPath(path)}`);
}

function pathFromBlock(block: ChatBlock) {
  const title = block.title || "";
  const quoted = title.match(/`([^`]+)`/);
  if (quoted) return quoted[1];
  const spaced = title.match(/^(Read|Edit|List|Write|Update)\s+(.+)$/i);
  if (spaced) return spaced[2];
  const text = (block.text || "").trim();
  if (text && !text.includes("\n") && /[./]/.test(text) && text.length < 400) return text;
  return "";
}

function firstLine(text?: string) {
  return (text || "").split("\n")[0]?.trim() || "";
}

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}
