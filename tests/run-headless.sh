#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Runs Frostwave inside a throwaway, headless GNOME Shell together with a mock
# Spotify player, clicks through the widget and saves screenshots.
#
# Everything runs on a private D-Bus session with temporary settings, so the
# running desktop session is not affected.
#
# Usage: tests/run-headless.sh [OUTPUT_DIR]
# Environment:
#   WALLPAPER   image to use as the desktop background
#   SHELL_MODE  GNOME Shell session mode, e.g. "ubuntu" to also load the
#               Ubuntu dock and desktop icons
#   AUTOMATION_SCRIPT  automation script to run instead of tests/automation.js

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
UUID=$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$ROOT/src/metadata.json")
OUTPUT=$(realpath -m "${1:-$ROOT/build/screenshots}")
WALLPAPER=${WALLPAPER:-/usr/share/backgrounds/Resolute_Raccoon_Wallpaper_Dimmed_3840x2160.png}
SHELL_MODE=${SHELL_MODE:-user}
AUTOMATION_SCRIPT=$(realpath "${AUTOMATION_SCRIPT:-$ROOT/tests/automation.js}")

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

export XDG_CONFIG_HOME="$WORK/config"
export XDG_DATA_HOME="$WORK/data"
export XDG_CACHE_HOME="$WORK/cache"
export XDG_STATE_HOME="$WORK/state"
export GSETTINGS_BACKEND=keyfile
export FROSTWAVE_UUID="$UUID"
export FROSTWAVE_OUTPUT="$OUTPUT"

EXTENSION_DIR="$XDG_DATA_HOME/gnome-shell/extensions/$UUID"
mkdir -p "$EXTENSION_DIR" "$OUTPUT" "$XDG_CONFIG_HOME/glib-2.0/settings" "$WORK/art"
cp -r "$ROOT/src/." "$EXTENSION_DIR/"
glib-compile-schemas --strict "$EXTENSION_DIR/schemas"

cat > "$XDG_CONFIG_HOME/glib-2.0/settings/keyfile" <<EOF
[org/gnome/shell]
enabled-extensions=['$UUID']

[org/gnome/desktop/background]
picture-uri='file://$WALLPAPER'
picture-uri-dark='file://$WALLPAPER'
picture-options='zoom'

[org/gnome/desktop/interface]
color-scheme='prefer-dark'
EOF

timeout 180 dbus-run-session -- bash -c '
    gjs -m "$1/tests/mock-player.js" "$2/art" &
    gnome-shell --headless --virtual-monitor 1600x900 \
        --wayland-display frostwave-test --mode="$3" \
        --automation-script "$4"
' bash "$ROOT" "$WORK" "$SHELL_MODE" "$AUTOMATION_SCRIPT"

echo "Screenshots saved to $OUTPUT"
