// tools/worker_shim.mjs — Node-based Cloudflare Workers runtime shim (dev/test only).
//
// WHY (ADR-0001): this host runs Ubuntu 20.04 / glibc 2.31, and the workerd binary
// (kernel of `wrangler dev` and miniflare) requires glibc >= 2.32. This shim runs the
// REAL src/worker/*.js modules under Node with an in-memory KV and a single-file asset
// service, so e2e tests and browser smoke tests exercise the exact code that deploys.
// Production verification stays: `wrangler deploy --dry-run` (config/bundle gate) +
// real `wrangler dev` smoke on the user side (docs/deployment.md).
//
// Usage:
//   node tools/worker_shim.mjs [--port 8787]      # start HTTP server
//   import { makeEnv, shimFetch } from './tools/worker_shim.mjs'  # for tests
//
// Zero-dependency by design (node: built-ins only), mirroring tools/bench_proxy.mjs.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import worker from '../src/worker/index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_FILE = 'src/llm-perf-bench.html'; // mirrors .assetsignore: the only public asset

/* ============ In-memory KV (Workers KV API subset used by the worker) ============ */

export class MemoryKV {
  constructor() { this.map = new Map(); } // key -> { value(string), metadata, expiresAt(ms|null) }

  async get(key, type) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expiresAt != null && Date.now() >= e.expiresAt) { this.map.delete(key); return null; }
    if (type === 'json') return JSON.parse(e.value);
    return e.value;
  }

  // put(key, value, { metadata, expirationTtl }) — TTL floor 60s like real KV.
  async put(key, value, opts = {}) {
    if (opts.expirationTtl != null && opts.expirationTtl < 60) {
      throw new Error('KV put: expirationTtl must be at least 60 seconds');
    }
    if (metadataSize(opts.metadata) > 1024) throw new Error('KV put: metadata exceeds 1024 bytes');
    this.map.set(key, {
      value: typeof value === 'string' ? value : JSON.stringify(value),
      metadata: opts.metadata ?? null,
      expiresAt: opts.expirationTtl != null ? Date.now() + opts.expirationTtl * 1000 : null,
    });
  }

  // list({ prefix, limit }) — lexicographic key order, key+metadata only (like real KV).
  async list({ prefix = '', limit = 1000 } = {}) {
    const now = Date.now();
    const out = [];
    for (const [key, e] of this.map) {
      if (!key.startsWith(prefix)) continue;
      if (e.expiresAt != null && now >= e.expiresAt) { this.map.delete(key); continue; }
      out.push({ name: key, metadata: e.metadata });
      if (out.length >= limit) break;
    }
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { keys: out, list_complete: true };
  }

  async delete(key) { this.map.delete(key); }
}

function metadataSize(m) {
  if (m == null) return 0;
  return Buffer.byteLength(JSON.stringify(m), 'utf8');
}

/* ============ env bindings ============ */

export function makeEnv(opts = {}) {
  return {
    LEADERBOARD: opts.kv ?? new MemoryKV(),
    RATE_LIMIT_SALT: opts.salt ?? 'shim-default-salt',
    ASSETS: {
      // Single public asset, mirroring .assetsignore semantics.
      async fetch(request) {
        const url = new URL(request.url);
        if (request.method !== 'GET' || url.pathname !== '/' + ASSET_FILE) {
          return new Response('Not Found', { status: 404 });
        }
        try {
          const buf = await readFile(path.join(REPO_ROOT, ASSET_FILE));
          return new Response(buf, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
          });
        } catch {
          return new Response('Not Found', { status: 404 });
        }
      },
    },
  };
}

/* ============ HTTP server ============ */

export function shimFetch(env) {
  return (request) => worker.fetch(request, env);
}

export function startServer({ port = 8787, host = '127.0.0.1', env = makeEnv() } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const base = `http://${req.headers.host ?? `127.0.0.1:${port}`}`;
      const url = new URL(req.url, base);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
        else if (v != null) headers.set(k, v);
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url.toString(), {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
        duplex: body ? 'half' : undefined,
      });
      const resp = await worker.fetch(request, env);
      const buf = Buffer.from(await resp.arrayBuffer());
      const outHeaders = {};
      resp.headers.forEach((v, k) => { outHeaders[k] = v; });
      res.writeHead(resp.status, outHeaders);
      res.end(buf);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { kind: 'internal', msg: String(err?.message ?? err) } }));
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

