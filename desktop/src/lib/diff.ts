import type { FileDiff } from "../types";

export type DiffRow = { type: "same" | "add" | "del"; text: string };

export type EditRow = DiffRow & { line: number | null };

export function extractDiffs(content: unknown): FileDiff[] {
  const out: FileDiff[] = [];
  visitDiffs(content, out);
  return out;
}

function visitDiffs(content: unknown, out: FileDiff[]) {
  if (!content) return;
  if (Array.isArray(content)) {
    for (const item of content) visitDiffs(item, out);
    return;
  }
  if (typeof content !== "object") return;
  const rec = content as Record<string, unknown>;
  if (rec.type === "content") {
    visitDiffs(rec.content, out);
    return;
  }
  const hasDiff =
    rec.type === "diff" ||
    (typeof rec.path === "string" && (typeof rec.oldText === "string" || typeof rec.newText === "string")) ||
    (rec.patch && typeof rec.patch === "object");
  if (!hasDiff) return;
  const path =
    typeof rec.path === "string"
      ? rec.path
      : Array.isArray(rec.changes) && rec.changes[0] && typeof rec.changes[0] === "object"
        ? String((rec.changes[0] as { path?: string }).path || "")
        : "";
  const patch = rec.patch as { text?: string } | undefined;
  if (patch && typeof patch.text === "string") {
    out.push({ path: path || "patch", oldText: "", newText: patch.text, unified: true });
    return;
  }
  out.push({
    path: path || "file",
    oldText: typeof rec.oldText === "string" ? rec.oldText : "",
    newText: typeof rec.newText === "string" ? rec.newText : "",
  });
}

export function diffsFromToolText(title?: string, text?: string): FileDiff[] {
  if (!text) return [];
  const looksLikeDiff =
    text.startsWith("@@") ||
    text.startsWith("---") ||
    text.startsWith("+++") ||
    /\n[+]/.test(text) ||
    /\n[-]/.test(text);
  if (!looksLikeDiff) return [];
  const path = (title || "").replace(/^(Edit|Write|Update)\s+/i, "").trim() || "file";
  return [{ path, oldText: "", newText: text, unified: true }];
}

export function toEditRows(diff: FileDiff): EditRow[] {
  if (diff.unified) return parseUnified(diff.newText);
  if (!diff.oldText) {
    return diff.newText.split("\n").map((text, index) => ({
      type: "add" as const,
      text,
      line: index + 1,
    }));
  }
  return hunkRows(diff.oldText, diff.newText, 4);
}

function hunkRows(oldText: string, newText: string, context: number): EditRow[] {
  const full = numberDiff(diffLines(oldText, newText));
  if (!full.some((row) => row.type !== "same")) return full;
  const keep = full.map((row) => row.type !== "same");
  for (let i = 0; i < full.length; i++) {
    if (full[i].type === "same") continue;
    for (let k = Math.max(0, i - context); k <= Math.min(full.length - 1, i + context); k++) {
      keep[k] = true;
    }
  }
  const rows: EditRow[] = [];
  let gap = false;
  for (let i = 0; i < full.length; i++) {
    if (!keep[i]) {
      gap = true;
      continue;
    }
    if (gap && rows.length) rows.push({ type: "same", text: "···", line: null });
    gap = false;
    rows.push(full[i]);
  }
  return rows;
}

function numberDiff(rows: DiffRow[]): EditRow[] {
  let line = 1;
  return rows.map((row) => {
    if (row.type === "del") return { ...row, line: null };
    const numbered = { ...row, line };
    line += 1;
    return numbered;
  });
}

export function parseUnified(patch: string): EditRow[] {
  const rows: EditRow[] = [];
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const match = raw.match(/\+(\d+)/);
      newLine = match ? Number(match[1]) : newLine;
      continue;
    }
    if (raw.startsWith("---") || raw.startsWith("+++") || raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) {
      rows.push({ type: "add", text: raw.slice(1), line: newLine });
      newLine += 1;
    } else if (raw.startsWith("-")) {
      rows.push({ type: "del", text: raw.slice(1), line: null });
    } else {
      const text = raw.startsWith(" ") ? raw.slice(1) : raw;
      rows.push({ type: "same", text, line: newLine || null });
      if (newLine) newLine += 1;
    }
  }
  return rows;
}

export function diffLines(oldText: string, newText: string): DiffRow[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  if (a.length * b.length > 250_000) {
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "del", text: a[i] });
      i += 1;
    } else {
      rows.push({ type: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    rows.push({ type: "del", text: a[i] });
    i += 1;
  }
  while (j < m) {
    rows.push({ type: "add", text: b[j] });
    j += 1;
  }
  return rows;
}

export function fileName(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}
