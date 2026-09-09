# Grok Desktop

Desktop app for the Grok coding agent — same idea as Codex Desktop / Claude Code Desktop.

The window is a GUI. The work is still done by the Grok CLI over ACP (`grok agent stdio`). Sessions, skills, and plugins stay in `~/.grok`.

## Run (development)

Needs Node 24+, Rust, and a Grok CLI (`~/.grok/bin/grok` is fine).

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

## Bundle Grok into the installer

The Grok binary is large (~127MB) and is not committed. Before `npm run tauri build`:

```bash
./scripts/bundle-grok.sh
```

Then add `"externalBin": ["binaries/grok"]` under `src-tauri/tauri.conf.json` → `bundle`.

## Layout

- Left: session history
- Center: agent thread (thinking, tools, replies)
- Settings / Skills / Plugins pages
- Languages: Simplified Chinese, Traditional Chinese, English
