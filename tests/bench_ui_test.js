#!/usr/bin/env node
/* UI-level verification for llm-perf-bench.html using jsdom + the live inference server.
   Verifies: init, theme tri-state, i18n toggle, tooltips, presets, quick chips,
   endpoint derivation, connection test, a full quick test run, table/summary,
   exports (content captured via click interception), detail dialog, abort. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_MODULE || '/tmp/jsdom-env/node_modules/jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'llm-perf-bench.html'), 'utf8');
const BASE = 'http://127.0.0.1:30001';
const KEY = process.env.BENCH_KEY || 'sk-local-test';

const pageErrors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => {
    const msg = String(e && e.message || e);
    if (/not implemented.*(navigation|scrollTo)/i.test(msg)) return; // anchor click downloads
    pageErrors.push(msg + (e && e.detail ? ' :: ' + e.detail : ''));
});
vc.on('error', (m) => pageErrors.push(String(m)));

const dom = new JSDOM(HTML, {
    url: 'http://127.0.0.1:8899/llm-perf-bench.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
        /* stub browser APIs jsdom lacks — must exist BEFORE inline scripts run */
        window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() { }, removeEventListener() { }, addListener() { }, removeListener() { } });
        window.ResizeObserver = class { observe() { } unobserve() { } disconnect() { } };
        window.HTMLCanvasElement.prototype.getContext = function () {
            const ctx = { canvas: this, measureText: () => ({ width: 10 }) };
            return new Proxy(ctx, { get: (t, k) => (k in t ? t[k] : () => { }), set: (t, k, v) => (t[k] = v, true) });
        };
        window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,STUBPNG';
        window.Path2D = class { constructor() { } addPath() { } };   // exportPng draws the GitHub mark with Path2D
        window.fetch = (u, o) => fetch(u, o);
        window.Headers = Headers; window.Request = Request; window.Response = Response;
        /* keep AbortController in the same realm as the injected Node fetch */
        window.AbortController = AbortController;
        window.AbortSignal = AbortSignal;
    },
});
const w = dom.window;
const d = w.document;
w.addEventListener('error', (e) => pageErrors.push('window error: ' + (e.message || '')));

let failures = 0;
const check = (name, cond, extra) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined && extra !== '' ? '  ' + extra : ''));
    if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => d.querySelector(s);
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const input = (el) => el.dispatchEvent(new w.Event('input', { bubbles: true }));

