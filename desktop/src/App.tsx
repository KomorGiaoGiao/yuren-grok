import { FormEvent, type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, listenAgent, listenFileDrop } from "./api";
import { ChatTranscript, isToolRunning } from "./components/ChatTranscript";
import { DiffPanel } from "./components/DiffPanel";
import {
  IconArchive,
  IconCompose,
  IconCopy,
  IconEye,
  IconFolder,
  IconGear,
  IconHand,
  IconPin,
  IconPlugin,
  IconPlus,
  IconSearch,
  IconSend,
  IconSidebar,
  IconSpark,
  IconStop,
} from "./components/Icons";
import { PermissionModal } from "./components/PermissionModal";
import { SearchPalette } from "./components/SearchPalette";
import { detectLocale, t, type Locale } from "./i18n";
import {
  findCommand,
  GROK_COMMANDS,
  parseSlash,
  type AgentCommand,
  type GrokCommand,
} from "./lib/commands";
import { diffsFromToolText, extractDiffs } from "./lib/diff";
import { betterTitle, formatDuration, formatToolTitle, grokToolInfo } from "./lib/tools";
import type {
  AgentUpdate,
  AppSettings,
  ChatBlock,
  FileDiff,
  GrokStatus,
  ModelCatalog,
  Page,
  PermissionRequest,
  PluginSnapshot,
  SessionSummary,
  SkillInfo,
  TurnPhase,
} from "./types";
import "./App.css";

