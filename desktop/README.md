# Grok Desktop

Desktop app for the Grok coding agent. The window is a GUI. The engine is the bundled Grok binary, spoken to over ACP (`grok agent stdio`). Sessions, skills, plugins, and login stay in `~/.grok`.

## Run (development)

Needs Node 24+, Rust, and a Grok CLI once so the sidecar can be copied (`~/.grok/bin/grok` is fine). After that, `tauri dev` / `tauri build` copy it automatically.

```bash
cd project
npm install
npm run tauri dev
```

## First-run checklist

1. Open **Settings** and either paste Base URL + API key, or click **Log in with grok.com**.
2. Click **Open project** and pick a folder.
3. Start a session and ask Grok to look around.
4. When it wants to edit a file or run a command, choose **Allow once**, **Always allow**, or **Reject**.

## Packaging

`npm run tauri build` runs `scripts/bundle-grok.sh` first. The Grok binary is large (~127MB) and is not committed (`src-tauri/binaries/`). The packaged app prefers its own sidecar over a separately installed CLI.

## Layout

- Left: session history
- Center: agent thread (thinking, tools, replies)
- Settings / Skills / Plugins pages
- Languages: Simplified Chinese, Traditional Chinese, English
