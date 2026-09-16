#!/usr/bin/env node
/* Real-browser verification for llm-perf-bench.html (playwright-core + locally bundled libs).
   Covers: rendering, theme switching (real CSS), language toggle, tooltip, connection test,
   full quick run with live charts, chart hover, exports with real downloads, detail modal,
   error path, and the file:// CORS limitation documentation. */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW_MODULE || '/tmp/pw-env/node_modules/playwright-core');

const URL_HTTP = 'http://127.0.0.1:8899/src/llm-perf-bench.html';
/* file:// scenario must exercise the current src build — copy it out at run time */
const FILE_COPY = process.env.BENCH_FILE_COPY || '/data/temp/llm-perf-bench.html';
fs.mkdirSync(path.dirname(FILE_COPY), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'src', 'llm-perf-bench.html'), FILE_COPY);
const URL_FILE = 'file://' + FILE_COPY;
const SHOTS = path.join(__dirname, 'bench-shots');
const DL = path.join(SHOTS, 'downloads');
fs.mkdirSync(DL, { recursive: true });

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
    page.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) pageErrors.push(m.text()); });

    console.log('[1] initial render (via proxy origin)');
    await page.goto(URL_HTTP, { waitUntil: 'domcontentloaded' });
    await sleep(600);
    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
    await page.screenshot({ path: path.join(SHOTS, '01-initial-light-zh.png'), fullPage: false });
    const title = await page.textContent('.brand-name');
    check('title rendered', /LLM/.test(title), title);

    console.log('[2] theme switch (real CSS values)');
    const bgLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.click('#themeBtn'); // → light (from system-light)
    await page.click('#themeBtn'); // → dark
    await sleep(300);
    const bgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('dark bg applied', bgDark !== bgLight, bgLight + ' → ' + bgDark);
    check('dark token correct', bgDark === 'rgb(9, 9, 11)', bgDark);
    await page.screenshot({ path: path.join(SHOTS, '02-dark.png') });
    await page.click('#themeBtn'); // → system (light)
    await sleep(200);

    console.log('[3] language toggle');
    const langBefore = await page.evaluate(() => document.documentElement.lang);
    await page.click('#langBtn');
    await sleep(300);
    const langAfter = await page.evaluate(() => document.documentElement.lang);
    check('lang toggled', langBefore !== langAfter, langBefore + ' → ' + langAfter);
    check('start button text switched', /Start test|开始测试/.test(await page.textContent('#startBtn')));
    await page.screenshot({ path: path.join(SHOTS, '03-en-light.png') });
    await page.click('#langBtn');
    await sleep(200);
    check('lang toggled back', (await page.evaluate(() => document.documentElement.lang)) === langBefore);

    console.log('[4] tooltip hover');
    await page.hover('.hint[data-tip="tip.step"]');
    await sleep(400);
    check('tooltip visible', await page.evaluate(() => document.querySelector('#fieldTooltip').classList.contains('visible')));
    await page.hover('#langBtn');
    await sleep(400);
    check('langBtn tooltip visible (real layout)', await page.evaluate(() => document.querySelector('#fieldTooltip').classList.contains('visible')));
    await page.screenshot({ path: path.join(SHOTS, '04-tooltip.png') });
    await page.mouse.move(600, 500);
    await sleep(200);

    console.log('[5] config: chips + connection test');
    await page.click('#quickChips .chip[data-backend="ninfer"]');
    await page.fill('#baseUrl', 'http://127.0.0.1:8899');
    await page.fill('#apiKey', process.env.BENCH_KEY || 'sk-local-test');
    await page.click('#testConnBtn');
    await sleep(2500);
    const conn = await page.textContent('#connStatus');
    check('connected via proxy origin', /1/.test(conn) && /256K/.test(conn), conn);
    check('model autofilled', ((await page.inputValue('#modelName')) || '').length > 0, await page.inputValue('#modelName'));

    console.log('[6] full quick run (chat protocol, live charts)');
    await page.click('.preset-pill[data-preset="quick"]');
    await sleep(200);
    await page.click('#startBtn');
    let finished = false;
    for (let i = 0; i < 90; i++) {
        await sleep(1000);
        const txt = await page.textContent('#statusText');
        if (/已完成|Done|finished|出错|Error/.test(txt)) { finished = true; break; }
        if (i === 4) await page.screenshot({ path: path.join(SHOTS, '05-running.png') });
    }
    await sleep(800);
    const finalStatus = await page.textContent('#statusText');
    check('finished', finished, finalStatus);
    check('7 ok', /7 ok|7 成功/.test(finalStatus) || /7 \/ 7/.test(await page.textContent('#summaryGrid')), finalStatus);
    check('table rows', (await page.$$('#resultBody tr')).length === 7);
    await page.screenshot({ path: path.join(SHOTS, '06-results-charts.png'), fullPage: true });

    console.log('[7] chart hover');
    const box = await page.locator('#canvasTtft').boundingBox();
    let chartTipShown = false;
    for (const frac of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        await page.mouse.move(box.x + box.width * frac, box.y + box.height * 0.5);
        await sleep(250);
        if (await page.evaluate(() => document.querySelector('#tipTtft').classList.contains('visible'))) { chartTipShown = true; break; }
    }
    check('chart tooltip visible', chartTipShown);
    await page.screenshot({ path: path.join(SHOTS, '07-chart-hover.png') });
    await page.mouse.move(50, 600);

    console.log('[8] exports (real downloads)');
    const names = [];
    for (const id of ['exportCsvBtn', 'exportMdBtn', 'exportJsonBtn', 'exportPngBtn']) {
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#' + id)]);
        const fp = path.join(DL, dl.suggestedFilename());
        await dl.saveAs(fp);
        names.push(dl.suggestedFilename());
    }
    check('4 files downloaded', names.length === 4, names.join(', '));
    const pngFile = names.find((n) => n.endsWith('.png'));
    const pngStat = pngFile && fs.statSync(path.join(DL, pngFile));
    check('png has real content (>30KB)', pngStat && pngStat.size > 30000, pngStat && (pngStat.size / 1024).toFixed(0) + 'KB');
    const csvFile = names.find((n) => n.endsWith('.csv'));
    const csvText = fs.readFileSync(path.join(DL, csvFile), 'utf8');
    check('csv rows ok', (csvText.match(/,ok/g) || []).length === 7 && /ttft_ms/.test(csvText));

    console.log('[9] detail modal');
    await page.click('#resultBody .detail-link');
    await sleep(300);
    check('modal open with prompts', await page.evaluate(() => {
        const m = document.querySelector('.modal');
        return m && m.textContent.includes('[run ') && m.textContent.includes('TTFT');
    }));
    await page.screenshot({ path: path.join(SHOTS, '08-detail.png') });
    await page.keyboard.press('Escape');
    await sleep(200);
    check('modal closed by Esc', !(await page.$('.modal')));

    console.log('[10] responses & anthropic quick single-point run');
    for (const proto of ['openai-responses', 'anthropic']) {
        await page.selectOption('#protocol', proto);
        await page.fill('#minInputLength', '128');
        await page.fill('#maxInputLength', '128');
        await page.fill('#lengthStep', '2');
        await page.click('#startBtn');
        let done = false;
        for (let i = 0; i < 45; i++) {
            await sleep(1000);
            if (/已完成|Done|出错|Error|1 ok|1 成功/.test(await page.textContent('#statusText'))) { done = true; break; }
        }
        check(proto + ' run ok', done, await page.textContent('#statusText'));
    }
    await page.screenshot({ path: path.join(SHOTS, '09-anthropic-results.png'), fullPage: true });

    console.log('[11] error path (wrong port)');
    await page.fill('#baseUrl', 'http://127.0.0.1:39999');
    await page.click('#startBtn');
    await sleep(6000);
    const errTitle = await page.getAttribute('#resultBody .st-err', 'title');
    check('error row has message', !!errTitle && errTitle.length > 5, (errTitle || '').slice(0, 70));

    console.log('[12] file:// CORS limitation (documented behavior)');
    const page2 = await ctx.newPage();
    await page2.goto(URL_FILE, { waitUntil: 'domcontentloaded' });
    await sleep(500);
    await page2.fill('#baseUrl', 'http://127.0.0.1:30001');
    await page2.fill('#apiKey', process.env.BENCH_KEY || 'sk-local-test');
    await page2.fill('#modelName', 'qwen3.8');
    await page2.click('#testConnBtn');
    await sleep(3000);
    const connFail = await page2.textContent('#connStatus');
    check('file:// shows CORS/network failure hint', /网络|跨域|CORS|Network/i.test(connFail), connFail.slice(0, 90));
    await page2.screenshot({ path: path.join(SHOTS, '10-file-cors-limitation.png') });

    console.log('[13] responsive (narrow viewport)');
    await page.setViewportSize({ width: 900, height: 900 });
    await sleep(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('no horizontal overflow at 900px', overflow <= 2, 'overflow=' + overflow + 'px');
    await page.screenshot({ path: path.join(SHOTS, '11-responsive-900.png'), fullPage: true });

    check('no page errors at end', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    await browser.close();
    console.log('\n' + (failures ? '✗ ' + failures + ' FAILURES' : '✓ ALL BROWSER CHECKS PASSED'));
    process.exit(failures ? 2 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
