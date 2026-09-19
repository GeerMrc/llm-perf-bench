#!/usr/bin/env node
/* leaderboard_smoke.mjs — Phase 5 full-stack smoke over the shim origin (TASKS.md T43).
   REAL browser (Chromium) + REAL worker modules (src/worker/*.mjs via tools/worker_shim.mjs,
   ADR-0001) + in-memory KV. Covers: capability on shim origin → board button/modal/my-rank →
   tab & preset switching → soft rate limit over real HTTP (submit twice) → REAL quick run +
   toolbar submit → estimated-rank toast. Also the browser-level focus-trap check deferred
   from RECON-P4 P3. Shim start/stop is embedded in this process (switch-log exemption,
   precedent 8795/8796). */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const pwRequire = createRequire('/tmp/pw-env/package.json');
const { chromium } = pwRequire('playwright-core');

const PORT = Number(process.env.SMOKE_PORT || 8798);
const STUB_PORT = Number(process.env.SMOKE_STUB_PORT || 8879);   // decoupled from worker_shim --demo's 8799 (RECON-P8 port-clash finding)
const BASE = `http://127.0.0.1:${PORT}`;
const MY = 'ab12c567-e89b-42d3-a456-42661417ab12';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CORS-permitting OpenAI-compatible SSE stub backend (default 8879, SMOKE_STUB_PORT): the real ninfer does
// not send CORS headers (docs/deployment.md), and a REAL browser on the shim origin
// cannot cross-origin fetch it — so the smoke's run-phase data source is this stub with
// controlled latencies. Protocol behavior itself is covered by the engine suite against
// the live backend; this stub only feeds the leaderboard E2E pipeline.
import http from 'node:http';
function startStubBackend(port) {
    const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const server = http.createServer((req, res) => {
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
                try { const j = JSON.parse(body); const txt = (j.messages || []).map((m) => m.content || '').join(''); promptTok = Math.max(16, Math.round(txt.length / 3.6)); } catch (e) {}
                const completionTok = 64;
                res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...CORS });
                const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
                setTimeout(() => send({ choices: [{ delta: { role: 'assistant' } }] }), 25);
                let sent = 0;
                const iv = setInterval(() => {
                    send({ choices: [{ delta: { content: 'x'.repeat(8) } }] });
                    if (++sent >= 8) {
                        clearInterval(iv);
                        send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: promptTok, completion_tokens: completionTok } });
                        res.write('data: [DONE]\n\n');
                        res.end();
                    }
                }, 25);
            });
            return;
        }
        res.writeHead(404, CORS); res.end('{}');
    });
    return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

let failures = 0;
const check = (name, cond, extra) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined && extra !== '' ? '  ' + extra : ''));
    if (!cond) failures++;
};

