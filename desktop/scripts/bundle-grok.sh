#!/usr/bin/env bash
# Copy the local Grok CLI into Tauri sidecar layout for macOS packaging.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$ROOT/src-tauri/binaries"
mkdir -p "$DEST_DIR"

SOURCE="${GROK_BIN:-$HOME/.grok/bin/grok}"
if [[ ! -e "$SOURCE" ]]; then
  echo "Grok CLI not found at $SOURCE" >&2
  echo "Install it first: curl -fsSL https://x.ai/cli/install.sh | bash" >&2
  exit 1
fi

TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
TARGET="$DEST_DIR/grok-$TRIPLE"
cp -L "$SOURCE" "$TARGET"
chmod +x "$TARGET"
echo "Bundled $(ls -lh "$TARGET" | awk '{print $5}') -> $TARGET"
echo "Add this to src-tauri/tauri.conf.json bundle section before release:"
echo '  "externalBin": ["binaries/grok"]'
