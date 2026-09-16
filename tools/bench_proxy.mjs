#!/usr/bin/env node
/** Multi-backend same-origin helper for llm-perf-bench.html (zero-dependency node:http).
 *
 * Serves the HTML from the project root and reverse-proxies inference APIs with
 * true SSE pass-through, so a browser page can benchmark any local backend
 * without CORS restrictions (CORS is a browser-only security model; the proxy
 * talks server-to-server).
 *
 * Routing:
 *     /                      -> src/llm-perf-bench.html (static files served from ROOT)
 *     /{backend}/v1/*        -> that backend's http://127.0.0.1:<port>/v1/*
 *                                backends: sglang(30000) ninfer(30001) vllm(8000)
 *                                          ollama(11434) lmstudio(1234)
 *     /v1/*                  -> default backend (BENCH_TARGET, kept for old bookmarks)
 *
 * Usage:
 *     BENCH_PORT=8899 BENCH_BIND=0.0.0.0 node tools/bench_proxy.mjs
 * Open http://<LAN-IP>:8899/ , enable "same-origin proxy" in the endpoint card,
 * pick a backend chip — the tool fills http://<LAN-IP>:8899/<backend> as Base URL.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.BENCH_PORT || 8899);
const BIND = process.env.BENCH_BIND || '0.0.0.0';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));  // project root (parent of tools/)
const HOP_HEADERS = ['content-type', 'authorization', 'x-api-key', 'anthropic-version', 'accept'];

const BACKENDS = {
    sglang: 'http://127.0.0.1:30000',
    ninfer: 'http://127.0.0.1:30001',
    vllm: 'http://127.0.0.1:8000',
    ollama: 'http://127.0.0.1:11434',
    lmstudio: 'http://127.0.0.1:1234'
};
const DEFAULT_TARGET = process.env.BENCH_TARGET || BACKENDS.ninfer;

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.csv': 'text/csv; charset=utf-8'
};

/** Map request path -> [upstream_base, upstream_path]. */
function resolve(p) {
    const parts = p.replace(/^\//, '').split('/');
    const name = parts[0].toLowerCase();
    if (name in BACKENDS) return [BACKENDS[name], '/' + parts.slice(1).join('/')];
    return [DEFAULT_TARGET, p];
}

function isBackendPath(p) {
    const name = p.replace(/^\//, '').split('/')[0].toLowerCase();
    return name in BACKENDS;
}

function sendText(res, code, text) {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(text);
}

function serveStatic(req, res, urlPath) {
    // force browsers to revalidate on every load so tool updates take effect on
    // a normal refresh (304s keep it cheap when unchanged)
    let file = path.normalize(path.join(ROOT, decodeURIComponent(urlPath.split('?')[0])));
    if (!file.startsWith(ROOT)) return sendText(res, 403, 'forbidden');
    if (urlPath === '/' || urlPath === '/index.html') file = path.join(ROOT, 'src', 'llm-perf-bench.html');
    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) return sendText(res, 404, 'not found: ' + urlPath);
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Content-Length': st.size,
            'Cache-Control': 'no-cache'
        });
        fs.createReadStream(file).pipe(res);
    });
}

function proxy(req, res, urlPath) {
    const [target, upstreamPath] = resolve(urlPath);
    const url = new URL(target + upstreamPath);
    const headers = {};
    for (const h of HOP_HEADERS) if (req.headers[h]) headers[h] = req.headers[h];
    const up = http.request(url, { method: req.method, headers }, (ur) => {
        const out = { 'Cache-Control': 'no-cache', 'Connection': 'close' };
        if (ur.headers['content-type']) out['Content-Type'] = ur.headers['content-type'];
        res.writeHead(ur.statusCode, out);
        ur.pipe(res);                      // stream until close; SSE pass-through
    });
    up.on('error', (e) => {               // connection refused etc.
        if (!res.headersSent) sendText(res, 502, 'proxy error: ' + urlPath + ' -> ' + url.href + ' (' + e.code + ')');
        else res.end();
    });
    req.pipe(up);
}

const server = http.createServer((req, res) => {
    const p = req.url;
    if (p.startsWith('/v1/') || isBackendPath(p)) return proxy(req, res, p);
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);
    sendText(res, 404, 'not found: ' + p);
});

server.listen(PORT, BIND, () => {
    console.log(`serving ${ROOT} at http://${BIND}:${PORT}`);
    console.log(`backends: ${Object.entries(BACKENDS).map(([k, v]) => k + '->' + v).join(', ')} | default(/v1/*): ${DEFAULT_TARGET}`);
});