// CLI mode
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const portIdx = process.argv.indexOf('--port');
  const port = portIdx !== -1 ? Number(process.argv[portIdx + 1]) : 8787;
  const demo = process.argv.includes('--demo');
  const hostIdx = process.argv.indexOf('--host');
  const host = hostIdx !== -1 ? process.argv[hostIdx + 1] : '127.0.0.1';   // --host 0.0.0.0 for LAN access

  // ---- --demo: local verification bundle (TASKS.md T48a) ----
  // Seeds a few board entries and starts a CORS-permitting OpenAI SSE stub backend so
  // the full "run a round → submit → board → my rank" flow works locally. The real
  // ninfer does not send CORS headers (docs/deployment.md), so a browser on the shim
  // origin cannot run real benchmarks against it — the stub stands in for the run phase
  // only (protocol behavior itself is covered by the engine suite against live backends).
  async function startStubBackend(stubPort, host = '127.0.0.1') {
    const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const srv = http.createServer((req, res) => {
      if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
      if (req.url.includes('/v1/models')) {
        res.writeHead(200, { 'content-type': 'application/json', ...CORS });
        return res.end(JSON.stringify({ data: [{ id: 'stub-model' }] }));
      }
      if (req.url.includes('/v1/chat/completions')) {
        let body = '';
        req.on('data', (c) => body += c);
        req.on('end', () => {
          let promptTok = 256;
          try { const j = JSON.parse(body); const txt = (j.messages || []).map((m) => m.content || '').join(''); promptTok = Math.max(16, Math.round(txt.length / 3.6)); } catch (e) { }
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...CORS });
          const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
          setTimeout(() => send({ choices: [{ delta: { role: 'assistant' } }] }), 25);
          let sent = 0;
          const iv = setInterval(() => {
            send({ choices: [{ delta: { content: 'x'.repeat(8) } }] });
            if (++sent >= 8) {
              clearInterval(iv);
              send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: promptTok, completion_tokens: 64 } });
              res.write('data: [DONE]\n\n');
              res.end();
            }
          }, 25);
        });
        return;
      }
      res.writeHead(404, CORS); res.end('{}');
    });
    return new Promise((r) => srv.listen(stubPort, host, () => r(srv)));
  }

  async function seedDemo(env) {
    const { boardKey } = await import('../src/worker/kv.mjs');
    const now = Date.now();
    const users = [
      { uuid: 'aaaa4567-e89b-42d3-a456-426614174000', name: 'Aster', model: 'Qwen3.8-27B-NVFP4', gpu: 'RTX 5090', engine: 'sglang', ts: now - 86400e3, d: 91.2, p: 3410.5, ttft: 198.4 },
      { uuid: 'bbbb4567-e89b-42d3-a456-426614174bbb', name: '云端小张', model: 'Qwen3.8-27B-NVFP4', gpu: 'RTX 4090', engine: 'sglang', ts: now - 43200e3, d: 62.7, p: 2530.0, ttft: 268.9 },
      { uuid: 'cccc4567-e89b-42d3-a456-426614174ccc', name: 'night-runner', model: 'Llama-3.3-70B', gpu: 'H100 ×2', engine: 'vllm', ts: now - 7200e3, d: 48.9, p: 2101.7, ttft: 355.2 },
      { uuid: 'dddd4567-e89b-42d3-a456-426614174ddd', name: 'kiwi', model: 'Qwen3.8-27B-NVFP4', gpu: 'RTX 4080S', engine: 'ninfer', ts: now - 600e3, d: 35.4, p: 1780.3, ttft: 501.8 },
    ];
    for (const u of users) {
      const entry = { v: 1, uuid: u.uuid, ts: u.ts, proto: 'openai-completions', preset: 'standard', name: u.name, model: u.model, gpu: u.gpu, engine: u.engine, decode: u.d, prefill: u.p, ttft: u.ttft, tpot: 19.1, e2e: 12345.6, refIn: 2048, epClass: 'local:' + u.engine };
      const metadata = { uuid: u.uuid, name: u.name, ts: u.ts, proto: 'openai-completions', preset: 'standard', refIn: 2048, decode: u.d, prefill: u.p, ttft: u.ttft, model: u.model, gpu: u.gpu, engine: u.engine };
      for (const metric of ['decode', 'prefill', 'ttft']) {
        const v = metric === 'decode' ? u.d : metric === 'prefill' ? u.p : u.ttft;
        const sk = metric === 'ttft' ? String(Math.round(v)).padStart(8, '0') : String(9999999 - Math.min(9999999, Math.round(v * 100))).padStart(7, '0');
        await env.LEADERBOARD.put(boardKey('standard', metric, sk, u.uuid, u.ts), JSON.stringify(entry), { metadata });
      }
    }
    return users.length;
  }

  const env = makeEnv({ salt: 'demo-salt' });
  const stubPortIdx = process.argv.indexOf('--stub-port');
  const stubPort = stubPortIdx !== -1 ? Number(process.argv[stubPortIdx + 1]) : 8799;

  startServer({ port, host, env }).then(async () => {
    console.log(`[worker_shim] http://${host}:${port} (real worker modules + in-memory KV; ADR-0001)`);
    if (demo) {
      await startStubBackend(stubPort, host);
      if (process.argv.includes('--seed')) {
        const n = await seedDemo(env);
        console.log(`[demo] seeded ${n} board entries (--seed) + CORS stub backend on :${stubPort}`);
      } else {
        console.log(`[demo] board starts EMPTY (fresh launch state) + CORS stub backend on :${stubPort}`);   // T53: no seeds by default
      }
      console.log('[demo] 验证步骤：');
      console.log(`  1. 打开 http://${host === '0.0.0.0' ? '<本机内网IP>' : host}:${port}/src/llm-perf-bench.html`);
      console.log(`  2. 接口地址填 http://${host === '0.0.0.0' ? '<本机内网IP，同第 1 步访问地址>' : host}:${stubPort}，模型名 stub-model（API Key 留空）`);
      console.log('  3. 选「⚡快速」模板 → 开始测试（stub 后端，约 10 秒跑完 7 点）');
      console.log('  4. 工具栏「打榜」按钮 → 预览将上传字段（已脱敏）→ 确认提交 → 顶栏奖杯图标查看榜单');
      console.log('  5. 试试：中英切换、主题切换、榜单 Tab（解码/预填充/TTFT）、场景过滤、我的名次、昵称设置');
      console.log('  6. 连续提交两次可体验 60s 软限流；Ctrl+C 停止（内存 KV，重启清空榜单）');
    }
  });
}
