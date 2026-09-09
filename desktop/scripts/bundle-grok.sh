#!/usr/bin/env bash
# Copy the local Grok CLI into Tauri sidecar layout.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$ROOT/src-tauri/binaries"
mkdir -p "$DEST_DIR"

SOURCE="${GROK_BIN:-$HOME/.grok/bin/grok}"
if [[ ! -e "$SOURCE" && -e "${SOURCE}.exe" ]]; then
  SOURCE="${SOURCE}.exe"
fi
if [[ ! -e "$SOURCE" ]]; then
  echo "Grok CLI not found at $SOURCE" >&2
  echo "Install it first: curl -fsSL https://x.ai/cli/install.sh | bash" >&2
  exit 1
fi

TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
EXT=""
case "$TRIPLE" in
  *windows*) EXT=".exe" ;;
esac
TARGET="$DEST_DIR/grok-$TRIPLE$EXT"

if [[ -f "$TARGET" && ! "$SOURCE" -nt "$TARGET" ]]; then
  echo "Already bundled $(ls -lh "$TARGET" | awk '{print $5}') -> $TARGET"
  exit 0
fi

cp -L "$SOURCE" "$TARGET"
chmod +x "$TARGET"
echo "Bundled $(ls -lh "$TARGET" | awk '{print $5}') -> $TARGET"
