#!/bin/bash
# Record fullscreen video on macOS for the demo takes.
# Usage: ./demo/record.sh jev|llm [SCREEN_DEVICE_INDEX]
set -e
NAME="${1:-take}"
OUT="demo/${NAME}.mov"
mkdir -p demo
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Record manually: Cmd+Shift+5 -> Record Entire Screen, save as ${OUT}"
  exit 1
fi
if [ -n "$2" ]; then
  DEV="$2"
else
  # Auto-detect the "Capture screen N" device (never assume index 1: cameras come first).
  DEV=$(ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep -oE '\[[0-9]+\] Capture screen [0-9]+' | head -n 1 | grep -oE '^\[[0-9]+\]' | tr -d '[]')
  if [ -z "${DEV}" ]; then
    echo "No screen capture device found. Grant Screen Recording permission and retry."
    exit 1
  fi
fi
echo "Recording screen (avfoundation device ${DEV}) to ${OUT}. Ctrl+C to stop."
ffmpeg -f avfoundation -capture_cursor 1 -i "${DEV}" -r 30 "${OUT}"