(async () => {
    await sleep(150); // let init() + rAF settle

    console.log('[1] init');
    check('no page JS errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    check('standard preset active', d.querySelector('.preset-pill[data-preset="standard"]').classList.contains('active'));
    check('points preview filled', $('#pointsPreview').textContent.startsWith('256'), $('#pointsPreview').textContent.slice(0, 40));
    check('points badge shows 8 (standard ladder)', $('#pointsBadge').textContent.includes('8'), $('#pointsBadge').textContent);
    check('start button present', !!$('#startBtn'));
    check('table empty hint visible', $('#tableEmpty').style.display !== 'none');
    check('summary rendered', $('#summaryGrid').children.length >= 5);

    console.log('[2] theme tri-state');
    const html = d.documentElement;
    const themeBtn = $('#themeBtn');
    check('default resolved theme set', html.getAttribute('data-theme') === 'light' || html.getAttribute('data-theme') === 'dark', html.getAttribute('data-theme'));
    click(themeBtn); await sleep(20);
    const pref2 = w.localStorage.getItem('lbp.theme');
    check('1st click → light', pref2 === 'light', String(pref2));
    check('data-theme light', html.getAttribute('data-theme') === 'light');
    click(themeBtn); await sleep(20);
    check('2nd click → dark', w.localStorage.getItem('lbp.theme') === 'dark');
    check('data-theme dark', html.getAttribute('data-theme') === 'dark');
    click(themeBtn); await sleep(20);
    check('3rd click → back to system', w.localStorage.getItem('lbp.theme') === 'system');

    console.log('[3] language toggle');
    const langBtn = $('#langBtn');
    const langBefore = html.getAttribute('lang');
    click(langBtn); await sleep(30);
    const langAfter = html.getAttribute('lang');
    check('lang attr switched', langBefore !== langAfter, langBefore + ' → ' + langAfter);
    check('start button text switched', /Start test|开始测试/.test($('#startBtn').textContent), $('#startBtn').textContent);
    check('table header switched', /Target in|目标输入/.test(d.querySelector('#resultTable th:nth-child(2)').textContent));
    click(langBtn); await sleep(30);
    check('lang toggled back', html.getAttribute('lang') === langBefore);

    console.log('[4] tooltip');
    const hint = d.querySelector('.hint[data-tip="tip.step"]');
    hint.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    await sleep(20);
    const tip = $('#fieldTooltip');
    check('tooltip visible on hover', tip.classList.contains('visible'));
    check('tooltip content from key', tip.textContent.includes('倍增') || tip.textContent.includes('multiplier'), tip.textContent.slice(0, 30));
    check('aria-describedby set', hint.getAttribute('aria-describedby') === 'fieldTooltip');
    d.body.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    await sleep(20);
    check('tooltip hidden on leave', !tip.classList.contains('visible'));

    // lang/theme buttons share the same data-tip mechanism (T13)
    const langBtnTip = $('#langBtn'), themeBtnTip = $('#themeBtn');
    langBtnTip.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    await sleep(20);
    check('langBtn tooltip visible', tip.classList.contains('visible'));
    check('langBtn tooltip localized', tip.textContent.includes('切换语言') || tip.textContent.includes('Switch language'), tip.textContent.slice(0, 24));
    d.body.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    themeBtnTip.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    await sleep(20);
    check('themeBtn tooltip visible', tip.classList.contains('visible'));
    check('themeBtn has no native title (single tooltip source)', !themeBtnTip.title);
    d.body.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));

    // repo footer link derives from the single GITHUB_REPO_URL constant (T13)
    const repo = $('#repoLink');
    check('repo link href set', /^https:\/\/github\.com\//.test(repo.href), repo.href);
    check('repo link opens new tab safely', repo.target === '_blank' && repo.rel.includes('noopener'));
    check('repo link text derived from href', $('#repoLinkText').textContent === repo.href.replace(/^https?:\/\//, ''));

    // exported PNG masks public endpoints, keeps private http:// as-is (T16)
    const mask = (u) => w.eval('maskEndpointForExport(' + JSON.stringify(u) + ')');
    check('keep loopback http', mask('http://127.0.0.1:8899/ninfer') === 'http://127.0.0.1:8899/ninfer');
    check('keep private-lan http', mask('http://10.10.10.195:8899/v1') === 'http://10.10.10.195:8899/v1');
    check('keep 192.168 http', mask('http://192.168.1.5:8000/v1') === 'http://192.168.1.5:8000/v1');
    check('mask https domain', mask('https://api.openai.com/v1/chat/completions') === 'https://***/v1/chat/completions');
    check('mask http domain', mask('http://my-server.example.com:8080/v1') === 'http://***/v1');
    check('mask public http ip', mask('http://8.8.8.8:11434/v1') === 'http://***/v1');
    check('mask https ip', mask('https://1.2.3.4/v1') === 'https://***/v1');
    check('keep localhost http', mask('http://localhost:3000/v1') === 'http://localhost:3000/v1');

    console.log('[5] presets & endpoint derivation');
    click(d.querySelector('.preset-pill[data-preset="quick"]')); await sleep(20);
    check('quick preset fills fields', $('#minInputLength').value === '128' && $('#maxInputLength').value === '8192' && $('#maxOutputLength').value === '64');
    check('points badge 7', $('#pointsBadge').textContent.includes('7'), $('#pointsBadge').textContent);
    check('preset pills icon-only with aria labels', Array.from(d.querySelectorAll('.preset-pill')).every((p) => (p.getAttribute('aria-label') || '').length > 1));
    $('#maxInputLength').value = '1024'; input($('#maxInputLength')); await sleep(20);
    check('manual edit flips to custom', d.querySelector('.preset-pill[data-preset="custom"]').classList.contains('active'));

    // scenario presets: pure geometric, exact endpoints, staggered mins
    click(d.querySelector('.preset-pill[data-preset="agent"]')); await sleep(20);
    check('agent preview 9 pts 512→128K', $('#pointsPreview').textContent.split('·').length === 9 && $('#pointsPreview').textContent.startsWith('512') && /128K/.test($('#pointsPreview').textContent), $('#pointsPreview').textContent.slice(0, 70));
    check('agent meta shows ×2 geometric', /×2|×2/.test($('#previewMeta').textContent), $('#previewMeta').textContent.slice(0, 40));
    check('agent timeout 1800', $('#requestTimeout').value === '1800');
    $('#minInputLength').value = '640'; input($('#minInputLength')); await sleep(20);
    check('edit flips to custom', d.querySelector('.preset-pill[data-preset="custom"]').classList.contains('active'));
    check('coding pill exists', !!d.querySelector('.preset-pill[data-preset="coding"]'));
    check('chat pill exists', !!d.querySelector('.preset-pill[data-preset="chat"]'));

    const chip = d.querySelector('#quickChips .chip[data-backend="ninfer"]');
    click(chip); await sleep(20);
    check('proxy mode on by default (http page)', $('#proxyMode').checked === true);
    check('chip fills proxied baseUrl', $('#baseUrl').value === 'http://127.0.0.1:8899/ninfer', $('#baseUrl').value);
    check('chip active state', chip.classList.contains('active'));
    check('derived endpoint (proxied)', $('#derivedEndpointText').textContent === 'http://127.0.0.1:8899/ninfer/v1/chat/completions', $('#derivedEndpointText').textContent);
    click($('#proxyMode')); await sleep(20);   // toggle proxy off
    check('toggle rewrites to direct', $('#baseUrl').value === 'http://127.0.0.1:30001', $('#baseUrl').value);
    check('chip still active (direct form matches)', chip.classList.contains('active'));
    click($('#proxyMode')); await sleep(20);   // toggle back on
    check('toggle rewrites back to proxied', $('#baseUrl').value === 'http://127.0.0.1:8899/ninfer', $('#baseUrl').value);
    $('#baseUrl').value = 'http://my-custom-host:9999'; input($('#baseUrl')); await sleep(10);
    check('custom url clears chip active', !chip.classList.contains('active'));
    $('#proxyMode').checked = false; $('#proxyMode').dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(10);
    check('custom url untouched by toggle', $('#baseUrl').value === 'http://my-custom-host:9999');

    $('#baseUrl').value = BASE + '/v1/messages'; input($('#baseUrl')); await sleep(10);
    check('full endpoint paste normalized', $('#derivedEndpointText').textContent === BASE + '/v1/chat/completions');
    $('#protocol').value = 'anthropic'; input($('#protocol')); await sleep(20);
    check('protocol switch → /v1/messages', $('#derivedEndpointText').textContent === BASE + '/v1/messages');
    check('protocol desc updated', $('#protocolDesc').textContent.includes('Claude') || $('#protocolDesc').textContent.includes('Messages'));

    // guided validation: incomplete input → sidebar expands + field highlight (no blocking modal)
    $('#baseUrl').value = ''; input($('#baseUrl')); await sleep(10);
    $('#modelName').value = ''; input($('#modelName')); await sleep(10);
    click($('#sidebarToggle')); await sleep(10);
    check('guided: collapsed before start', $('#configCol').classList.contains('collapsed'));
    click($('#startBtn')); await sleep(50);
    check('guided: sidebar auto-expands', !$('#configCol').classList.contains('collapsed'));
    check('guided: baseUrl field highlighted', !!d.querySelector('.field-error #baseUrl, .field-error'));
    check('guided: no blocking modal', !d.querySelector('.modal'));
    check('guided: banner explains missing fields', !d.getElementById('sideBanner').hidden && d.getElementById('sideBanner').textContent.includes('Base URL'), d.getElementById('sideBanner').textContent.slice(0, 60));
    $('#baseUrl').value = 'http://127.0.0.1:8899/ninfer'; input($('#baseUrl')); await sleep(10);
    $('#modelName').value = ''; input($('#modelName')); await sleep(10);
    check('guided: baseUrl highlight clears on edit', !d.querySelector('#baseUrl').closest('.field').classList.contains('field-error'));
    check('guided: banner clears on edit', d.getElementById('sideBanner').hidden);

    console.log('[6] connection test & model fetch (live server)');
    $('#apiKey').value = KEY; input($('#apiKey'));
    click($('#testConnBtn'));
    await sleep(2500);
    const connText = $('#connStatus').textContent;
    check('connection ok', $('#connStatus').classList.contains('ok'), connText);
    check('shows model count & ctx', /1/.test(connText) && /256K|262144/.test(connText), connText);
    check('model auto-filled (single model server)', $('#modelName').value === 'Qwen3.8-27B-NVFP4', $('#modelName').value);
    check('datalist filled', $('#modelList').children.length === 1);

    // context-cap auto-clamp: coding's 256K point must be clamped once the limit (262144) is known
    click(d.querySelector('.preset-pill[data-preset="coding"]')); await sleep(20);
    check('coding clamp note visible', $('#previewWarn').classList.contains('visible') && /钳制|clamp/i.test($('#previewWarn').textContent), $('#previewWarn').textContent.slice(0, 70));
    check('coding last point clamped 256K→254.9K', /254\.9K|255K/.test($('#pointsPreview').textContent) && !$('#pointsPreview').textContent.includes('256K'), $('#pointsPreview').textContent.slice(-60));

    console.log('[7] full quick test run (live, chat protocol)');
    $('#protocol').value = 'openai-completions'; input($('#protocol')); await sleep(10);
    click(d.querySelector('.preset-pill[data-preset="quick"]')); await sleep(10);
    const captured = [];
    d.addEventListener('click', (e) => { if (e.target && e.target.tagName === 'A' && e.target.download) captured.push({ name: e.target.download, href: e.target.href }); }, true);
    click($('#startBtn'));
    await sleep(1200);
    check('progress fill layer rendered in stop button', !!$('#startBtn .btn-pfill'));
    check('stop label carries point counter', /停止|Stop/.test($('#startBtn').textContent) && /\d+\/\d+/.test($('#startBtn').textContent), $('#startBtn').textContent);
    let done = false, prevP = -1, monotonic = true, progressMoved = false;
    for (let i = 0; i < 120; i++) {
        const pRaw = $('#startBtn').style.getPropertyValue('--p');
        if (pRaw) {
            const p = parseFloat(pRaw);
            if (isFinite(p)) { if (p < prevP - 0.001) monotonic = false; prevP = p; if (p > 0) progressMoved = true; }
        }
        await sleep(1000);
        const pill = $('#statusText').textContent;
        if (/已完成|Done|出错|Error|已中止|Aborted/.test(pill) && !$('#startBtn').textContent.match(/停止|Stop/)) { done = true; break; }
        if ($('#startBtn').textContent.match(/开始|Start/)) { done = true; break; }
    }
    await sleep(300);
    check('progress bar advanced during the run', progressMoved, 'max=' + prevP + '%');
    check('progress monotonically non-decreasing', monotonic, 'last=' + prevP + '%');
    check('progress cleared after run', !$('#startBtn').style.getPropertyValue('--p'));
    check('label restored to start', /开始|Start/.test($('#startBtn .btn-plabel').textContent));
    check('test completed', done, $('#statusText').textContent);
    check('7 result rows', d.querySelectorAll('#resultBody tr').length === 7, String(d.querySelectorAll('#resultBody tr').length));
    check('row cells numeric', /\d/.test(d.querySelector('#resultBody tr td:nth-child(4)').textContent), d.querySelector('#resultBody tr td:nth-child(4)').textContent);
    check('summary points updated', $('#summaryGrid').textContent.includes('7 / 7'));
    check('no page errors after run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

    console.log('[8] exports');
    click($('#exportCsvBtn')); await sleep(100);
    click($('#exportMdBtn')); await sleep(100);
    click($('#exportJsonBtn')); await sleep(100);
    click($('#exportPngBtn')); await sleep(100);
    check('4 downloads triggered', captured.length === 4, JSON.stringify(captured.map((c) => c.name)));
    const csv = captured.find((c) => c.name.endsWith('.csv'));
    check('csv filename pattern', csv && /llm-perf.*\.csv$/.test(csv.name), csv && csv.name);
    const csvContent = decodeURIComponent(csv.href.replace(/^data:text\/csv;charset=utf-8,/, ''));
    check('csv has header + 7 rows + cols', csvContent.split('\n').length >= 6 && csvContent.includes('ttft_ms') && (csvContent.match(/,ok/g) || []).length === 7);
    const json = captured.find((c) => c.name.endsWith('.json'));
    const jsonContent = decodeURIComponent(json.href.replace(/^data:application\/json;charset=utf-8,/, ''));
    const parsed = JSON.parse(jsonContent);
    check('json valid with meta+7 results', parsed.meta && parsed.results.length === 7 && parsed.results[0].user.startsWith('[run '));
    check('json has protocol+endpoint', parsed.meta.protocol === 'openai-completions' && /\/v1\/chat\/completions$/.test(parsed.meta.endpoint));
    const png = captured.find((c) => c.name.endsWith('.png'));
    check('png download present', !!png);

    console.log('[9] detail dialog');
    click(d.querySelector('#resultBody .detail-link'));
    await sleep(50);
    const modal = d.querySelector('.modal');
    check('detail modal open', !!modal);
    check('modal shows prompt blocks', modal.textContent.includes('[run ') || modal.textContent.includes('You are an assistant.'));
    check('modal shows TTFT value', /TTFT/.test(modal.textContent));
    modal.querySelector('.modal-actions button').click();
    await sleep(50);
    check('modal closed', !d.querySelector('.modal'));

    console.log('[10] abort mid-test');
    click(d.querySelector('.preset-pill[data-preset="standard"]')); await sleep(10);
    click($('#startBtn'));
    let sawProgress = false;
    for (let i = 0; i < 40; i++) {   // wait until at least the first point finished
        await sleep(1000);
        if (/[1-9]\/8/.test($('#statusText').textContent)) { sawProgress = true; break; }
    }
    check('test progressing before stop', sawProgress, $('#statusText').textContent);
    click($('#startBtn')); // stop
    await sleep(2000);
    check('status shows aborted', /已中止|Aborted/.test($('#statusText').textContent), $('#statusText').textContent);
    check('config unlocked', !$('#configCol').classList.contains('locked'));

    console.log('[11] error path UI (wrong port)');
    click(d.querySelector('.preset-pill[data-preset="quick"]')); await sleep(10);
    $('#baseUrl').value = 'http://127.0.0.1:39999'; input($('#baseUrl')); await sleep(10);
    $('#repeatCount').value = '1'; input($('#repeatCount')); await sleep(10);
    click($('#startBtn'));
    let doneErr = false;
    for (let i = 0; i < 45; i++) {
        await sleep(1000);
        if ($('#startBtn').textContent.match(/开始|Start/)) { doneErr = true; break; }
    }
    check('run finished with errors', doneErr);
    const errCells = Array.from(d.querySelectorAll('#resultBody .st-err'));
    check('fatal config error stops after first row', errCells.length === 1, String(errCells.length));
    check('error tooltip has message', (errCells[0].getAttribute('title') || '').length > 3, errCells[0].getAttribute('title'));
    check('fatal stop: sidebar guided open', !$('#configCol').classList.contains('collapsed'));
    check('fatal stop: baseUrl highlighted (kind=network)', !!d.querySelector('.field-error #baseUrl'));
    check('fatal stop: banner shows reason', !d.getElementById('sideBanner').hidden && d.getElementById('sideBanner').textContent.length > 10);

    console.log('[11b] guidance auto-clear: fix via chip (programmatic) + rerun to success');
    click(d.querySelector('#quickChips .chip[data-backend="ninfer"]')); await sleep(10);
    const chipUrl = $('#baseUrl').value;
    check('chip sets working url', /8899\/ninfer|30001/.test(chipUrl), chipUrl);
    check('chip clears field highlight', !d.querySelector('.field-error'));
    check('chip clears banner', d.getElementById('sideBanner').hidden);
    click($('#startBtn'));
    let doneFix = false;
    for (let i = 0; i < 45; i++) {
        await sleep(1000);
        if ($('#startBtn').textContent.match(/开始|Start/)) { doneFix = true; break; }
    }
    check('rerun finished', doneFix, $('#statusText').textContent);
    check('rerun all ok', $('#summaryGrid').textContent.includes('7 / 7'), $('#summaryGrid').textContent.match(/\d+ \/ \d+/)?.[0]);
    check('auto-clear after successful round: no field highlights', !d.querySelector('.field-error'));
    check('auto-clear after successful round: banner hidden', d.getElementById('sideBanner').hidden);

    console.log('[12] persistence');
    await sleep(400); // debounce save
    const saved = JSON.parse(w.localStorage.getItem('lbp.cfg.v1'));
    check('config persisted', saved && saved.baseUrl === chipUrl);
    check('api key NOT persisted', saved.apiKey === undefined || !('apiKey' in saved));
    check('preset persisted (quick was last selected)', saved.__preset === 'quick', String(saved.__preset));

    console.log('\n' + (failures ? '✗ ' + failures + ' FAILURES' : '✓ ALL UI CHECKS PASSED'));
    process.exit(failures ? 2 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
