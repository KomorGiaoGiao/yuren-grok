import type { Page } from "@playwright/test";

export async function installTauriMocks(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("grok-desktop-locale", "zh-CN");
    localStorage.removeItem("grok-desktop-collapsed-projects");

    const callbacks = new Map<number, (data: unknown) => void>();

    const replies: Record<string, unknown> = {
      grok_status: {
        found: true,
        path: "/tmp/grok",
        version: "grok 1.0.13",
        browserAuth: false,
      },
      get_settings: {
        grokHome: "/tmp/.grok",
        baseUrl: "https://api.x.ai/v1",
        model: "grok-4.6",
        reasoningEffort: "high",
        apiKeyConfigured: true,
        apiKeyPreview: "••••abcd",
        browserAuth: false,
        lastProjectDir: "",
      },
      list_sessions: [
        {
          id: "01visual-session",
          title: "Fix login flow",
          cwd: "/Users/demo/app",
          model: "grok-4.6",
          updatedAt: "2026-09-08T10:00:00Z",
          createdAt: "2026-09-08T09:00:00Z",
          messageCount: 4,
          lastTurn: "patched auth",
        },
        {
          id: "01visual-session-2",
          title: "Reset password",
          cwd: "/Users/demo/app",
          model: "grok-4.6",
          updatedAt: "2026-09-08T09:30:00Z",
          createdAt: "2026-09-08T09:10:00Z",
          messageCount: 2,
          lastTurn: "reset token",
        },
        {
          id: "01visual-docker",
          title: "Docker 出口 IP",
          cwd: "/Users/demo/Claude Docker",
          model: "grok-4.6",
          updatedAt: "2026-09-07T18:00:00Z",
          createdAt: "2026-09-07T17:00:00Z",
          messageCount: 3,
          lastTurn: "proxy setup",
        },
      ],
      list_models: {
        models: ["grok-4.6", "grok-4.5"],
        defaultModel: "grok-4.6",
        reasoningEffort: "high",
        efforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
      },
      default_workspace_preview: "/Users/demo/Documents/grokDesktop/project/untitled-1",
      start_session: { sessionId: "01visual-session", grokPath: "/tmp/grok" },
      load_history: [
        { role: "user", text: "看一下 src/auth.ts 的登录逻辑" },
        {
          role: "thought",
          text: "用户想检查登录流程。我先读 auth 文件，再给出修改建议。",
        },
        { role: "tool", title: "read_file", text: "src/auth.ts" },
        { role: "tool", title: "run_terminal_command", text: "rg login src/auth.ts" },
        {
          role: "tool",
          title: "Edit src/auth.ts",
          text: "@@ -1,4 +1,7 @@\n export function login(user: string) {\n+  if (!user) throw new Error(\"missing user\");\n   return issueToken(user);\n }\n",
        },
        {
          role: "tool",
          title: "Edit tests/visual/layout.spec.ts",
          text: "",
          diffs: [
            {
              path: "tests/visual/layout.spec.ts",
              oldText: [
                '  await expect(transcript.locator(".bubble")).toHaveCount(0);',
                '  await expect(page.getByTestId("tool-block")).toHaveCount(2);',
                '  await expect(page.locator(".spinner")).toHaveCount(0);',
              ].join("\n"),
              newText: [
                '  await expect(transcript.locator(".bubble")).toHaveCount(0);',
                '  await expect(page.getByTestId("edit-diff")).toBeVisible();',
                '  await expect(page.getByText(\'if (!user) throw new Error("missing user");\')).toBeVisible();',
                '  await expect(page.getByTestId("tool-block")).toHaveCount(3);',
                '  await expect(page.locator(".spinner")).toHaveCount(0);',
              ].join("\n"),
            },
          ],
        },
        {
          role: "assistant",
          text: "登录校验漏了 token 过期检查。\n\n```ts\nexport function login(user: string) {\n  return issueToken(user);\n}\n```\n\n补上过期判断即可。",
        },
      ],
      list_skills: [
        {
          name: "ponytail",
          description: "Prefer the simplest solution that works.",
          path: "/tmp/skills/ponytail/SKILL.md",
          source: "user",
          enabled: true,
        },
      ],
      list_plugins: {
        installed: [],
        available: [],
        marketplaces: [
          { name: "claude-plugins-official", source: "https://github.com/anthropics/claude-plugins-official.git" },
        ],
      },
      save_settings: {
        grokHome: "/tmp/.grok",
        baseUrl: "https://api.x.ai/v1",
        model: "grok-4.6",
        reasoningEffort: "high",
        apiKeyConfigured: true,
        apiKeyPreview: "••••abcd",
        browserAuth: false,
        lastProjectDir: "",
      },
      stop_session: null,
      login_browser: "started",
      logout_browser: null,
    };

    (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd.startsWith("plugin:event|")) return 1;
        if (cmd in replies) return replies[cmd];
        return null;
      },
      transformCallback: (callback: (data: unknown) => void) => {
        const id = Math.floor(Math.random() * 1_000_000);
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: (id: number) => {
        callbacks.delete(id);
      },
      convertFileSrc: (path: string) => path,
      metadata: { currentWindow: { label: "main" } },
    };
  });
}

export async function assertNoOverflow(page: import("@playwright/test").Page) {
  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const app = document.querySelector("[data-testid=app]") as HTMLElement | null;
    const sidebar = document.querySelector("[data-testid=sidebar]") as HTMLElement | null;
    const main = document.querySelector("[data-testid=main]") as HTMLElement | null;
    const composer = document.querySelector("[data-testid=composer]") as HTMLElement | null;
    const box = (el: HTMLElement | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      app: box(app),
      sidebar: box(sidebar),
      main: box(main),
      composer: box(composer),
    };
  });

  if (metrics.scrollWidth > metrics.clientWidth + 1) {
    throw new Error(`Horizontal overflow: scrollWidth ${metrics.scrollWidth} > ${metrics.clientWidth}`);
  }
  if (!metrics.sidebar || !metrics.main) {
    throw new Error("Missing layout regions");
  }
  if (metrics.sidebar.right > metrics.main.left + 2) {
    throw new Error("Sidebar overlaps main");
  }
  if (metrics.composer) {
    if (metrics.composer.bottom > metrics.innerHeight + 2) {
      throw new Error("Composer overflows viewport");
    }
    if (metrics.composer.left < metrics.main.left - 2) {
      throw new Error("Composer is not inside main");
    }
  }
  return metrics;
}