(async () => {
    const { startServer, makeEnv } = await import('../tools/worker_shim.mjs');
    const { boardKey } = await import('../src/worker/kv.mjs');
    const env = makeEnv({ salt: 'smoke-salt' });

    // seed one entry so "my rank" is verifiable before any run
    const seedEntry = {
        v: 1, uuid: MY, ts: Date.now() - 3600e3, proto: 'openai-completions', preset: 'standard',
        name: 'smoke-seed', model: 'Qwen3.8-27B-NVFP4', gpu: 'RTX 5090', engine: 'sglang',
        decode: 61.3, prefill: 2500.5, ttft: 290.4, refIn: 2048, epClass: 'local:sglang',
    };
    const seedMeta = { uuid: MY, name: seedEntry.name, ts: seedEntry.ts, proto: 'openai-completions', preset: 'standard', refIn: 2048, decode: seedEntry.decode, prefill: seedEntry.prefill, ttft: seedEntry.ttft, model: seedEntry.model, gpu: seedEntry.gpu, engine: seedEntry.engine };
    for (const metric of ['decode', 'prefill', 'ttft']) {
        const v = metric === 'decode' ? seedEntry.decode : metric === 'prefill' ? seedEntry.prefill : seedEntry.ttft;
        const sk = metric === 'ttft' ? String(Math.round(v)).padStart(8, '0') : String(9999999 - Math.round(v * 100)).padStart(7, '0');
        await env.LEADERBOARD.put(boardKey('standard', metric, sk, MY, seedEntry.ts), JSON.stringify(seedEntry), { metadata: seedMeta });
    }

    const server = await startServer({ port: PORT, env });
    const stubServer = await startStubBackend(STUB_PORT);
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await ctx.newPage();
        const consoleErrors = [];
        page.on('pageerror', (e) => consoleErrors.push(String(e && e.message || e)));

        console.log('[S1] capability + board modal on shim origin');
        await page.addInitScript((p) => { localStorage.setItem('lbp.uid', JSON.parse(p).uid); localStorage.setItem('lbp.lang', 'zh'); }, JSON.stringify({ uid: MY }));
        await page.goto(BASE + '/src/llm-perf-bench.html', { waitUntil: 'load' });
        await sleep(700);
        check('board button visible (capability probe ok)', await page.locator('#boardBtn').isVisible());
        await page.click('#boardBtn');
        await page.waitForSelector('.board-row:not(.head)', { timeout: 8000 });
        check('seeded entry renders', (await page.locator('.board-row:not(.head)').count()) === 1);
        check('my seed row highlighted', await page.locator('.board-row.mine').count() === 1);
        check('my rank line = 第 1 名', /第 1 名/.test(await page.locator('#boardMine').textContent()), await page.locator('#boardMine').textContent());

        console.log('[S2] tabs + preset switching + refresh');
        await page.click('#board-tab-ttft');
        await sleep(400);
        check('ttft tab selected + refetch', await page.locator('#board-tab-ttft').getAttribute('aria-selected') === 'true');
        await page.click('.board-sub .chip[data-preset="agent"]');
        await sleep(400);
        check('agent preset → empty board state', await page.locator('.board-state[data-state="empty"]').count() === 1);
        await page.click('.board-sub .chip[data-preset="standard"]');
        await sleep(400);
        await page.click('#boardRefresh');
        await sleep(400);
        check('refresh restores list', (await page.locator('.board-row:not(.head)').count()) === 1);

        console.log('[S3] focus trap (browser-level, RECON-P4 deferred + RECON-P5 D-P5-2 wrap boundary)');
        await page.click('#board-tab-decode');
        await sleep(300);
        // press more Tabs than there are focusables → must WRAP to the first, never escape
        for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
        const afterWrap = await page.evaluate(() => ({ inside: !!document.querySelector('.board-modal').contains(document.activeElement), id: document.activeElement && (document.activeElement.id || document.activeElement.tagName) }));
        check('forward Tab wraps inside modal (never escapes)', afterWrap.inside, JSON.stringify(afterWrap));
        for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+Tab');
        const afterBack = await page.evaluate(() => ({ inside: !!document.querySelector('.board-modal').contains(document.activeElement), id: document.activeElement && (document.activeElement.id || document.activeElement.tagName) }));
        check('backward Shift+Tab stays inside modal', afterBack.inside, JSON.stringify(afterBack));

        console.log('[S4] soft rate limit over real HTTP (page-context double submit)');
        const rl = await page.evaluate(async () => {
            const body = { uuid: localStorage.getItem('lbp.uid'), proto: 'openai-completions', preset: 'chat', name: 'rl-probe', model: 'm', gpu: 'g', engine: 'e', epClass: 'local:lan', decode: 30, prefill: 900, ttft: 500, refIn: 8192 };
            const r1 = await fetch('/api/leaderboard/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            const j1 = await r1.json();
            const r2 = await fetch('/api/leaderboard/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            const j2 = await r2.json();
            return { s1: r1.status, ok1: j1.ok, s2: r2.status, kind2: j2 && j2.error && j2.error.kind };
        });
        check('first submit ok (200)', rl.s1 === 200 && rl.ok1 === true, JSON.stringify(rl));
        check('second submit within 60s → 429 rate_limited', rl.s2 === 429 && rl.kind2 === 'rate_limited', JSON.stringify(rl));

        console.log('[S5] quick run (CORS stub backend) + toolbar submit → estimated rank toast');
        await page.keyboard.press('Escape');
        await sleep(200);
        // the smoke owns the in-memory KV: clear S4's 60s rl keys so the REAL submit isn't soft-rate-limited
        for (const k of [...env.LEADERBOARD.map.keys()]) if (k.startsWith('rl:')) env.LEADERBOARD.map.delete(k);
        await page.fill('#baseUrl', 'http://127.0.0.1:' + STUB_PORT);
        await page.fill('#modelName', 'stub-model');
        await page.click('.preset-pill[data-preset="quick"]');
        await sleep(200);
        await page.click('#startBtn');
        let done = false;
        for (let i = 0; i < 150; i++) { await sleep(1000); if (/开始测试/.test(await page.locator('#startBtn').textContent())) { done = true; break; } }
        check('quick run finished', done, await page.locator('#statusText').textContent());
        const subBtn = page.locator('#boardSubmitBtn');
        check('toolbar submit button enabled after run', await subBtn.isEnabled());
        await subBtn.click();
        await page.waitForSelector('.modal .kv-grid', { timeout: 5000 });
        check('preview modal shows sanitized fields (epClass local:lan, no raw URL)', /local:lan/.test(await page.locator('.modal').textContent()) && !new RegExp(':' + STUB_PORT).test(await page.locator('.modal').textContent()));
        await page.click('.modal-actions button:last-child');
        await sleep(800);
        const toastText = await page.locator('#toasts .toast').last().textContent().catch(() => '');
        check('estimated-rank toast', /估算名次/.test(toastText), toastText);
        await page.click('#boardBtn');
        await page.waitForSelector('.board-row:not(.head)', { timeout: 8000 });
        await sleep(300);
        const mineRows = await page.locator('.board-row.mine').count();
        check('my new submission visible on board (local KV immediate)', mineRows >= 1, String(mineRows));

        check('no page JS errors through whole smoke', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
        await ctx.close();
    } finally {
        await browser.close();
        await new Promise((r) => server.close(r));
        if (stubServer) await new Promise((r) => stubServer.close(r));
    }
    console.log(failures ? `✗ ${failures} FAILURES` : '✓ ALL LEADERBOARD SMOKE CHECKS PASSED');
    process.exit(failures ? 2 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
