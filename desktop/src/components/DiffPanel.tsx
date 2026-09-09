import { diffLines, fileName } from "../lib/diff";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import type { FileDiff } from "../types";

export function DiffPanel({
  locale,
  diffs,
  activePath,
  onSelect,
}: {
  locale: Locale;
  diffs: FileDiff[];
  activePath: string | null;
  onSelect: (path: string) => void;
}) {
  if (diffs.length === 0) return null;
  const current = diffs.find((d) => d.path === activePath) || diffs[0];
  const rows = current.unified
    ? current.newText.split("\n").map((text) => {
        const type = text.startsWith("+") && !text.startsWith("+++")
          ? "add"
          : text.startsWith("-") && !text.startsWith("---")
            ? "del"
            : "same";
        return { type: type as "add" | "del" | "same", text };
      })
    : diffLines(current.oldText, current.newText);

  return (
    <aside className="diff-panel">
      <div className="diff-head">
        <strong>{t(locale, "changes")}</strong>
        <span>{diffs.length}</span>
      </div>
      <div className="diff-files">
        {diffs.map((diff) => (
          <button
            key={diff.path}
            className={diff.path === current.path ? "active" : ""}
            onClick={() => onSelect(diff.path)}
            title={diff.path}
          >
            {fileName(diff.path)}
          </button>
        ))}
      </div>
      <div className="diff-path">{current.path}</div>
      <pre className="diff-body">
        {rows.map((row, i) => (
          <div key={`${i}-${row.type}`} className={`diff-line ${row.type}`}>
            <span className="gutter">{row.type === "add" ? "+" : row.type === "del" ? "-" : " "}</span>
            <span>{row.text || " "}</span>
          </div>
        ))}
      </pre>
    </aside>
  );
}
