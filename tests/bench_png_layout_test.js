#!/usr/bin/env node
/* PNG export layout regression: aspect ratio, no blank band, dual-theme consistency.
   Requires the local proxy (./serve.sh, port 8899) and a live inference backend.
   Covers: env-card grid path (6 fields), light/dark themes, English variant,
   pixel-level blank-band scan (decoded in the page's own canvas), footer presence. */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW_MODULE || '/tmp/pw-env/node_modules/playwright-core');

const URL_HTTP = 'http://127.0.0.1:8899/src/llm-perf-bench.html';
const SHOTS = path.join(__dirname, 'bench-shots', 'png-layout');
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, cond, extra) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined && extra !== '' ? '  ' + extra : ''));
    if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message)));

    console.log('[1] config + env fields + quick run');
    await page.goto(URL_HTTP, { waitUntil: 'domcontentloaded' });
    await sleep(500);
    await page.click('#langBtn');   // fresh context starts at en → switch to zh-CN
    await sleep(300);
    check('lang is zh-CN', (await page.evaluate(() => document.documentElement.lang)) === 'zh-CN');
    await page.click('#quickChips .chip[data-backend="ninfer"]');
    await page.fill('#baseUrl', 'http://127.0.0.1:8899');
    await page.fill('#apiKey', process.env.BENCH_KEY || 'sk-local-test');
    await page.click('#testConnBtn');
    await sleep(2500);
    check('connected', /连接成功|Connected/.test(await page.textContent('#connStatus')), (await page.textContent('#connStatus')).slice(0, 50));

    await page.click('[data-collapse="cardEnv"]');   // env card is collapsed by default
    await sleep(300);
    await page.fill('#envCpu', 'Intel(R) Xeon(R) Gold 6330 CPU @ 2.00GHz × 56');
    await page.fill('#envGpu', 'NVIDIA GeForce RTX 5090 × 1');
    await page.fill('#envOs', 'Ubuntu 22.04.5 LTS');
    await page.fill('#engineName', 'ninfer');
    await page.fill('#engineModelName', 'Qwen3.8-27B-NVFP4');
    await page.fill('#envMemory', '256 GB');

    await page.click('.preset-pill[data-preset="quick"]');
    await sleep(200);
    await page.click('#startBtn');
    let finished = false;
    for (let i = 0; i < 150; i++) {
        await sleep(2000);
        const txt = await page.textContent('#statusText');
        if (/测试完成|已完成|Test finished|Done|finished|出错|Error/.test(txt)) { finished = true; break; }
    }
    check('quick run finished (7 points)', finished, await page.textContent('#statusText'));

    // i18n regression: en dict must resolve the TPOT panel title (was missing → raw key in export)
    const tpotEn = await page.evaluate(() => I18N.en['chart.tpot.title']);
    check('en resolves chart.tpot.title', tpotEn === 'TPOT (ms)', String(tpotEn));

    console.log('[2] export PNG in light / dark / en variants');
    const variants = [
        { name: 'light-zh', file: 'layout-light-zh.png', bg: [255, 255, 255] },
        { name: 'dark-zh', file: 'layout-dark-zh.png', bg: [24, 24, 27] },
        { name: 'light-en', file: 'layout-light-en.png', bg: [255, 255, 255] }
    ];
    const results = {};
    for (let vi = 0; vi < variants.length; vi++) {
        const v = variants[vi];
        if (vi === 1) {   // system → light → dark
            await page.click('#themeBtn'); await page.click('#themeBtn');
            await sleep(300);
            check('dark theme active', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
        }
        if (vi === 2) {
            await page.click('#themeBtn');   // dark → system(light)
            await page.click('#langBtn');    // zh → en
            await sleep(300);
            check('lang is en', (await page.evaluate(() => document.documentElement.lang)) !== 'zh-CN');
        }
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#exportPngBtn')]);
        const fp = path.join(SHOTS, v.file);
        await dl.saveAs(fp);

        const buf = fs.readFileSync(fp);
        const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
        const cssH = h / 2, ratio = w / h;
        check(`[${v.name}] width exactly 2880`, w === 2880, `${w}x${h}`);
        check(`[${v.name}] css height in [1030,1170]`, cssH >= 1030 && cssH <= 1170, cssH.toFixed(0));
        check(`[${v.name}] aspect ratio in [1.20,1.45]`, ratio >= 1.20 && ratio <= 1.45, ratio.toFixed(3));

        const scan = await page.evaluate(async (dataB64) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + dataB64;
            await img.decode();
            const cv = document.createElement('canvas');
            cv.width = img.width; cv.height = img.height;
            const c2 = cv.getContext('2d');
            c2.drawImage(img, 0, 0);
            const W = img.width, H = img.height;
            const cols = [];
            for (let x = 8; x < W; x += Math.floor(W / 64)) cols.push(x);
            const blank = new Array(H).fill(true);
            for (let y = 0; y < H; y++) {
                const row = c2.getImageData(0, y, W, 1).data;
                const first = row[cols[0] * 4] + ',' + row[cols[0] * 4 + 1] + ',' + row[cols[0] * 4 + 2];
                for (const x of cols) {
                    const px = row[x * 4] + ',' + row[x * 4 + 1] + ',' + row[x * 4 + 2];
                    if (px !== first) { blank[y] = false; break; }
                }
            }
            const margin = 60 * 2;                     // ignore 60 css px top/bottom
            let best = 0, run = 0, bestAt = -1;
            for (let y = margin; y < H - margin; y++) {
                run = blank[y] ? run + 1 : 0;
                if (run > best) { best = run; bestAt = y - run; }
            }
            let ink = 0;
            for (let y = H - 120; y < H; y++) if (!blank[y]) { ink++; break; }
            const bg = c2.getImageData(10, 10, 1, 1).data;
            return { maxBlankCss: best / 2, atCss: Math.round(bestAt / 2), footerInk: ink > 0, bg: [bg[0], bg[1], bg[2]] };
        }, buf.toString('base64'));

        check(`[${v.name}] no blank band (<90 css px)`, scan.maxBlankCss < 90, `max=${scan.maxBlankCss.toFixed(0)}css @y=${scan.atCss}`);
        check(`[${v.name}] footer ink near bottom`, scan.footerInk);
        check(`[${v.name}] bg matches theme surface`, JSON.stringify(scan.bg) === JSON.stringify(v.bg), `rgb(${scan.bg.join(',')})`);
        results[v.name] = { h };
    }

    console.log('[3] cross-theme layout identity');
    check('light/dark heights identical (layout is theme-independent)',
        results['light-zh'].h === results['dark-zh'].h, `${results['light-zh'].h} vs ${results['dark-zh'].h}`);
    check('zh/en heights identical (layout is language-independent)',
        results['light-zh'].h === results['light-en'].h, `${results['light-zh'].h} vs ${results['light-en'].h}`);

    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    await browser.close();
    console.log('\n' + (failures ? '✗ ' + failures + ' FAILURES' : '✓ ALL PNG-LAYOUT CHECKS PASSED'));
    process.exit(failures ? 2 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
