#!/bin/bash
# Bring the Extension Development Host window showing TARGET to the front,
# so screen recordings capture the debugger instead of whatever is focused.
# Usage: ./e2e/focus.sh [folder-name-substring, default order-processor]
set -u
WANT="${1:-order-processor}"
/usr/bin/osascript -e "tell application \"Visual Studio Code\" to activate" >/dev/null 2>&1
sleep 1
/usr/bin/osascript >/dev/null 2>&1 <<APPLESCRIPT
tell application "System Events"
  repeat with p in (every process whose name is "Code")
    repeat with w in (every window of p)
      if (name of w contains "${WANT}") or (name of w contains "Extension Development Host") then
        perform action "AXRaise" of w
        set frontmost of p to true
        return
      end if
    end repeat
  end repeat
end tell
APPLESCRIPT
echo "focused window matching '${WANT}' (if present)"
