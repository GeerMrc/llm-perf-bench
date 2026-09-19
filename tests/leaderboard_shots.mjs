#!/usr/bin/env node
/* leaderboard_shots.mjs — acceptance screenshots for the leaderboard modal (TASKS.md T42).
   Serves the REAL worker modules + seeded in-memory KV via tools/worker_shim.mjs (ADR-0001),
   opens the app in Chromium, opens the board modal, and captures
   2 languages × 2 themes × 3 viewports into docs/04-bench/leaderboard/ (tracked evidence).
   Also captures a topbar close-up (trophy button placement) and the submit-preview modal. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
// playwright-core lives in the shared /tmp env (same convention as the browser suites)
const pwRequire = createRequire(process.env.PW_MODULE ? process.env.PW_MODULE : '/tmp/pw-env/package.json');
const { chromium } = pwRequire('playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', '04-bench', 'leaderboard');
const PORT = Number(process.env.SHOTS_PORT || 8796);
const BASE = `http://127.0.0.1:${PORT}`;

const now = Date.now();
const USERS = [
    { uuid: 'aaaa4567-e89b-42d3-a456-426614174000', name: 'Aster', model: 'Qwen3.8-27B-NVFP4', gpu: 'RTX 5090', engine: 'sglang', ts: now - 86400e3, d: 91.2, p: 3410.5, ttft: 198.4 },
    { uuid: 'bbbb4567-e89b-42d3-a456-426614174bbb', name: '云端小张', model: 'Qwen3.8-27B-NVFP4', gpu: 'RTX 4090', engine: 'sglang', ts: now - 43200e3, d: 62.7, p: 2530.0, ttft: 268.9 },
    { uuid: 'cccc4567-e89b-42d3-a456-426614174ccc', name: 'night-runner', model: 'Llama-3.3-70B', gpu: 'H100 ×2', engine: 'vllm', ts: now - 7200e3, d: 48.9, p: 2101.7, ttft: 355.2 },
    { uuid: 'dddd4567-e89b-42d3-a456-426614174ddd', name: 'kiwi', model: 'Qwen3.8-27B-NVFP4', gpu: 'RTX 4080S', engine: 'ninfer', ts: now - 600e3, d: 35.4, p: 1780.3, ttft: 501.8 },
];

async function seed(env) {
    const { boardKey } = await import('../src/worker/kv.mjs');
    for (const u of USERS) {
        const entry = {
            v: 1, uuid: u.uuid, ts: u.ts, proto: 'openai-completions', preset: 'standard',
            name: u.name, model: u.model, gpu: u.gpu, engine: u.engine,
            decode: u.d, prefill: u.p, ttft: u.ttft, tpot: 19.1, e2e: 12345.6, refIn: 2048,
            epClass: 'local:' + u.engine,
        };
        const metadata = { uuid: u.uuid, name: u.name, ts: u.ts, proto: entry.proto, preset: 'standard', refIn: 2048, decode: u.d, prefill: u.p, ttft: u.ttft, model: u.model, gpu: u.gpu, engine: u.engine };
        for (const metric of ['decode', 'prefill', 'ttft']) {
            const inverted = metric !== 'ttft';
            const v = metric === 'decode' ? u.d : metric === 'prefill' ? u.p : u.ttft;
            const sk = inverted ? String(9999999 - Math.min(9999999, Math.round(v * 100))).padStart(7, '0') : String(Math.round(v)).padStart(8, '0');
            await env.LEADERBOARD.put(boardKey('standard', metric, sk, u.uuid, u.ts), JSON.stringify(entry), { metadata });
        }
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const { startServer, makeEnv } = await import('../tools/worker_shim.mjs');
    const env = makeEnv({ salt: 'shots-salt' });
    await seed(env);
    const server = await startServer({ port: PORT, env });
    mkdirSync(OUT, { recursive: true });

    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    let failures = 0;
    try {
        const combos = [];
        for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) for (const vp of [1920, 1280, 640]) combos.push({ lang, theme, vp });
        for (const c of combos) {
            const ctx = await browser.newContext({ viewport: { width: c.vp, height: c.vp === 640 ? 900 : 1000 }, deviceScaleFactor: 1 });
            const page = await ctx.newPage();
            // playwright-core 1.44 addInitScript takes exactly ONE arg (RECON-P4 P1):
            // pass a JSON payload and destructure inside the script.
            await page.addInitScript((payload) => {
                const { lang, theme } = JSON.parse(payload);
                localStorage.setItem('lbp.lang', lang);
                localStorage.setItem('lbp.theme', theme);
            }, JSON.stringify({ lang: c.lang, theme: c.theme }));
            await page.goto(BASE + '/src/llm-perf-bench.html', { waitUntil: 'load' });
            await sleep(600); // probe + board buttons settle
            const btn = page.locator('#boardBtn');
            if (!(await btn.isVisible())) { console.error(`  ✗ board button not visible (${c.lang}/${c.theme}/${c.vp})`); failures++; await ctx.close(); continue; }
            await btn.click();
            await page.waitForSelector('.board-row:not(.head)', { timeout: 8000 });
            await sleep(250); // fonts/layout settle
            const f = `board-${c.lang}-${c.theme}-${c.vp}.png`;
            await page.screenshot({ path: path.join(OUT, f) });
            console.log(`  ✓ ${f}`);
            await ctx.close();
        }
        // topbar close-up (trophy placement between statusPill and langBtn) + submit preview
        {
            const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
            const page = await ctx.newPage();
            await page.addInitScript((p) => { const { lang, theme } = JSON.parse(p); localStorage.setItem('lbp.lang', lang); localStorage.setItem('lbp.theme', theme); }, JSON.stringify({ lang: 'zh', theme: 'light' }));
            await page.goto(BASE + '/src/llm-perf-bench.html', { waitUntil: 'load' });
            await sleep(600);
            const top = await page.locator('.topbar').boundingBox();
            await page.screenshot({ path: path.join(OUT, 'topbar-closeup.png'), clip: { x: Math.max(0, top.x + top.width - 620), y: top.y, width: Math.min(620, top.width), height: top.height } });
            console.log('  ✓ topbar-closeup.png');
            // T49: export flyout menu open (hover trigger)
            await page.hover('#exportMenuBtn');
            await sleep(250);
            await page.screenshot({ path: path.join(OUT, 'export-menu-open.png'), clip: { x: Math.max(0, top.x + top.width - 420), y: top.y, width: Math.min(420, top.width), height: 300 } });
            console.log('  ✓ export-menu-open.png');
            await ctx.close();
        }
    } finally {
        await browser.close();
        await new Promise((r) => server.close(r));
    }
    console.log(failures ? `✗ ${failures} FAILURES` : '✓ ALL LEADERBOARD SHOTS CAPTURED');
    process.exit(failures ? 2 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
