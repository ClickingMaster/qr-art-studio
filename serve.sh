#!/bin/sh
# Serve this folder locally. Usage: ./serve.sh [port] [bind-address]
# Pass 0.0.0.0 as the second argument to reach it from a phone on your network.
cd "$(dirname "$0")"
PORT="${1:-8080}"
BIND="${2:-127.0.0.1}"
echo "Open http://localhost:$PORT"
if [ "$BIND" = "0.0.0.0" ]; then
  for ip in $(hostname -I 2>/dev/null); do echo "Network: http://$ip:$PORT"; done
fi
exec python3 -m http.server "$PORT" --bind "$BIND"
