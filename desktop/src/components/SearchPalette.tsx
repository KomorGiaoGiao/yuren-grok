import { useEffect, useMemo, useState, type RefObject } from "react";
import { t, type Locale } from "../i18n";
import type { SessionSummary } from "../types";

export function SearchPalette({
  locale,
  sessions,
  onClose,
  onSelect,
  inputRef,
}: {
  locale: Locale;
  sessions: SessionSummary[];
  onClose: () => void;
  onSelect: (session: SessionSummary) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const mac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q
      ? sessions
      : sessions.filter(
          (session) =>
            (session.title || "").toLowerCase().includes(q) ||
            session.cwd.toLowerCase().includes(q) ||
            session.lastTurn.toLowerCase().includes(q),
        );
    return list.slice(0, 20);
  }, [sessions, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === "Enter" && hits[active]) {
        event.preventDefault();
        onSelect(hits[active]);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key >= "1" && event.key <= "9") {
        const index = Number(event.key) - 1;
        if (hits[index]) {
          event.preventDefault();
          onSelect(hits[index]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, hits, onClose, onSelect]);

  return (
    <div
      className="search-overlay"
      data-testid="search-overlay"
      onMouseDown={onClose}
    >
      <div
        className="search-palette"
        data-testid="search-palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="search-palette-head">{t(locale, "searchConversations")}</div>
        <input
          ref={inputRef}
          className="search-palette-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder=""
          aria-label={t(locale, "searchConversations")}
        />
        <div className="search-palette-label">{t(locale, "chat")}</div>
        <div className="search-palette-list">
          {hits.length === 0 ? (
            <div className="search-empty">{t(locale, "noConversationMatch")}</div>
          ) : (
            hits.map((session, index) => (
              <button
                key={session.id}
                type="button"
                className={`search-hit${index === active ? " active" : ""}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => onSelect(session)}
              >
                <span className="search-hit-title">{session.title || session.id.slice(0, 8)}</span>
                <span className="search-hit-meta">{folderName(session.cwd)}</span>
                {index < 9 ? (
                  <kbd>{mac ? "⌘" : "Ctrl+" }{index + 1}</kbd>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function folderName(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}
