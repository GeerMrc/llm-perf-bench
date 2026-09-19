#!/bin/bash
# Serve LLM Perf Bench + multi-backend proxy
# Usage: ./serve.sh [start|stop|status]
set -e

PROJ_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${BENCH_PORT:-8899}"
PID_FILE="$PROJ_DIR/.serve.pid"

case "${1:-start}" in
  start)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
      echo "Already running (PID $(cat $PID_FILE))"
      exit 0
    fi
    if ! command -v node >/dev/null 2>&1; then
      echo "Error: node is required (proxy is tools/bench_proxy.mjs)" >&2
      exit 1
    fi
    cd "$PROJ_DIR/tools"
    BENCH_PORT=$PORT BENCH_BIND=0.0.0.0 nohup node bench_proxy.mjs > "$PROJ_DIR/bench_proxy.log" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 1
    echo "Serving at http://0.0.0.0:$PORT/src/llm-perf-bench.html (PID $(cat $PID_FILE))"
    ;;
  stop)
    if [ -f "$PID_FILE" ]; then
      kill "$(cat $PID_FILE)" 2>/dev/null && echo "Stopped" || echo "Not running"
      rm -f "$PID_FILE"
    else
      echo "Not running"
    fi
    ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
      echo "Running (PID $(cat $PID_FILE))"
      curl -s -o /dev/null -w "Page: HTTP %{http_code}\n" "http://127.0.0.1:$PORT/src/llm-perf-bench.html"
    else
      echo "Not running"
    fi
    ;;
  *)
    echo "Usage: $0 [start|stop|status]"
    exit 1
    ;;
esac
