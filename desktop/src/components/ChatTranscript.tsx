import { useState } from "react";
import { Markdown } from "./Markdown";
import { t, type Locale } from "../i18n";
import { toEditRows } from "../lib/diff";
import {
  classifyTool,
  displayToolTitle,
  formatDuration,
  isGroupableTool,
  summarizeTools,
} from "../lib/tools";
import type { ChatBlock, FileDiff, TurnPhase } from "../types";

type Turn = {
  id: string;
  user: ChatBlock[];
  grok: ChatBlock[];
};

export function ChatTranscript({
  blocks,
  locale,
  phase,
  busy,
  truncated = false,
}: {
  blocks: ChatBlock[];
  locale: Locale;
  phase: TurnPhase;
  busy: boolean;
  truncated?: boolean;
}) {
  const turns = groupTurns(blocks);
  return (
    <div className="transcript" data-testid="chat-transcript">
      {truncated ? <div className="history-trim">{t(locale, "historyTruncated")}</div> : null}
      {turns.map((turn, index) => {
        const live = busy && index === turns.length - 1;
        const hasThought = turn.grok.some((block) => block.kind === "thought");
        const hasAssistant = turn.grok.some((block) => block.kind === "assistant");
        return (
          <section key={turn.id} className={`turn${live ? " live" : ""}`}>
            {turn.user.length ? (
              <div className="turn-user">
                {turn.user.map((block) => (
                  <article key={block.id} className="user-bubble">
                    <Markdown text={block.text} />
                  </article>
                ))}
              </div>
            ) : null}

            <div className="turn-stream">
              {live ? (
                <div
                  className={`turn-tick ${phase === "received" ? "live" : "done"}`}
                  data-testid="turn-activity"
                >
                  {phase === "received" ? <span className="spinner" /> : <span className="tick-ok">✓</span>}
                  {t(locale, "received")}
                </div>
              ) : null}

              {live && phase === "thinking" && !hasThought ? (
                <ThoughtBlock
                  block={{ id: "pending-thought", kind: "thought", text: "", streaming: true }}
                  locale={locale}
                  live
                />
              ) : null}

              {groupGrok(turn.grok).map((item) => {
                if (item.type === "fold") {
                  return <ToolFold key={item.blocks[0].id} blocks={item.blocks} locale={locale} />;
                }
                const block = item.block;
                if (block.kind === "thought") {
                  return (
                    <ThoughtBlock
                      key={block.id}
                      block={block}
                      locale={locale}
                      live={live && !!block.streaming}
                    />
                  );
                }
                if (block.kind === "tool") {
                  return <ToolBlock key={block.id} block={block} locale={locale} />;
                }
                return (
                  <AssistantBlock
                    key={block.id}
                    block={block}
                    locale={locale}
                    live={live && !!block.streaming}
                  />
                );
              })}

              {live && phase === "responding" && !hasAssistant ? (
                <AssistantBlock
                  block={{ id: "pending-response", kind: "assistant", text: "", streaming: true }}
                  locale={locale}
                  live
                />
              ) : null}

              {live ? <RunningFooter blocks={turn.grok} locale={locale} /> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ThoughtBlock({
  block,
  locale,
  live,
}: {
  block: ChatBlock;
  locale: Locale;
  live: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expanded = live || open;
  return (
    <div className={`thought-block${live ? " live" : ""}`} data-testid="thought-block">
      <div className="thought-accent" />
      <div className="thought-main">
        <button
          type="button"
          className="thought-head"
          onClick={() => {
            if (!live) setOpen((value) => !value);
          }}
        >
          <span className="tool-bullet">◆</span>
          {live ? (
            <span className="spinner" />
          ) : (
            <span className="thought-chevron">{expanded ? "▾" : "▸"}</span>
          )}
          {live
            ? t(locale, "thinking")
            : block.durationMs
              ? t(locale, "thoughtFor").replace("{time}", formatDuration(block.durationMs))
              : t(locale, "thoughtDone")}
        </button>
        {expanded ? (
          <div className="thought-text">
            {block.text ? <Markdown text={block.text} streaming={live} /> : null}
            {live && !block.text ? <span className="stream-caret" aria-hidden /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AssistantBlock({
  block,
  locale,
  live,
}: {
  block: ChatBlock;
  locale: Locale;
  live: boolean;
}) {
  return (
    <div className={`assistant-block${live ? " live" : ""}`} data-testid="assistant-block">
      {live ? (
        <div className="response-head">
          <span className="spinner" />
          {t(locale, "responding")}
        </div>
      ) : null}
      {block.text ? (
        <Markdown text={block.text} streaming={live} />
      ) : live ? (
        <span className="stream-caret" aria-hidden />
      ) : null}
    </div>
  );
}

function ToolFold({ blocks, locale }: { blocks: ChatBlock[]; locale: Locale }) {
  const [open, setOpen] = useState(false);
  const running = blocks.some((block) => isToolRunning(block.status));
  return (
    <div className={`tool-fold${running ? " live" : ""}`} data-testid="tool-fold">
      <button type="button" className="tool-head" onClick={() => setOpen((value) => !value)}>
        <span className="tool-bullet">◆</span>
        {running ? <span className="spinner" data-testid="tool-spinner" /> : null}
        <span className="thought-chevron">{open ? "▾" : "▸"}</span>
        <span className="tool-title">{summarizeTools(blocks, locale)}</span>
      </button>
      {open
        ? blocks.map((block) => <ToolBlock key={block.id} block={block} locale={locale} nested />)
        : null}
    </div>
  );
}

function ToolBlock({
  block,
  nested = false,
}: {
  block: ChatBlock;
  locale: Locale;
  nested?: boolean;
}) {
  const running = isToolRunning(block.status);
  const failed = isToolFailed(block.status);
  const diffs = block.diffs || [];
  const verb = classifyTool(block);
  const isEdit = verb === "edit";
  const [open, setOpen] = useState(isEdit);
  const expanded = running || open;
  const hasBody = diffs.length > 0 || Boolean(block.text && block.text !== block.title);
  const stat = isEdit && diffs.length ? ` ${diffStat(diffs)}` : "";
  return (
    <div className={`tool-block${running ? " live" : ""}`} data-testid="tool-block">
      <button
        type="button"
        className="tool-head"
        onClick={() => {
          if (hasBody) setOpen((value) => !value);
        }}
      >
        {nested ? <span className="tool-nested">›</span> : <span className="tool-bullet">◆</span>}
        {running ? <span className="spinner" data-testid="tool-spinner" /> : null}
        {hasBody ? <span className="thought-chevron">{expanded ? "▾" : "▸"}</span> : null}
        <span className="tool-title">
          {displayToolTitle(block)}
          {stat}
        </span>
        {failed ? <span className="tool-status">{block.status}</span> : null}
      </button>
      {expanded && hasBody ? (
        diffs.length
          ? diffs.map((diff) => <InlineEdit key={diff.path} diff={diff} />)
          : <pre className="tool-text">{block.text}</pre>
      ) : null}
    </div>
  );
}

function InlineEdit({ diff }: { diff: FileDiff }) {
  const rows = toEditRows(diff);
  if (rows.length === 0) return null;
  return (
    <div className="edit-diff" data-testid="edit-diff">
      <pre className="edit-diff-body">
        {rows.map((row, i) =>
          row.text === "···" && row.line === null ? (
            <div key={`gap-${i}`} className="edit-gap">···</div>
          ) : (
            <div key={`${i}-${row.type}-${row.line ?? "x"}`} className={`edit-line ${row.type}`}>
              <span className="edit-ln">{row.line ?? ""}</span>
              <span className="edit-src">{row.text || " "}</span>
            </div>
          ),
        )}
      </pre>
    </div>
  );
}

export function isToolRunning(status?: string) {
  const value = (status || "").toLowerCase().replace(/-/g, "_");
  return value === "pending" || value === "in_progress" || value === "inprogress";
}

export function isToolFailed(status?: string) {
  const value = (status || "").toLowerCase();
  return value === "failed" || value === "error" || value === "cancelled" || value === "canceled";
}

function groupGrok(blocks: ChatBlock[]) {
  const items: Array<{ type: "fold"; blocks: ChatBlock[] } | { type: "one"; block: ChatBlock }> = [];
  let fold: ChatBlock[] = [];
  const flush = () => {
    if (fold.length >= 2) items.push({ type: "fold", blocks: fold });
    else if (fold.length === 1) items.push({ type: "one", block: fold[0] });
    fold = [];
  };
  for (const block of blocks) {
    if (isGroupableTool(block)) {
      fold.push(block);
    } else {
      flush();
      items.push({ type: "one", block });
    }
  }
  flush();
  return items;
}

function diffStat(diffs: FileDiff[]) {
  let add = 0;
  let del = 0;
  for (const diff of diffs) {
    for (const row of toEditRows(diff)) {
      if (row.type === "add") add += 1;
      if (row.type === "del") del += 1;
    }
  }
  return `+${add}/-${del}`;
}

function RunningFooter({ blocks, locale }: { blocks: ChatBlock[]; locale: Locale }) {
  const running = blocks.filter((block) => block.kind === "tool" && isToolRunning(block.status)).length;
  if (!running) return null;
  return (
    <div className="turn-tick live" data-testid="running-count">
      ◆ {t(locale, "runningCount").replace("{count}", String(running))}
    </div>
  );
}

function groupTurns(blocks: ChatBlock[]): Turn[] {
  const turns: Turn[] = [];
  for (const block of blocks) {
    if (block.kind === "user") {
      const last = turns[turns.length - 1];
      if (last && last.grok.length === 0) {
        last.user.push(block);
      } else {
        turns.push({ id: block.id, user: [block], grok: [] });
      }
    } else {
      const last = turns[turns.length - 1];
      if (last) {
        last.grok.push(block);
      } else {
        turns.push({ id: block.id, user: [], grok: [block] });
      }
    }
  }
  return turns;
}
