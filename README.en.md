# LLM Perf Bench

English | [简体中文](README.md)

A single-file, zero-dependency LLM inference performance benchmarking tool (runs in the browser, works offline via `file://`; optional same-origin Node proxy bypasses CORS).

Repository: https://github.com/GeerMrc/llm-perf-bench

## Features

- **Three protocols**: openai-completions / openai-responses / anthropic (endpoints derived automatically)
- **Multi-run measurement**: N repeats per point (default ×3) with median + min-max uncertainty + CV stability
- **Server-side timing first** (Ⓢ): `serverTimings` from the ninfer chat protocol excludes network/proxy overhead
- **5-panel professional charts**: Prefill / Decode / TTFT / TPOT / E2E (single axis, log₂ X, hover readout)
- **4 export formats**:
  - PNG (2x HD, 1440×~1100 CSS / 2880 actual pixels, 1.31:1 widescreen report: env info card + KPI stats + 5 panels + results table + repo footer, follows the current UI theme; **public endpoints are masked automatically** — `https://`, domains and public IPs render as `***`, only `http://` loopback/private addresses stay visible, safe to share)
  - CSV / Markdown / JSON (with per-run raw data)
- **Bilingual (中文/English)** + **tri-state theme** (system/light/dark), hover tooltips on every control (incl. language/theme buttons)
- **Scenario presets**: ⚡Quick / 📊Standard / 💬Chat 64K / 🤖Agent 128K / 👨‍💻Coding 256K
- **Model-limit aware clamping**: auto-detects max_model_len and clamps out-of-range points to the safe boundary
- **Guided validation**: empty fields → expand sidebar + highlight; first-point failure → stop immediately with precise guidance
- **Multi-backend same-origin proxy**: `tools/bench_proxy.mjs` (zero-dependency node:http) routes SGLang/ninfer/vLLM/Ollama/LM Studio by path, with true SSE pass-through

## Quick Start

```bash
# Option 1: start the same-origin proxy (recommended — bypasses CORS, LAN-accessible)
./serve.sh start            # equivalent to: node tools/bench_proxy.mjs (BENCH_PORT=8899)

# Open in the browser
open http://127.0.0.1:8899/          # serves src/llm-perf-bench.html

# Option 2: open directly via file:// (backend must support CORS)
open src/llm-perf-bench.html
```

See [docs/deployment.md](docs/deployment.md) for detailed deployment steps.

## How to Use

1. **Configure the endpoint**: pick a protocol in the Endpoint card, click a backend chip (SGLang / Ninfer / vLLM / Ollama / LM Studio) to auto-fill the Base URL, or type one manually
2. **Test the connection**: enter the API key and model name (or click "Fetch"), then "Test connection"
3. **Pick a preset**: ⚡Quick / 📊Standard / 💬Chat / 🤖Agent / 👨‍💻Coding by scenario, or customize the input-length ladder (multiplicative step)
4. **Run**: the start button turns into a progress button and can be aborted anytime; inspect the 5 chart panels, the results table, and per-run details via row click
5. **Export**: PNG / CSV / MD / JSON from the toolbar; (optional) fill in the Env Info card — it renders in the PNG report header

## Notes

- **API key safety**: the key lives only in the browser's localStorage; it is never uploaded or written into exported files
- **file:// limitation**: opening the HTML directly requires backend CORS (SGLang/vLLM/Ollama enable it by default; Ninfer needs proxy mode)
- **PNG endpoint masking**: exported PNGs automatically mask public endpoints (https, domains, public IPs) as `***`; only `http://` loopback/private addresses stay in clear
- **Model-limit clamping**: test points beyond the model's max_model_len are clamped to the safe boundary (marked ↓ in the table)
- **Multi-run measurement**: each point defaults to ×3 runs with the median reported; per-run raw data is in the detail dialog and the JSON export

## Project Layout

```
src/           # main deliverable (single HTML file, zero dependencies)
tools/         # bench_proxy.mjs (multi-backend same-origin proxy, zero-dependency node:http)
tests/         # 4 suites: engine / UI (jsdom) / browser (Chromium) / PNG layout regression
docs/          # deployment guide / task tracking (00-plans) / lessons (03-lessons)
evidence/      # iteration screenshots (kept local, not committed)
```

## Running Tests

Requirements: Node ≥ 18, a local inference backend (default ninfer at `127.0.0.1:30001`), and playwright-core / jsdom dependency dirs (default `/tmp/pw-env`, `/tmp/jsdom-env`; override with `PW_MODULE` / `JSDOM_MODULE`).

```bash
export BENCH_KEY=sk-xxxx          # local backend API key (never committed, injected at runtime)
./serve.sh start                  # browser & PNG layout suites need the proxy

node tests/bench_engine_test.js   # engine: protocol engines × 3 (stubbed DOM, hits the backend)
node tests/bench_ui_test.js       # UI: full jsdom interaction flow (reads ../src/llm-perf-bench.html)
node tests/bench_browser_test.js  # browser: real run + 4-format exports + i18n + themes
node tests/bench_png_layout_test.js  # PNG layout regression: dual themes × English + pixel blank-band scan
```

## Development Conventions

- Every task follows: **plan → independent agent review → execute item by item → independent audit → cross-validation**
- No fabricated reviews, no assumptions, no out-of-order execution
- Lessons must be recorded in `docs/03-lessons/LESSONS.md`
- Service switches (ninfer/SGLang) must be logged in the `docs/00-plans/TASKS.md` switch log

## License

[GPL-3.0](LICENSE) — reworked from [chaoshen999/llm-tools](https://github.com/chaoshen999/llm-tools) (GPL-3.0).
