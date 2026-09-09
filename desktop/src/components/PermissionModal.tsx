import { useEffect, useRef } from "react";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import type { PermissionRequest } from "../types";

export function PermissionModal({
  locale,
  request,
  onChoose,
}: {
  locale: Locale;
  request: PermissionRequest;
  onChoose: (optionId: string, always: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const allowOnce = pick(request.options, ["allow_once", "allow-once", "allowOnce"]);
  const allowAlways = pick(request.options, ["allow_always", "allow-always", "allowAlways"]);
  const reject = pick(request.options, ["reject_once", "reject-once", "reject", "rejectAlways", "reject_always"]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    const focusable = () =>
      [...(root?.querySelectorAll<HTMLElement>("button:not([disabled])") || [])];
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onChoose(reject?.optionId || "", false);
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const nodes = focusable();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-title"
        aria-describedby="permission-body"
        ref={dialogRef}
      >
        <h3 id="permission-title">{request.title || t(locale, "permissionTitle")}</h3>
        <p id="permission-body">{request.description || t(locale, "permissionBody")}</p>
        <div className="actions">
          <button className="btn danger" onClick={() => onChoose(reject?.optionId || "", false)}>
            {t(locale, "reject")}
          </button>
          <button
            className="btn"
            disabled={!allowAlways && !allowOnce}
            onClick={() => onChoose((allowAlways || allowOnce)?.optionId || "", true)}
          >
            {t(locale, "allowAlways")}
          </button>
          <button
            className="btn primary"
            disabled={!allowOnce && !request.options[0]?.optionId}
            onClick={() => onChoose(allowOnce?.optionId || allowAlways?.optionId || "", false)}
          >
            {t(locale, "allowOnce")}
          </button>
        </div>
      </div>
    </div>
  );
}

function pick(
  options: PermissionRequest["options"],
  kinds: string[],
) {
  return options.find((o) => kinds.includes(o.kind || "") || kinds.includes(o.optionId));
}
