#!/usr/bin/env bash
# Starts the Mailing Webapp and opens it in the default browser.
cd "$(dirname "$0")"

URL="http://127.0.0.1:5001"

python3 app.py &
APP_PID=$!

# Give the server a moment to start before opening the browser.
sleep 1.5

if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1
elif command -v open >/dev/null 2>&1; then
    open "$URL"
else
    echo "Open $URL in your browser."
fi

wait "$APP_PID"