export default function App() {
  const [locale, setLocale] = useState<Locale>(detectLocale);
  const [page, setPage] = useState<Page>("chat");
  const [status, setStatus] = useState<GrokStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [projectDir, setProjectDir] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<ChatBlock[]>([]);
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [turnPhase, setTurnPhase] = useState<TurnPhase>("idle");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [alwaysAllow, setAlwaysAllow] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [plugins, setPlugins] = useState<PluginSnapshot | null>(null);
  const [pluginsError, setPluginsError] = useState("");
  const [followBottom, setFollowBottom] = useState(true);
  const [lastFailed, setLastFailed] = useState("");
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [activeDiff, setActiveDiff] = useState<string | null>(null);
  const [model, setModel] = useState("grok-4.6");
  const [effort, setEffort] = useState("high");
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);

  const [agentCommands, setAgentCommands] = useState<AgentCommand[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem("grok-desktop-sidebar") !== "0",
  );
  const [projectDirs, setProjectDirs] = useState<string[]>(() => readProjectDirs());
  const [sessionMeta, setSessionMeta] = useState<Record<string, SessionMeta>>(() => readSessionMeta());
  const [sessionMenu, setSessionMenu] = useState<{ session: SessionSummary; x: number; y: number } | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  const composerBoxRef = useRef<HTMLDivElement>(null);
  const dragOverRef = useRef(false);
  const alwaysAllowRef = useRef(false);
  const applyUpdateRef = useRef<(update: AgentUpdate) => void>(() => {});
  const ignoreTranscriptRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const sendLockRef = useRef(false);
  const connectRef = useRef<Promise<string | null> | null>(null);
  const followBottomRef = useRef(true);

  const projectGroups = useMemo(() => {
    const visible = sessions.filter((session) => !sessionMeta[session.id]?.archived);
    return groupByProject(visible, projectDirs).map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => Number(!!sessionMeta[b.id]?.pinned) - Number(!!sessionMeta[a.id]?.pinned)),
    }));
  }, [sessions, projectDirs, sessionMeta]);
  const archivedSessions = useMemo(
    () => sessions.filter((session) => sessionMeta[session.id]?.archived),
    [sessions, sessionMeta],
  );
  const searchSessions = useMemo(
    () =>
      sessions
        .filter((session) => !sessionMeta[session.id]?.archived)
        .map((session) => ({
          ...session,
          title: sessionMeta[session.id]?.title || session.title || session.id.slice(0, 8),
        })),
    [sessions, sessionMeta],
  );

  useEffect(() => {
    alwaysAllowRef.current = alwaysAllow;
  }, [alwaysAllow]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    localStorage.setItem("grok-desktop-locale", locale);
  }, [locale]);

  useEffect(() => {
    localStorage.setItem("grok-desktop-sidebar", sidebarOpen ? "1" : "0");
  }, [sidebarOpen]);

  useEffect(() => {
    localStorage.setItem("grok-desktop-projects", JSON.stringify(projectDirs));
  }, [projectDirs]);

  useEffect(() => {
    localStorage.setItem("grok-desktop-session-meta", JSON.stringify(sessionMeta));
  }, [sessionMeta]);

  useEffect(() => {
    if (!sessionMenu) return;
    const close = (event: Event) => {
      if ((event.target as HTMLElement | null)?.closest(".ctx-menu")) return;
      setSessionMenu(null);
    };
    const timer = window.setTimeout(() => {
      window.addEventListener("click", close);
      window.addEventListener("contextmenu", close);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [sessionMenu]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!plusOpen) return;
    const onDown = (event: globalThis.MouseEvent) => {
      if (!plusRef.current?.contains(event.target as Node)) setPlusOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [plusOpen]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listenFileDrop(setFileHover, addAttachments)
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {});

    const isFileDrag = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types || []).some((type) => type === "Files" || type === "text/uri-list");

    const onEnter = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      setFileHover(true);
    };
    const onOver = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setFileHover(true);
    };
    const onLeave = (event: DragEvent) => {
      if (event.relatedTarget && document.documentElement.contains(event.relatedTarget as Node)) return;
      setFileHover(false);
    };
    const onDrop = (event: DragEvent) => {
      const paths = pathsFromDataTransfer(event.dataTransfer);
      if (!paths.length && !isFileDrag(event)) return;
      event.preventDefault();
      setFileHover(false);
      if (paths.length) addAttachments(paths);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      cancelled = true;
      void Promise.resolve(unlisten?.()).catch(() => {});
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      dragOverRef.current = false;
    };
  }, []);

  useEffect(() => {
    void bootstrap();
    let cancelled = false;
    let unlisten: (() => void)[] = [];
    listenAgent(
      (update) => applyUpdateRef.current(update),
      (payload) => onPermission(payload),
      () => {},
      (payload) => onAgentExit(payload),
    ).then((fns) => {
      if (cancelled) {
        fns.forEach((fn) => fn());
        return;
      }
      unlisten = fns;
    });
    return () => {
      cancelled = true;
      unlisten.forEach((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!followBottomRef.current) return;
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [blocks, busy, turnPhase]);

  useEffect(() => {
    if (turnPhase !== "received") return;
    const timer = window.setTimeout(() => {
      setTurnPhase((phase) => (phase === "received" ? "thinking" : phase));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [turnPhase]);

  async function bootstrap() {
    try {
      const [st, cfg, list, models] = await Promise.all([
        api.grokStatus(),
        api.getSettings(),
        api.listSessions(),
        api.listModels().catch(() => ({
          models: ["grok-4.6", "grok-4.5"],
          defaultModel: "grok-4.6",
          reasoningEffort: "high",
          efforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
        })),
      ]);
      setStatus(st);
      setSettings(cfg);
      setSessions(list);
      if (cfg.lastProjectDir) rememberProject(cfg.lastProjectDir);
      setCatalog(models);
      setModel(cfg.model || models.defaultModel || "grok-4.6");
      setEffort(cfg.reasoningEffort || models.reasoningEffort || "high");
      setSkills(await api.listSkills(cfg.lastProjectDir || undefined));
    } catch (e) {
      setError(String(e));
    }
  }

  function applyUpdate(raw: AgentUpdate) {
    const sid = raw.sessionId;
    const current = sessionIdRef.current;
    if (sid && sid !== current) return;
    const update = unwrapUpdate(raw);
    const kind = update.sessionUpdate || "";
    if (ignoreTranscriptRef.current && isTranscriptReplay(kind)) {
      return;
    }
    const text = contentText(update.content);
    if (kind === "agent_message_chunk" && text) {
      setTurnPhase("responding");
      setBlocks((prev) => appendChunk(prev, "assistant", text));
    } else if (kind === "agent_thought_chunk" && text) {
      setTurnPhase("thinking");
      setBlocks((prev) => appendChunk(prev, "thought", text, t(locale, "thinking")));
    } else if (kind === "tool_call" || kind === "tool_call_update") {
      setTurnPhase("tool");
      const found = extractDiffs(update.content);
      if (found.length) {
        setDiffs((prev) => mergeDiffs(prev, found));
        setActiveDiff((current) => current || found[0].path);
      }
      const info = grokToolInfo(update);
      const title = formatToolTitle({
        ...info,
        path: info.path || found[0]?.path || "",
      });
      setBlocks((prev) =>
        upsertTool(
          prev,
          update.toolCallId || title,
          title,
          update.status || "",
          text,
          found,
          info.kind,
          info.description,
        ),
      );
    } else if (kind === "task_backgrounded") {
      const rec = update as AgentUpdate & { task_id?: string; tool_call_id?: string };
      const id = rec.task_id || rec.taskId || rec.tool_call_id || uid();
      const desc = rec.description || "";
      setTurnPhase("tool");
      setBlocks((prev) =>
        upsertTool(
          prev,
          id,
          `Task started: ${desc || "background"}`,
          "in_progress",
          rec.command || "",
          [],
          "execute",
          desc,
        ),
      );
    } else if (kind === "task_completed") {
      const rec = update as AgentUpdate;
      const snap = rec.task_snapshot || rec.taskSnapshot || {};
      const id = snap.task_id || rec.task_id || rec.taskId || "";
      const desc = snap.description || rec.description || "";
      const exit = snap.exit_code;
      const signal = snap.signal;
      const start = (snap.start_time?.secs_since_epoch || 0) * 1000;
      const end = (snap.end_time?.secs_since_epoch || 0) * 1000;
      const time = start && end ? formatDuration(end - start) : "";
      let title = time ? `Task completed in ${time}: ${desc}` : `Task completed: ${desc}`;
      let status = "completed";
      if (exit && exit !== 0) {
        title = time
          ? `Task failed in ${time}: ${desc} (exit ${exit})`
          : `Task failed: ${desc} (exit ${exit})`;
        status = "failed";
      } else if (signal) {
        title = time
          ? `Task failed in ${time}: ${desc} (signal ${signal})`
          : `Task failed: ${desc} (signal ${signal})`;
        status = "failed";
      }
      setBlocks((prev) =>
        upsertTool(prev, id || title, title, status, snap.output || snap.command || "", [], "execute", desc),
      );
    } else if (kind === "available_commands_update" && update.availableCommands) {
      setAgentCommands(update.availableCommands);
    } else if (kind === "plan" && update.entries?.length) {
      const planText = update.entries
        .map((entry) => `- [${entry.status || "pending"}] ${entry.content || ""}`)
        .join("\n");
      setBlocks((prev) => [...prev, { id: uid(), kind: "thought", title: "/plan", text: planText }]);
    }
  }

  applyUpdateRef.current = applyUpdate;

  function onAgentExit(payload: unknown) {
    const rec = payload as { reason?: string };
    setPermission(null);
    finishTurn();
    setError(rec?.reason ? `${t(locale, "agentExited")} (${rec.reason})` : t(locale, "agentExited"));
  }

  function onPermission(payload: unknown) {
    const data = payload as {
      rpcId: unknown;
      params?: {
        title?: string;
        description?: string;
        options?: PermissionRequest["options"];
        toolCall?: { title?: string };
      };
    };
    const options = data.params?.options || [];
    const request: PermissionRequest = {
      rpcId: data.rpcId,
      title: data.params?.title || data.params?.toolCall?.title || t(locale, "permissionTitle"),
      description: data.params?.description || "",
      options,
    };
    if (alwaysAllowRef.current) {
      const allow =
        options.find((o) => (o.kind || "").includes("allow"))?.optionId ||
        options[0]?.optionId;
      if (allow) {
        void api.respondPermission(data.rpcId, allow);
        return;
      }
    }
    setPermission(request);
  }

  function rememberProject(dir: string) {
    if (!dir) return;
    setProjectDirs((prev) => (prev.includes(dir) ? prev : [dir, ...prev]));
  }

  async function chooseFolder() {
    const dir = await api.pickFolder();
    if (!dir) return;
    setProjectDir(dir);
    rememberProject(dir);
    await api.saveSettings({ lastProjectDir: dir });
    setSettings(await api.getSettings());
  }

  async function startNewSession() {
    generationRef.current += 1;
    sessionIdRef.current = null;
    setError("");
    setLastFailed("");
    setPermission(null);
    setSessionId(null);
    setBlocks([]);
    setDiffs([]);
    setActiveDiff(null);
    setHistoryTruncated(false);
    setTurnPhase("idle");
    setBusy(false);
    setConnecting(false);
    setAlwaysAllow(false);
    setAttachments([]);
    setPage("chat");
    try {
      await api.stopSession();
    } catch {
      /* agent may not be running yet */
    }
  }

  async function connectSession(dir?: string, clearChat = true): Promise<string | null> {
    if (connectRef.current) return connectRef.current;
    const run = (async () => {
      setError("");
      setConnecting(true);
      setAlwaysAllow(false);
      const gen = generationRef.current;
      try {
        const cwd = await api.prepareWorkspace(dir || projectDir || null);
        if (gen !== generationRef.current) return null;
        setProjectDir(cwd);
        rememberProject(cwd);
        await api.saveSettings({ lastProjectDir: cwd });
        const result = await api.startSession(cwd, undefined, model, effort);
        if (gen !== generationRef.current) return null;
        sessionIdRef.current = result.sessionId;
        setSessionId(result.sessionId);
        if (clearChat) {
          setBlocks([]);
          setDiffs([]);
          setActiveDiff(null);
          setHistoryTruncated(false);
          setTurnPhase("idle");
          setAttachments([]);
        }
        setPage("chat");
        setSessions(await api.listSessions());
        return result.sessionId;
      } catch (e) {
        setError(String(e));
        return null;
      } finally {
        setConnecting(false);
      }
    })();
    connectRef.current = run;
    try {
      return await run;
    } finally {
      if (connectRef.current === run) connectRef.current = null;
    }
  }

  function patchMeta(id: string, patch: Partial<SessionMeta>) {
    setSessionMeta((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function sessionLabel(session: SessionSummary) {
    return sessionMeta[session.id]?.title || session.title || session.id.slice(0, 8);
  }

  async function openSession(session: SessionSummary) {
    const gen = ++generationRef.current;
    sessionIdRef.current = session.id;
    setError("");
    setLastFailed("");
    setPermission(null);
    setPage("chat");
    setProjectDir(session.cwd);
    rememberProject(session.cwd);
    patchMeta(session.id, { unread: false });
    setConnecting(true);
    try {
      const history = await api.loadHistory(session.id);
      if (gen !== generationRef.current) return;
      setHistoryTruncated(history.filter((m) => m.role === "user").length >= 20);
      setBlocks(
        history.map((m, i) => {
          const kind: ChatBlock["kind"] =
            m.role === "user"
              ? "user"
              : m.role === "thought"
                ? "thought"
                : m.role === "tool"
                  ? "tool"
                  : "assistant";
          return {
            id: m.toolCallId ? `tool-${m.toolCallId}` : `h-${i}`,
            kind,
            text: m.text,
            title: m.title,
            toolKind: m.toolKind,
            status: kind === "tool" ? "completed" : undefined,
            diffs:
              kind === "tool"
                ? (m.diffs && m.diffs.length ? m.diffs : diffsFromToolText(m.title, m.text))
                : undefined,
          };
        }),
      );
      setDiffs([]);
      setActiveDiff(null);
      setTurnPhase("idle");
      setBusy(false);
      const result = await resumeSession(session.cwd, session.id);
      if (gen !== generationRef.current) return;
      sessionIdRef.current = result.sessionId;
      setSessionId(result.sessionId);
    } catch (e) {
      if (gen === generationRef.current) setError(String(e));
    } finally {
      if (gen === generationRef.current) setConnecting(false);
    }
  }

  async function sendToAgent(text: string): Promise<boolean> {
    let active = sessionIdRef.current || sessionId;
    if (!active) {
      active = await connectSession(projectDir, false);
    }
    if (!active) return false;
    const userId = uid();
    setBlocks((prev) => [
      ...prev.map((block) => (block.streaming ? { ...block, streaming: false } : block)),
      { id: userId, kind: "user", text },
    ]);
    setTurnPhase("received");
    setBusy(true);
    try {
      await api.sendPrompt(active, text);
      setLastFailed("");
      setSessions(await api.listSessions());
      return true;
    } catch (e) {
      setError(String(e));
      setLastFailed(text);
      setBlocks((prev) => prev.filter((block) => block.id !== userId));
      return false;
    } finally {
      finishTurn();
    }
  }

  function runLocalCommand(name: string) {
    if (name === "new" || name === "clear") {
      void startNewSession();
      return;
    }
    if (name === "settings") {
      setPage("settings");
      return;
    }
    if (name === "skills") {
      setPage("skills");
      return;
    }
    if (name === "plugins") {
      setPage("plugins");
      return;
    }
  }

  function setFileHover(over: boolean) {
    if (dragOverRef.current === over) return;
    dragOverRef.current = over;
    setDragOver(over);
  }

  function addAttachments(paths: string[]) {
    if (!paths.length) return;
    setPage("chat");
    setAttachments((prev) => mergeAttachments(prev, paths));
  }

  async function onSend(event?: FormEvent) {
    event?.preventDefault();
    if (sendLockRef.current || busy || connecting) return;
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    if (text) {
      const slash = parseSlash(text);
      if (slash) {
        const cmd = findCommand(slash.name);
        if (cmd?.kind === "local" && !slash.rest) {
          setDraft("");
          runLocalCommand(cmd.name);
          return;
        }
      }
    }
    const refs = attachments.map((item) => `@${quotePath(item.path)}`).join(" ");
    const payload = [refs, text].filter(Boolean).join("\n");
    const previousDraft = text;
    const previousAttachments = attachments;
    sendLockRef.current = true;
    setDraft("");
    setAttachments([]);
    try {
      const ok = await sendToAgent(payload);
      if (!ok) {
        setDraft((current) => current || previousDraft);
        setAttachments((current) => (current.length ? current : previousAttachments));
      }
    } finally {
      sendLockRef.current = false;
    }
  }

  function pickGrokCommand(cmd: GrokCommand) {
    if (cmd.hint) {
      setDraft(`/${cmd.name} `);
      return;
    }
    if (cmd.kind === "local") {
      setDraft("");
      runLocalCommand(cmd.name);
      return;
    }
    setDraft("");
    void sendToAgent(`/${cmd.name}`);
  }

  async function onStop() {
    const active = sessionIdRef.current || sessionId;
    if (active) await api.cancelPrompt(active);
    finishTurn();
  }

  async function resumeSession(cwd: string, id: string, nextModel = model, nextEffort = effort) {
    ignoreTranscriptRef.current = true;
    try {
      return await api.startSession(cwd, id, nextModel, nextEffort);
    } finally {
      ignoreTranscriptRef.current = false;
    }
  }

  function finishTurn() {
    setBusy(false);
    setTurnPhase("idle");
    setBlocks((prev) =>
      prev.map((block) => {
        const next = stampDone(block);
        if (next.kind === "tool" && isToolRunning(next.status)) {
          return { ...next, status: "completed" };
        }
        return next;
      }),
    );
  }

  async function changeRuntime(patch: { model?: string; effort?: string }) {
    const nextModel = patch.model ?? model;
    const nextEffort = patch.effort ?? effort;
    if (patch.model) setModel(patch.model);
    if (patch.effort) setEffort(patch.effort);
    try {
      const next = await api.saveSettings({
        model: nextModel,
        reasoningEffort: nextEffort,
      });
      setSettings(next);
      if (sessionId && projectDir && !busy) {
        const result = await resumeSession(projectDir, sessionId, nextModel, nextEffort);
        setSessionId(result.sessionId);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function choosePermission(optionId: string, always: boolean) {
    if (!permission) return;
    if (!optionId) {
      setPermission(null);
      return;
    }
    if (always) setAlwaysAllow(true);
    await api.respondPermission(permission.rpcId, optionId);
    setPermission(null);
  }

  async function refreshExtras() {
    if (page === "skills") {
      try {
        setSkills(await api.listSkills(projectDir || undefined));
      } catch {
        setSkills([]);
      }
      return;
    }
    if (page === "plugins") {
      try {
        setPluginsError("");
        setPlugins(await api.listPlugins());
      } catch (e) {
        setPlugins(null);
        setPluginsError(String(e));
      }
    }
  }

  useEffect(() => {
    if (page === "skills" || page === "plugins") void refreshExtras();
  }, [page, projectDir]);

  const current = sessions.find((s) => s.id === sessionId);
  const slashQuery = draft.startsWith("/") ? draft.slice(1).split(/\s/)[0].toLowerCase() : "";
  const slashItems = slashQuery !== undefined && draft.startsWith("/")
    ? [
        ...GROK_COMMANDS.filter((cmd) => {
          const hay = `${cmd.name} ${(cmd.aliases || []).join(" ")} ${cmd.description[locale]}`.toLowerCase();
          return !slashQuery || hay.includes(slashQuery);
        }).map((cmd) => ({
          key: `cmd-${cmd.name}`,
          kind: "command" as const,
          name: cmd.name,
          description: cmd.description[locale],
          command: cmd,
        })),
        ...agentCommands
          .filter((cmd) => !GROK_COMMANDS.some((item) => item.name === cmd.name))
          .filter((cmd) => {
            const hay = `${cmd.name} ${cmd.description || ""}`.toLowerCase();
            return !slashQuery || hay.includes(slashQuery);
          })
          .map((cmd) => ({
            key: `agent-${cmd.name}`,
            kind: "command" as const,
            name: cmd.name,
            description: cmd.description || "",
            command: {
              name: cmd.name,
              kind: "agent" as const,
              group: "ext" as const,
              hint: cmd.input?.hint,
              description: {
                "zh-CN": cmd.description || cmd.name,
                "zh-TW": cmd.description || cmd.name,
                en: cmd.description || cmd.name,
              },
            },
          })),
        ...skills
          .filter((s) => s.enabled && (!slashQuery || s.name.toLowerCase().includes(slashQuery)))
          .map((skill) => ({
            key: `skill-${skill.name}`,
            kind: "skill" as const,
            name: skill.name,
            description: skill.description,
            command: null as GrokCommand | null,
          })),
      ].slice(0, 12)
    : [];

  return (
    <div className={`app ${sidebarOpen ? "" : "sidebar-collapsed"}`.trim()} data-testid="app">
      {sidebarOpen ? (
      <aside className="sidebar" data-testid="sidebar">
        <div className="side-chrome" data-tauri-drag-region onMouseDown={(e) => void dragWindow(e)}>
          <button
            type="button"
            className="icon-btn"
            data-testid="sidebar-toggle"
            title={t(locale, "toggleSidebar")}
            onClick={() => setSidebarOpen(false)}
          >
            <IconSidebar />
          </button>
        </div>
        <div className="brand">
          <button
            type="button"
            className="brand-name"
            title={status?.found ? t(locale, "grokFound") : t(locale, "grokMissing")}
            onClick={() => setPage("chat")}
          >
            Grok Desktop App
          </button>
          <button
            type="button"
            className={`icon-btn ${searchOpen ? "active" : ""}`}
            data-testid="nav-search"
            title={t(locale, "searchConversations")}
            onClick={() => setSearchOpen(true)}
          >
            <IconSearch />
          </button>
        </div>
        <nav className="side-menu">
          <button
            type="button"
            className="side-item"
            data-testid="nav-new"
            onClick={() => void startNewSession()}
          >
            <IconCompose />
            <span className="grow">{t(locale, "newSession")}</span>
            <span className="trail"><IconPlus size={16} /></span>
          </button>
          <button
            type="button"
            data-testid="nav-skills"
            className={`side-item ${page === "skills" ? "active" : ""}`}
            onClick={() => setPage("skills")}
          >
            <IconSpark />
            <span className="grow">{t(locale, "skills")}</span>
          </button>
          <button
            type="button"
            data-testid="nav-plugins"
            className={`side-item ${page === "plugins" ? "active" : ""}`}
            onClick={() => setPage("plugins")}
          >
            <IconPlugin />
            <span className="grow">{t(locale, "plugins")}</span>
          </button>
          <button
            type="button"
            data-testid="nav-settings"
            className={`side-item ${page === "settings" ? "active" : ""}`}
            onClick={() => setPage("settings")}
          >
            <IconGear />
            <span className="grow">{t(locale, "settings")}</span>
          </button>
        </nav>
        <div className="project-head">
          <span>{t(locale, "projects")}</span>
          <button
            type="button"
            className="icon-btn"
            data-testid="projects-add"
            title={t(locale, "addProject")}
            onClick={() => void chooseFolder()}
          >
            <IconPlus size={16} />
          </button>
        </div>
        <div className="session-list">
          {projectGroups.length === 0 ? (
            <div className="empty-side">{t(locale, "noSessions")}</div>
          ) : (
            projectGroups.map((group) => (
              <section className="session-group" key={group.cwd}>
                <button
                  type="button"
                  className="project-row"
                  onClick={() => setProjectDir(group.cwd)}
                >
                  <IconFolder size={16} />
                  <span>{group.name}</span>
                </button>
                {group.items.length === 0 ? (
                  <div className="empty-project">{t(locale, "noConversations")}</div>
                ) : (
                  group.items.map((session) => (
                    <button
                      key={session.id}
                      className={`session ${session.id === sessionId ? "active" : ""} ${busy && session.id === sessionId ? "running" : ""} ${sessionMeta[session.id]?.unread ? "unread" : ""}`}
                      onClick={() => void openSession(session)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setSessionMenu({ session, x: event.clientX, y: event.clientY });
                      }}
                    >
                      {busy && session.id === sessionId ? (
                        <span className="wait-spin" data-testid="session-wait" />
                      ) : sessionMeta[session.id]?.unread ? (
                        <span className="unread-dot" />
                      ) : sessionMeta[session.id]?.pinned ? (
                        <IconPin size={12} />
                      ) : null}
                      {renameId === session.id ? (
                        <input
                          className="session-rename"
                          value={renameDraft}
                          autoFocus
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onBlur={() => {
                            const next = renameDraft.trim();
                            if (next) patchMeta(session.id, { title: next });
                            setRenameId(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                            if (event.key === "Escape") setRenameId(null);
                          }}
                        />
                      ) : (
                        <span className="session-title">{sessionLabel(session)}</span>
                      )}
                    </button>
                  ))
                )}
              </section>
            ))
          )}
          {archivedSessions.length ? (
            <section className="session-group">
              <div className="project-row archived-head">{t(locale, "archived")}</div>
              {archivedSessions.map((session) => (
                <button
                  key={session.id}
                  className="session"
                  onClick={() => {
                    patchMeta(session.id, { archived: false });
                    void openSession(session);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSessionMenu({ session, x: event.clientX, y: event.clientY });
                  }}
                >
                  <IconArchive size={12} />
                  <span className="session-title">{sessionLabel(session)}</span>
                </button>
              ))}
            </section>
          ) : null}
        </div>
      </aside>
      ) : null}

      <section className="main" data-testid="main">
        <header className="topbar" data-tauri-drag-region onMouseDown={(e) => void dragWindow(e)}>
          {sidebarOpen ? null : (
            <button
              type="button"
              className="icon-btn"
              data-testid="sidebar-toggle"
              title={t(locale, "toggleSidebar")}
              onClick={() => setSidebarOpen(true)}
            >
              <IconSidebar />
            </button>
          )}
          <div className="crumb" data-tauri-drag-region onMouseDown={(e) => void dragWindow(e)}>
            <strong>
              {busy ? (
                <span className="wait-spin" data-testid="turn-wait" />
              ) : (
                <span className={`status-dot ${permission ? "wait" : sessionId ? "on" : ""}`} />
              )}
              {current ? sessionLabel(current) : t(locale, "newSession")}
            </strong>
          </div>
        </header>

        {error ? (
          <div className="banner">
            <span>{error}</span>
            {lastFailed ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  const text = lastFailed;
                  setLastFailed("");
                  setError("");
                  setDraft(text);
                }}
              >
                {t(locale, "retry")}
              </button>
            ) : null}
          </div>
        ) : null}
        {!status?.found ? <div className="banner">{t(locale, "grokMissing")}</div> : null}

        {page === "chat" ? (
          <>
            <div className={`workspace ${diffs.length ? "with-diff" : ""}`}>
              <div
                className="chat"
                ref={chatRef}
                onScroll={(event) => {
                  const el = event.currentTarget;
                  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                  followBottomRef.current = atBottom;
                  if (atBottom !== followBottom) setFollowBottom(atBottom);
                }}
              >
                {connecting ? <div className="empty-side">{t(locale, "connecting")}</div> : null}
                {blocks.length === 0 && !connecting ? (
                  <div className="hero">
                    <h2>{t(locale, "emptyChatTitle")}</h2>
                    <p>{t(locale, "emptyChatBody")}</p>
                  </div>
                ) : (
                  <ChatTranscript
                    blocks={blocks}
                    locale={locale}
                    phase={turnPhase}
                    busy={busy}
                    truncated={historyTruncated}
                  />
                )}
                {!followBottom && blocks.length ? (
                  <button
                    type="button"
                    className="jump-latest"
                    onClick={() => {
                      followBottomRef.current = true;
                      setFollowBottom(true);
                      chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
                    }}
                  >
                    {t(locale, "jumpToLatest")}
                  </button>
                ) : null}
              </div>
              <DiffPanel
                locale={locale}
                diffs={diffs}
                activePath={activeDiff}
                onSelect={setActiveDiff}
              />
            </div>
            <form className="composer" data-testid="composer" onSubmit={(e) => void onSend(e)}>
              <div className="composer-anchor" ref={plusRef}>
              {draft.startsWith("/") ? (
                <div className="slash-menu" data-testid="slash-menu">
                  {slashItems.length === 0 ? (
                    <div className="slash-item">{t(locale, "noSkillMatch")}</div>
                  ) : (
                    slashItems.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className="slash-item"
                        onClick={() => {
                          if (item.kind === "skill") {
                            setDraft(`/${item.name} `);
                            return;
                          }
                          if (item.command) pickGrokCommand(item.command);
                        }}
                      >
                        <b>
                          /{item.name}
                          <span className="tag" style={{ marginLeft: 8 }}>
                            {item.kind === "skill" ? t(locale, "skillBadge") : t(locale, "commandBadge")}
                          </span>
                        </b>
                        <span>{item.description}</span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
              {plusOpen ? (
                <div className="plus-menu" data-testid="plus-menu">
                  <div className="plus-heading">{t(locale, "addSection")}</div>
                  <button
                    type="button"
                    className="plus-item"
                    onClick={() => {
                      setPlusOpen(false);
                      void api.pickFiles().then(addAttachments).catch(() => {});
                    }}
                  >
                    <IconFolder size={16} />
                    <span>{t(locale, "addFiles")}</span>
                  </button>
                  <button
                    type="button"
                    className="plus-item"
                    onClick={() => {
                      setPlusOpen(false);
                      void api.pickFolders().then(addAttachments).catch(() => {});
                    }}
                  >
                    <IconFolder size={16} />
                    <span>{t(locale, "addFolders")}</span>
                  </button>
                  <button
                    type="button"
                    className="plus-item"
                    onClick={() => {
                      setPlusOpen(false);
                      setPage("skills");
                    }}
                  >
                    <IconSpark size={16} />
                    <span>{t(locale, "skills")}</span>
                  </button>
                  <div className="plus-heading">{t(locale, "plugins")}</div>
                  {(plugins?.installed || []).length === 0 ? (
                    <button
                      type="button"
                      className="plus-item"
                      onClick={() => {
                        setPlusOpen(false);
                        setPage("plugins");
                      }}
                    >
                      <IconPlugin size={16} />
                      <span>{t(locale, "emptyPlugins")}</span>
                    </button>
                  ) : (
                    plugins!.installed.map((plugin) => (
                      <button
                        key={plugin.name}
                        type="button"
                        className="plus-item"
                        onClick={() => {
                          setPlusOpen(false);
                          setPage("plugins");
                        }}
                      >
                        <IconPlugin size={16} />
                        <span>{plugin.name}</span>
                        <em>{plugin.description}</em>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
              <div
                className={`composer-box${dragOver ? " drop-target" : ""}`}
                data-testid="composer-box"
                ref={composerBoxRef}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setFileHover(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setFileHover(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) setFileHover(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setFileHover(false);
                  addAttachments(pathsFromDataTransfer(event.dataTransfer));
                }}
              >
                {dragOver ? (
                  <div className="drop-overlay" data-testid="drop-overlay">{t(locale, "dropToAttach")}</div>
                ) : null}
                {attachments.length ? (
                  <div className="attach-row" data-testid="attach-row">
                    {attachments.map((item) => (
                      <button
                        key={item.path}
                        type="button"
                        className={`attach-chip ${item.kind}`}
                        title={item.path}
                        onClick={() => setAttachments((prev) => prev.filter((file) => file.path !== item.path))}
                      >
                        <span className="attach-kind">{item.kind === "image" ? "IMG" : item.kind === "video" ? "VID" : "FILE"}</span>
                        <span className="attach-name">{item.name}</span>
                        <span className="attach-x" aria-label={t(locale, "removeAttachment")}>×</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t(locale, "composerPlaceholder")}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.shiftKey) return;
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    e.preventDefault();
                    if (!busy && !connecting) void onSend();
                  }}
                  onPaste={(event) => {
                    const files = event.clipboardData?.files;
                    if (!files?.length) return;
                    const paths = Array.from(files)
                      .map((file) => (file as File & { path?: string }).path)
                      .filter((path): path is string => Boolean(path));
                    if (paths.length) {
                      event.preventDefault();
                      addAttachments(paths);
                    }
                  }}
                />
                <div className="composer-bar">
                  <button
                    type="button"
                    className={`composer-icon-btn ${plusOpen ? "active" : ""}`}
                    data-testid="composer-plus"
                    title={t(locale, "addSection")}
                    onClick={() => {
                      setPlusOpen((open) => !open);
                      if (draft.startsWith("/")) setDraft("");
                      if (!plugins) void api.listPlugins().then(setPlugins).catch(() => {});
                    }}
                  >
                    <IconPlus size={16} />
                  </button>
                  <button
                    type="button"
                    className={`composer-chip ${alwaysAllow ? "on" : ""}`}
                    data-testid="composer-permission"
                    onClick={() => setAlwaysAllow((value) => !value)}
                  >
                    <IconHand size={15} />
                    {alwaysAllow ? t(locale, "allowAlways") : t(locale, "askApproval")}
                  </button>
                  <button
                    type="button"
                    className="composer-chip quiet"
                    title={projectDir || t(locale, "chooseFolderOptional")}
                    onClick={() => void chooseFolder()}
                  >
                    <IconFolder size={15} />
                    {projectDir ? folderName(projectDir) : t(locale, "chooseFolderOptional")}
                  </button>
                  <label className="composer-chip quiet">
                    <select
                      value={model}
                      disabled={busy}
                      onChange={(e) => void changeRuntime({ model: e.target.value })}
                      aria-label={t(locale, "model")}
                    >
                      {(catalog?.models || [model]).map((id) => (
                        <option key={id} value={id}>{id}</option>
                      ))}
                    </select>
                  </label>
                  <label className="composer-chip quiet">
                    <select
                      value={effort}
                      disabled={busy}
                      onChange={(e) => void changeRuntime({ effort: e.target.value })}
                      aria-label={t(locale, "effort")}
                    >
                      {(catalog?.efforts || ["low", "medium", "high", "xhigh"]).map((id) => (
                        <option key={id} value={id}>{effortLabel(locale, id)}</option>
                      ))}
                    </select>
                  </label>
                  <span className="composer-bar-spacer" />
                  {busy ? (
                    <button
                      type="button"
                      className="send-fab stop"
                      title={t(locale, "stop")}
                      onClick={() => void onStop()}
                    >
                      <IconStop size={14} />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="send-fab"
                      disabled={connecting || (!draft.trim() && attachments.length === 0)}
                      title={t(locale, "send")}
                    >
                      <IconSend size={16} />
                    </button>
                  )}
                </div>
              </div>
              </div>
            </form>
          </>
        ) : null}

        {page === "settings" && settings ? (
          <SettingsPage
            locale={locale}
            onLocaleChange={setLocale}
            settings={settings}
            status={status}
            onSaved={async (next) => {
              setSettings(next);
              setModel(next.model);
              setEffort(next.reasoningEffort);
              setStatus(await api.grokStatus());
            }}
          />
        ) : null}

        {page === "skills" ? (
          <div className="page" data-testid="skills-page">
            <h2>{t(locale, "skills")}</h2>
            <p className="lead">{t(locale, "skillsLead")}</p>
            {skills.length === 0 ? (
              <p className="lead">{t(locale, "emptySkills")}</p>
            ) : (
              <div className="list">
                {skills.map((skill) => (
                  <div className="item" key={`${skill.source}-${skill.name}`}>
                    <div>
                      <h3>
                        <span className="tag">{skill.source}</span>
                        {skill.name}
                      </h3>
                      <p>{skill.description}</p>
                    </div>
                    <div className="row">
                      <button className="btn ghost" onClick={() => void api.openPath(skill.path)}>
                        {t(locale, "openFile")}
                      </button>
                      <button
                        className="btn"
                        onClick={async () => {
                          await api.setSkillEnabled(skill.name, !skill.enabled);
                          await refreshExtras();
                        }}
                      >
                        {skill.enabled ? t(locale, "enabled") : t(locale, "disabled")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {page === "plugins" ? (
          <div className="page" data-testid="plugins-page">
            <h2>{t(locale, "plugins")}</h2>
            <p className="lead">
              {pluginsError
                ? t(locale, "pluginsLoadError")
                : (plugins?.installed || []).length
                  ? t(locale, "pluginsLeadInstalled")
                  : t(locale, "pluginsLead")}
            </p>
            {pluginsError ? (
              <div className="banner">
                <span>{pluginsError}</span>
                <button type="button" className="btn ghost" onClick={() => void refreshExtras()}>
                  {t(locale, "retry")}
                </button>
              </div>
            ) : null}
            {(plugins?.marketplaces || []).map((m) => (
              <button
                key={m.name}
                type="button"
                className="marketplace-link"
                onClick={() => m.source && void api.openPath(m.source)}
              >
                {t(locale, "marketplace")}: {m.name}
                {m.source ? ` · ${m.source}` : ""}
              </button>
            ))}
            <PluginList
              locale={locale}
              title={t(locale, "installed")}
              items={plugins?.installed || []}
              onToggle={async (name, enabled) => {
                await api.setPluginEnabled(name, enabled);
                await refreshExtras();
              }}
            />
            {(plugins?.available || []).length > 0 ? (
              <PluginList locale={locale} title={t(locale, "available")} items={plugins?.available || []} />
            ) : null}
            {!pluginsError && (plugins?.installed || []).length === 0 ? (
              <>
                <p className="lead">{t(locale, "emptyPlugins")}</p>
                <p className="lead">{t(locale, "pluginInstallHint")}</p>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      {searchOpen ? (
        <SearchPalette
          locale={locale}
          sessions={searchSessions}
          inputRef={searchRef}
          onClose={() => setSearchOpen(false)}
          onSelect={(session) => {
            setSearchOpen(false);
            void openSession(session);
          }}
        />
      ) : null}

      {sessionMenu ? (
        <div
          className="ctx-menu"
          data-testid="session-menu"
          style={{
            left: Math.min(sessionMenu.x, window.innerWidth - 240),
            top: Math.min(sessionMenu.y, window.innerHeight - 280),
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="ctx-item"
            onClick={() => {
              setRenameId(sessionMenu.session.id);
              setRenameDraft(sessionLabel(sessionMenu.session));
              setSessionMenu(null);
            }}
          >
            <IconCompose size={15} />
            {t(locale, "rename")}
          </button>
          <button
            type="button"
            className="ctx-item"
            onClick={() => {
              patchMeta(sessionMenu.session.id, { pinned: !sessionMeta[sessionMenu.session.id]?.pinned });
              setSessionMenu(null);
            }}
          >
            <IconPin size={15} />
            {sessionMeta[sessionMenu.session.id]?.pinned ? t(locale, "unpin") : t(locale, "pin")}
          </button>
          <button
            type="button"
            className="ctx-item"
            onClick={() => {
              patchMeta(sessionMenu.session.id, { unread: !sessionMeta[sessionMenu.session.id]?.unread });
              setSessionMenu(null);
            }}
          >
            <IconEye size={15} />
            {sessionMeta[sessionMenu.session.id]?.unread ? t(locale, "markRead") : t(locale, "markUnread")}
          </button>
          <button
            type="button"
            className="ctx-item"
            onClick={() => {
              patchMeta(sessionMenu.session.id, {
                archived: !sessionMeta[sessionMenu.session.id]?.archived,
              });
              setSessionMenu(null);
            }}
          >
            <IconArchive size={15} />
            {sessionMeta[sessionMenu.session.id]?.archived ? t(locale, "unarchive") : t(locale, "archive")}
          </button>
          <div className="ctx-sep" />
          <button
            type="button"
            className="ctx-item"
            onClick={() => {
              void navigator.clipboard.writeText(sessionLabel(sessionMenu.session));
              setSessionMenu(null);
            }}
          >
            <IconCopy size={15} />
            {t(locale, "copyTitle")}
          </button>
          <button
            type="button"
            className="ctx-item"
            onClick={() => {
              void navigator.clipboard.writeText(sessionMenu.session.cwd);
              setSessionMenu(null);
            }}
          >
            <IconCopy size={15} />
            {t(locale, "copyPath")}
          </button>
          <button
            type="button"
            className="ctx-item"
            onClick={() => {
              void api.openPath(sessionMenu.session.cwd);
              setSessionMenu(null);
            }}
          >
            <IconFolder size={15} />
            {t(locale, "revealFolder")}
          </button>
        </div>
      ) : null}

      {permission ? (
        <PermissionModal locale={locale} request={permission} onChoose={choosePermission} />
      ) : null}
    </div>
  );
}

function SettingsPage({
  locale,
  onLocaleChange,
  settings,
  status,
  onSaved,
}: {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  settings: AppSettings;
  status: GrokStatus | null;
  onSaved: (settings: AppSettings) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [effort, setEffort] = useState(settings.reasoningEffort || "high");
  const [apiKey, setApiKey] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setNote("");
    setSaving(true);
    try {
      const next = await api.saveSettings({
        baseUrl,
        model,
        reasoningEffort: effort,
        apiKey: apiKey.trim() ? apiKey : undefined,
      });
      setApiKey("");
      setNote(t(locale, "saved"));
      onSaved(next);
    } catch (e) {
      setNote(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function refreshAuth() {
    try {
      onSaved(await api.getSettings());
    } catch (e) {
      setNote(String(e));
    }
  }

  return (
    <div className="page" data-testid="settings-page">
      <h2>{t(locale, "settingsTitle")}</h2>
      <p className="lead">{t(locale, "settingsLead")}</p>
      <div className="card">
        <label className="field">
          <span>{t(locale, "language")}</span>
          <select value={locale} onChange={(e) => onLocaleChange(e.target.value as Locale)}>
            <option value="zh-CN">简体中文</option>
            <option value="zh-TW">繁體中文</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
      <div className="card">
        <label className="field">
          <span>{t(locale, "baseUrl")}</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.x.ai/v1" />
        </label>
        <label className="field">
          <span>{t(locale, "model")}</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label className="field">
          <span>{t(locale, "effort")}</span>
          <select value={effort} onChange={(e) => setEffort(e.target.value)}>
            {["none", "minimal", "low", "medium", "high", "xhigh", "max"].map((id) => (
              <option key={id} value={id}>{effortLabel(locale, id)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t(locale, "apiKey")}</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings.apiKeyConfigured ? settings.apiKeyPreview : ""}
          />
        </label>
        <div className="row settings-save">
          <button className="btn primary" disabled={saving} onClick={() => void save()}>{t(locale, "save")}</button>
          {note ? <span className={note === t(locale, "saved") ? "preview" : "banner-inline"}>{note}</span> : null}
          <span className="preview">
            {status?.found ? `${t(locale, "version")}: ${status.version || ""}` : t(locale, "grokMissing")}
          </span>
        </div>
      </div>
      <div className="card">
        <p className="lead">
          {settings.browserAuth ? t(locale, "browserLoggedIn") : t(locale, "browserLogin")}
        </p>
        <div className="row">
          <button
            className="btn"
            onClick={() => {
              void (async () => {
                try {
                  await api.loginBrowser();
                  for (let i = 0; i < 20; i += 1) {
                    await new Promise((resolve) => window.setTimeout(resolve, 500));
                    const next = await api.getSettings();
                    onSaved(next);
                    if (next.browserAuth) return;
                  }
                } catch (e) {
                  setNote(String(e));
                }
              })();
            }}
          >
            {t(locale, "browserLogin")}
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              void api.logoutBrowser()
                .then(() => refreshAuth())
                .catch((e) => setNote(String(e)));
            }}
          >
            {t(locale, "browserLogout")}
          </button>
        </div>
      </div>
    </div>
  );
}

function PluginList({
  locale,
  title,
  items,
  onToggle,
}: {
  locale: Locale;
  title: string;
  items: PluginSnapshot["installed"];
  onToggle?: (name: string, enabled: boolean) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="list">
      <h3 style={{ margin: "18px 0 0" }}>{title}</h3>
      {items.map((plugin) => (
        <div className="item" key={plugin.name}>
          <div>
            <h3>{plugin.name}</h3>
            <p>{plugin.description || plugin.source}</p>
          </div>
          {onToggle ? (
            <button className="btn" onClick={() => onToggle(plugin.name, !plugin.enabled)}>
              {plugin.enabled ? t(locale, "enabled") : t(locale, "disabled")}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function appendChunk(
  prev: ChatBlock[],
  kind: ChatBlock["kind"],
  text: string,
  title?: string,
): ChatBlock[] {
  const last = prev[prev.length - 1];
  const rest = prev.map((block) => (block.streaming && block.kind !== kind ? stampDone(block) : block));
  if (last && last.kind === kind) {
    return rest.map((block, i) =>
      i === rest.length - 1 ? { ...block, text: block.text + text, streaming: true, title: title ?? block.title } : block,
    );
  }
  return [...rest, { id: uid(), kind, text, title, streaming: true, startedAt: Date.now() }];
}

function stampDone(block: ChatBlock): ChatBlock {
  if (!block.streaming) return block;
  return {
    ...block,
    streaming: false,
    durationMs: block.startedAt ? Date.now() - block.startedAt : block.durationMs,
  };
}

function upsertTool(
  prev: ChatBlock[],
  id: string,
  title: string,
  status: string,
  text: string,
  diffs: FileDiff[] = [],
  toolKind?: string,
  description?: string,
): ChatBlock[] {
  const idx = prev.findIndex((b) => b.kind === "tool" && b.id === `tool-${id}`);
  if (idx >= 0) {
    return prev.map((b, i) =>
      i === idx
        ? {
            ...b,
            title: betterTitle(title, b.title),
            status: status || b.status,
            text: text ? b.text + text : b.text,
            diffs: diffs.length ? mergeDiffs(b.diffs || [], diffs) : b.diffs,
            toolKind: toolKind && toolKind !== "other" ? toolKind : b.toolKind || toolKind,
            description: description || b.description,
          }
        : b,
    );
  }
  return [
    ...prev,
    {
      id: `tool-${id}`,
      kind: "tool",
      title,
      status: status || "pending",
      text: text || title,
      diffs,
      toolKind,
      description,
    },
  ];
}

function isTranscriptReplay(kind: string) {
  return (
    kind === "agent_message_chunk" ||
    kind === "agent_thought_chunk" ||
    kind === "user_message_chunk" ||
    kind === "tool_call" ||
    kind === "tool_call_update" ||
    kind === "task_backgrounded" ||
    kind === "task_completed" ||
    kind === "plan"
  );
}

function unwrapUpdate(raw: AgentUpdate): AgentUpdate {
  if (raw.update && (raw.update.sessionUpdate || raw.update.content || raw.update.toolCallId)) {
    return raw.update;
  }
  return raw;
}

function contentText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (typeof content === "object" && content && "text" in content) {
    return String((content as { text?: string }).text || "");
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const rec = item as Record<string, unknown>;
        if (typeof rec.text === "string") return rec.text;
        if (rec.content && typeof rec.content === "object" && rec.content && "text" in rec.content) {
          return String((rec.content as { text?: string }).text || "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function mergeDiffs(prev: FileDiff[], next: FileDiff[]): FileDiff[] {
  const map = new Map(prev.map((item) => [item.path, item]));
  for (const item of next) map.set(item.path, item);
  return [...map.values()];
}

function effortLabel(locale: Locale, id: string) {
  const key = ({
    none: "effortNone",
    minimal: "effortMinimal",
    low: "effortLow",
    medium: "effortMedium",
    high: "effortHigh",
    xhigh: "effortXhigh",
    max: "effortMax",
  } as const)[id];
  return key ? t(locale, key) : id;
}

function folderName(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

async function dragWindow(event: ReactMouseEvent) {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, a, input, select, textarea, label")) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  } catch {
    /* browser / visual tests */
  }
}

type SessionMeta = { title?: string; pinned?: boolean; unread?: boolean; archived?: boolean };

function readSessionMeta(): Record<string, SessionMeta> {
  try {
    const raw = localStorage.getItem("grok-desktop-session-meta");
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readProjectDirs(): string[] {
  try {
    const raw = localStorage.getItem("grok-desktop-projects");
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

function groupByProject(sessions: SessionSummary[], extraDirs: string[]) {
  const map = new Map<string, SessionSummary[]>();
  for (const dir of extraDirs) {
    if (dir) map.set(dir, []);
  }
  for (const session of sessions) {
    const dir = session.cwd || "";
    if (!dir) continue;
    const items = map.get(dir);
    if (items) items.push(session);
    else map.set(dir, [session]);
  }
  return [...map.entries()]
    .map(([cwd, items]) => ({
      cwd,
      name: folderName(cwd),
      items: [...items].sort((a, b) => (b.createdAt || b.id).localeCompare(a.createdAt || a.id)),
    }))
    .sort((a, b) => {
      const ta = a.items.reduce((max, session) => Math.max(max, new Date(session.createdAt).getTime() || 0), 0);
      const tb = b.items.reduce((max, session) => Math.max(max, new Date(session.createdAt).getTime() || 0), 0);
      if (tb !== ta) return tb - ta;
      return a.name.localeCompare(b.name);
    });
}

type Attachment = { path: string; name: string; kind: "image" | "video" | "file" };

function fileKind(path: string): Attachment["kind"] {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "heif", "tif", "tiff", "avif"].includes(ext)) {
    return "image";
  }
  if (["mp4", "mov", "webm", "mkv", "avi", "m4v", "mpeg", "mpg"].includes(ext)) return "video";
  return "file";
}

function mergeAttachments(prev: Attachment[], paths: string[]) {
  const next = [...prev];
  for (const path of paths) {
    const clean = path.trim();
    if (!clean || next.some((item) => item.path === clean)) continue;
    next.push({
      path: clean,
      name: clean.split("/").filter(Boolean).pop() || clean,
      kind: fileKind(clean),
    });
  }
  return next;
}

function pathsFromDataTransfer(data: DataTransfer | null) {
  if (!data) return [];
  const fromFiles = Array.from(data.files)
    .map((file) => (file as File & { path?: string }).path)
    .filter((path): path is string => Boolean(path && isLikelyPath(path)));
  if (fromFiles.length) return fromFiles;
  const uri = data.getData("text/uri-list") || data.getData("text/plain");
  return uri
    .split(/\r?\n/)
    .map(fromFileUrl)
    .filter((line) => line && !line.startsWith("#") && isLikelyPath(line));
}

function fromFileUrl(line: string) {
  let value = line.trim();
  if (/^file:\/\//i.test(value)) {
    value = value.replace(/^file:\/\/(localhost)?/i, "");
    if (/^\/[A-Za-z]:[\\/]/.test(value)) value = value.slice(1);
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep raw */
    }
  }
  return value;
}

function isLikelyPath(path: string) {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

function quotePath(path: string) {
  return /[\s'"()]/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path;
}

function uid() {
  return Math.random().toString(36).slice(2);
}
