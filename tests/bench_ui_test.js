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
const BASE = process.env.BENCH_BASE || 'http://127.0.0.1:30001';
const MODEL = process.env.BENCH_MODEL || 'Qwen3.8-27B-NVFP4';
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
    check('keep private-lan http', mask('http://10.1.2.3:8899/v1') === 'http://10.1.2.3:8899/v1');
    check('keep 192.168 http', mask('http://192.168.1.5:8000/v1') === 'http://192.168.1.5:8000/v1');
    check('mask https domain (partial T52)', mask('https://api.openai.com/v1/chat/completions') === 'https://ap***om/v1/chat/completions', mask('https://api.openai.com/v1/chat/completions'));
    check('mask http domain keeps port (partial T52)', mask('http://my-server.example.com:8080/v1') === 'http://my***om:8080/v1', mask('http://my-server.example.com:8080/v1'));
    check('mask public http ip (partial T52)', mask('http://8.8.8.8:11434/v1') === 'http://8.***.8:11434/v1', mask('http://8.8.8.8:11434/v1'));
    check('mask https ip (partial T52)', mask('https://1.2.3.4/v1') === 'https://1.***.4/v1', mask('https://1.2.3.4/v1'));
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
    check('model auto-filled (single model server)', $('#modelName').value === MODEL, $('#modelName').value);
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

    console.log('[13] cloud-origin behavior (Worker origin, /api/health reachable) — T28');
    const mkCloudDom = (preseedCfg, hooks) => {
        const errs = [];
        const vc2 = new VirtualConsole();
        vc2.on('jsdomError', (e) => errs.push(String(e && e.message || e)));
        vc2.on('error', (m) => errs.push(String(m)));
        const dom2 = new JSDOM(HTML, {
            url: 'http://llm-perf-bench.example.workers.dev/src/llm-perf-bench.html',
            runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc2,
            beforeParse(win) {
                win.matchMedia = () => ({ matches: false, media: '', addEventListener() { }, removeEventListener() { }, addListener() { }, removeListener() { } });
                win.ResizeObserver = class { observe() { } unobserve() { } disconnect() { } };
                win.HTMLCanvasElement.prototype.getContext = function () {
                    const ctx = { canvas: this, measureText: () => ({ width: 10 }) };
                    return new Proxy(ctx, { get: (t, k) => (k in t ? t[k] : () => { }), set: (t, k, v) => (t[k] = v, true) });
                };
                win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,STUBPNG';
                win.Path2D = class { constructor() { } addPath() { } };
                win.Headers = Headers; win.Request = Request; win.Response = Response;
                win.AbortController = AbortController; win.AbortSignal = AbortSignal;
                win.fetch = (u, o) => {
                    const us = String(u);
                    if (us.includes('/api/health')) {
                        return Promise.resolve(new Response(JSON.stringify({ ok: true, ts: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }));
                    }
                    if (hooks && hooks.onSubmit && us.includes('/api/leaderboard/submit')) {
                        hooks.onSubmit({ url: us, body: o && o.body });
                        return Promise.resolve(new Response(JSON.stringify({ ok: true, estRank: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }));
                    }
                    return fetch(u, o);
                };
                if (preseedCfg) win.localStorage.setItem('lbp.cfg.v1', JSON.stringify(preseedCfg));
            },
        });
        return { dom: dom2, errs };
    };
    {
        const { dom: dom2, errs } = mkCloudDom();
        const w2 = dom2.window, d2 = w2.document;
        await sleep(250); // probe + applyCloudOrigin settle
        check('cloud: no page JS errors', errs.length === 0, errs.slice(0, 2).join(' | '));
        const pm2 = d2.getElementById('proxyMode');
        check('cloud: proxy checkbox disabled', pm2.disabled === true);
        check('cloud: proxy checkbox unchecked', pm2.checked === false);
        const note2 = d2.getElementById('cloudOriginNote');
        check('cloud: guidance note visible', !!note2 && note2.hidden === false && note2.textContent.length > 10, String(note2 && note2.hidden) + '/' + String(note2 && note2.textContent.length));
        check('cloud: note mentions Local Network Access', !!note2 && /Local Network Access/i.test(note2.textContent));
        dom2.window.close();
    }
    {
        // persisted proxied chip URL is rewritten back to direct form on next load
        const { dom: dom3 } = mkCloudDom({ baseUrl: 'http://llm-perf-bench.example.workers.dev/ninfer', proxyMode: true });
        await sleep(250);
        const d3 = dom3.window.document;
        const pm3 = d3.getElementById('proxyMode');
        check('cloud reload: proxied chip url rewritten to direct', /^http:\/\/127\.0\.0\.1:30001/.test(d3.getElementById('baseUrl').value), d3.getElementById('baseUrl').value);
        check('cloud reload: proxy off+disabled', pm3.checked === false && pm3.disabled === true);
        d3.querySelector('#quickChips .chip[data-backend="ninfer"]').dispatchEvent(new dom3.window.MouseEvent('click', { bubbles: true }));
        check('cloud reload: chip click keeps direct url', d3.getElementById('baseUrl').value === 'http://127.0.0.1:30001', d3.getElementById('baseUrl').value);
        dom3.window.close();
    }
    // control branch: on the 8899 origin (probe fails) the note stays hidden — covered implicitly in [1]-[11b]
    check('control: cloud note hidden on non-worker origin', d.getElementById('cloudOriginNote').hidden === true);

    console.log('[14] i18n dictionary symmetry (automated — LESSONS L-001)');
    {
        // line-based extraction of "key": occurrences per dictionary section
        const lines = HTML.split('\n');
        const idxZh = lines.findIndex((l) => /const I18N = \{/.test(l));
        const idxEn = lines.findIndex((l) => /^\s+en: \{/.test(l));
        check('I18N sections found', idxZh >= 0 && idxEn > idxZh, `zh@${idxZh} en@${idxEn}`);
        const keysOf = (from, to) => {
            const set = new Set();
            for (let i = from; i < to; i++) {
                const m = lines[i].match(/^\s+"([^"]+)":\s/);
                if (m) set.add(m[1]);
            }
            return set;
        };
        // zh dict: after `zh: {` line until `en: {` line; en dict: after `en: {` until I18N closing `};`
        const zhOpen = lines.findIndex((l, i) => i > idxZh && /^\s+zh: \{/.test(l));
        let enClose = idxEn;
        while (enClose < lines.length && !/^\s+\}\s*$/.test(lines[enClose])) enClose++;
        const zhKeys = keysOf(zhOpen + 1, idxEn);
        const enKeys = keysOf(idxEn + 1, enClose);
        check('both dictionaries non-trivial', zhKeys.size > 150 && enKeys.size > 150, `zh=${zhKeys.size} en=${enKeys.size}`);
        const onlyZh = [...zhKeys].filter((k) => !enKeys.has(k));
        const onlyEn = [...enKeys].filter((k) => !zhKeys.has(k));
        check('zh/en key sets identical (diff = ∅)', onlyZh.length === 0 && onlyEn.length === 0, `onlyZh=[${onlyZh.slice(0, 5)}] onlyEn=[${onlyEn.slice(0, 5)}]`);
        check('board.* family present on both sides (T38)', zhKeys.has('board.title') && enKeys.has('board.submit.ok') && zhKeys.has('a11y.boardBtn'));
        console.log(`  (dictionary sizes: zh=${zhKeys.size}, en=${enKeys.size})`);
    }

    console.log('[15] board submit chain — whitelist payload + refIn rule + degrade (T39)');
    check('main(8899) origin: board button hidden (capability off)', d.getElementById('boardSubmitBtn').hidden === true);
    {
        const captured = [];
        const { dom: domC, errs: errsC } = mkCloudDom(null, { onSubmit: (x) => captured.push(x) });
        const wC = domC.window, dC = wC.document;
        await sleep(250); // probe settles, board button becomes visible
        check('cloud: board button visible', dC.getElementById('boardSubmitBtn').hidden === false);
        dC.getElementById('boardSubmitBtn').click(); await sleep(30);
        check('no run yet → noResult toast', Array.from(dC.querySelectorAll('#toasts .toast')).some((x) => /完成一次测试|Run a test first/.test(x.textContent)));
        // real quick run against the live backend (chip ninfer + quick preset)
        dC.querySelector('#quickChips .chip[data-backend="ninfer"]').dispatchEvent(new wC.MouseEvent('click', { bubbles: true }));
        const keyIn = dC.getElementById('apiKey');
        if (keyIn) { keyIn.value = KEY; keyIn.dispatchEvent(new wC.Event('input', { bubbles: true })); }
        const modelIn = dC.getElementById('modelName');
        if (modelIn) { modelIn.value = MODEL; modelIn.dispatchEvent(new wC.Event('input', { bubbles: true })); }
        dC.querySelector('.preset-pill[data-preset="quick"]').dispatchEvent(new wC.MouseEvent('click', { bubbles: true }));
        await sleep(30);
        dC.getElementById('startBtn').click();
        let doneRun = false;
        for (let i = 0; i < 120; i++) {
            await sleep(1000);
            if (/开始测试|Start/.test(dC.getElementById('startBtn').textContent)) { doneRun = true; break; }
        }
        check('cloud: quick run finished against live backend', doneRun, dC.getElementById('statusText').textContent);
        check('cloud: board button enabled after run', dC.getElementById('boardSubmitBtn').disabled === false);
        dC.getElementById('boardSubmitBtn').click(); await sleep(50);
        const modalC = dC.querySelector('.modal');
        check('cloud: preview modal open', !!modalC);
        const modalText = modalC ? modalC.textContent : '';
        check('preview shows epClass label, not raw URL', /local:ninfer/.test(modalText) && !/127\.0\.0\.1:30001/.test(modalText));
        check('preview shows sanitized metrics', /tok\/s/.test(modalText) && /ms/.test(modalText));
        const nickIn = dC.querySelector('#boardNickInput');
        check('preview has nickname input (T50)', !!nickIn && nickIn.maxLength === 16);
        if (nickIn) { nickIn.value = '云端昵称'; nickIn.dispatchEvent(new wC.Event('input', { bubbles: true })); }
        const btnsC = modalC ? Array.from(modalC.querySelectorAll('.modal-actions button')) : [];
        const confirmBtn = btnsC.find((b) => /确认提交|Confirm submit/.test(b.textContent));
        check('confirm button present', !!confirmBtn);
        if (confirmBtn) { confirmBtn.click(); await sleep(80); }
        check('payload captured exactly once', captured.length === 1, String(captured.length));
        if (captured[0]) {
            const p = JSON.parse(captured[0].body);
            const expectedKeys = ['uuid', 'name', 'proto', 'preset', 'model', 'gpu', 'engine', 'engineModel', 'os', 'epClass', 'decode', 'prefill', 'ttft', 'tpot', 'e2e', 'refIn'].sort();
            check('payload keys exactly = client whitelist', JSON.stringify(Object.keys(p).sort()) === JSON.stringify(expectedKeys), JSON.stringify(Object.keys(p).sort()));
            check('no apiKey key nor value in payload', !('apiKey' in p) && !JSON.stringify(p).includes(KEY));
            check('no prompt/output fields in payload', !('sys' in p) && !('user' in p) && !('visText' in p) && !('reaText' in p) && !('serverTimings' in p));
            check('refIn = 1024 (quick preset geometric middle, plan §3.4 rule)', p.refIn === 1024, String(p.refIn));
            check('epClass = local:ninfer (private host + known port)', p.epClass === 'local:ninfer', p.epClass);
            check('uuid is v4', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.uuid));
            check('metrics numeric and sane', typeof p.decode === 'number' && p.decode > 0 && typeof p.prefill === 'number' && typeof p.ttft === 'number' && p.ttft > 0);
            check('uid persisted to lbp.uid', /^[0-9a-f-]{36}$/.test(wC.localStorage.getItem('lbp.uid') || ''));
            check('nickname from preview input persisted & sent', wC.localStorage.getItem('lbp.nick') === '云端昵称' && p.name === '云端昵称', String(p.name));
            check('submit ok toast with estimated rank', Array.from(dC.querySelectorAll('#toasts .toast')).some((x) => /估算名次|estimated rank/i.test(x.textContent)));
        }
        check('cloud run: no page JS errors', errsC.length === 0, errsC.slice(0, 2).join(' | '));
        check('rate-limited toasts localized (T78): keys both dicts + code maps kind', /"board\.submit\.rateLimited"/.test(HTML) && /"board\.submit\.rateLimited"/.test(HTML.replace(/[\s\S]*?"err\.noBase"/, '')) === false ? false : (HTML.match(/"board\.submit\.rateLimited"/g) || []).length === 2 && HTML.includes("j.error.kind === 'rate_limited'"));
        domC.window.close();
    }

    console.log('[16] leaderboard modal — topbar button, tabs/a11y, states, my-rank, XSS (T40/T41)');
    check('main(8899) origin: topbar board button ALWAYS visible (T74)', d.getElementById('boardBtn').hidden === false);
    click(d.getElementById('boardBtn')); await sleep(60);
    check('non-worker origin: board modal opens in offline state (T74)', d.querySelector('.board-state[data-state="offline"]') !== null);
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(20);
    {
        const MY = 'cccc4567-e89b-42d3-a456-426614174ccc';
        const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2<\/script>';
        const entriesFor = (preset, metric) => ({
            ok: true, metric, preset, limit: 50,
            entries: [
                { rank: 1, uuid: 'dddd4567-e89b-42d3-a456-426614174ddd', name: XSS, model: 'Qwen3.8-27B-NVFP4', gpu: 'RTX 5090', ts: 1789600000000, decode: 88.8, prefill: 3200.5, ttft: 210.4 },
                { rank: 2, uuid: MY, name: 'me', model: 'Qwen3.8-27B-NVFP4', gpu: 'RTX 4090', ts: 1789600000000, decode: 55.5, prefill: 2400, ttft: 312.7 },
                { rank: 3, uuid: 'eeee4567-e89b-42d3-a456-426614174eee', name: 'bob', model: 'Llama-70B', gpu: 'H100', ts: 1789600000000, decode: 40.2, prefill: 1800, ttft: 480.1 },
            ],
        });
        let listCalls = [];
        let listMode = 'ok';
        const { dom: domD } = mkCloudDom(null, {
            onSubmit: () => {},
        });
        const wD = domD.window, dD = wD.document;
        // extend fetch: board list interception (replaces generic passthrough via extra shim layer)
        const realFetch = wD.fetch;
        wD.fetch = (u, o) => {
            const us = String(u);
            if (us.includes('/api/leaderboard?') || (us.includes('/api/leaderboard') && (!o || o.method === undefined || o.method === 'GET')) && !us.includes('submit')) {
                listCalls.push(us);
                if (listMode === 'reject') return Promise.reject(new TypeError('network down'));
                if (listMode === 'slow') {
                    const p2 = (us.match(/preset=([a-z]+)/) || [])[1] || 'standard';
                    const m2 = (us.match(/metric=([a-z]+)/) || [])[1] || 'decode';
                    return new Promise((res) => setTimeout(() => res(new Response(JSON.stringify(entriesFor(p2, m2)), { status: 200, headers: { 'content-type': 'application/json' } })), 300));
                }
                if (listMode === 'apierr') return Promise.resolve(new Response(JSON.stringify({ ok: false, error: { kind: 'kv_unavailable', msg: 'boom' } }), { status: 500, headers: { 'content-type': 'application/json' } }));
                if (listMode === 'empty') return Promise.resolve(new Response(JSON.stringify({ ok: true, entries: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
                const preset = (us.match(/preset=([a-z]+)/) || [])[1] || 'standard';
                const metric = (us.match(/metric=([a-z]+)/) || [])[1] || 'decode';
                return Promise.resolve(new Response(JSON.stringify(entriesFor(preset, metric)), { status: 200, headers: { 'content-type': 'application/json' } }));
            }
            return realFetch(u, o);
        };
        // preseed MY uuid as this browser's identity
        wD.localStorage.setItem('lbp.uid', MY);
        await sleep(300); // probe + board buttons settle
        const topBtn = dD.getElementById('boardBtn');
        check('cloud: topbar board button visible', topBtn.hidden === false);
        topBtn.click(); await sleep(80);
        const ov = dD.querySelector('.modal-overlay .board-modal');
        check('board modal opens with dialog role', !!ov && ov.getAttribute('role') === 'dialog' && ov.getAttribute('aria-modal') === 'true');
        const tabEls = Array.from(dD.querySelectorAll('.board-tabs [role="tab"]'));
        check('three metric tabs (tablist)', tabEls.length === 3 && dD.querySelector('.board-tabs').getAttribute('role') === 'tablist');
        check('decode tab selected first', tabEls[0].getAttribute('aria-selected') === 'true' && tabEls[0].dataset.metric === 'decode');
        await sleep(80); // first load
        const rows = () => Array.from(dD.querySelectorAll('.board-row:not(.head)'));
        check('three entries rendered', rows().length === 3, String(rows().length));
        check('header row present with 6 cols', dD.querySelectorAll('.board-row.head span').length === 6);
        check('my row highlighted (uuid match)', (() => { const m = dD.querySelector('.board-row.mine'); return !!m && /me/.test(m.textContent); })());
        check('my rank line shows rank 2', /2/.test(dD.getElementById('boardMine').textContent) && /第 2 名|Rank #2/.test(dD.getElementById('boardMine').textContent), dD.getElementById('boardMine').textContent);
        check('XSS nickname rendered as text (no img/script elements)', (() => {
            const first = rows()[0];
            return !!first && first.querySelector('img') === null && first.querySelector('script') === null
                && first.querySelector('.nm').textContent.includes('<img');
        })());
        check('XSS payload did not execute', wD.__xss === undefined);
        // tab keyboard navigation
        tabEls[0].focus();
        tabEls[0].dispatchEvent(new wD.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await sleep(80);
        check('ArrowRight switches to prefill tab', dD.getElementById('board-tab-prefill').getAttribute('aria-selected') === 'true');
        check('switch triggers refetch with metric=prefill', listCalls.some((u) => u.includes('metric=prefill')));
        // preset chip filter
        dD.querySelector('.board-sub .chip[data-preset="agent"]').click(); await sleep(80);
        check('preset chip refetch with preset=agent', listCalls.some((u) => u.includes('preset=agent')));
        // empty state
        listMode = 'empty'; listCalls = [];
        dD.getElementById('boardRefresh').click(); await sleep(80);
        check('empty state shown', dD.querySelector('.board-state[data-state="empty"]') !== null);
        // api error state
        listMode = 'apierr';
        dD.getElementById('boardRefresh').click(); await sleep(80);
        check('error state shown with msg', (() => { const el = dD.querySelector('.board-state[data-state="error"]'); return !!el && /boom/.test(el.textContent); })());
        // offline state (network reject)
        listMode = 'reject';
        dD.getElementById('boardRefresh').click(); await sleep(80);
        check('offline state on network reject', dD.querySelector('.board-state[data-state="offline"]') !== null);
        // my-rank outside top N + loading state (RECON-P4 P3 gaps)
        listMode = 'slow'; listCalls = [];
        dD.getElementById('boardRefresh').click();
        await sleep(60);
        check('loading state during in-flight fetch', dD.querySelector('.board-state[data-state="loading"]') !== null);
        await sleep(400);
        check('list restores after slow fetch', dD.querySelectorAll('.board-row:not(.head)').length === 3);
        // my uuid absent from board → mine shows outside-top-N
        wD.localStorage.setItem('lbp.uid', 'ffff4567-e89b-42d3-a456-426614174fff');
        dD.getElementById('boardRefresh').click(); await sleep(420);   // listMode still 'slow' (300ms)
        check('my-rank outside top (limit-aware, zh 榜外 50+ / en Outside top 50)', /50/.test(dD.getElementById('boardMine').textContent) && !dD.querySelector('.board-row.mine'), dD.getElementById('boardMine').textContent);
        wD.localStorage.setItem('lbp.uid', MY);
        // T50: nickname row REMOVED from board modal; T49/T51 checks
        check('board modal has NO nickname input (moved to submit flow)', dD.querySelector('#boardNick') === null && dD.querySelector('.board-foot') === null);
        check('top-3 medal badges rendered', dD.querySelectorAll('.rk .medal').length === 3 && !!dD.querySelector('.rk .m1'));
        check('score header carries unit', /tok\/s|ms/.test(dD.querySelector('.board-row.head').textContent));
        // escape closes
        dD.dispatchEvent(new wD.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(20);
        check('Escape closes board modal', dD.querySelector('.board-modal') === null);
        // T49: toolbar = start → submit(trophy, sized svg) → export flyout(4 items)
        const subSvg = dD.querySelector('#boardSubmitBtn svg');
        check('submit button has sized trophy svg (no blank button)', !!subSvg && subSvg.getAttribute('width') === '16' && subSvg.getAttribute('height') === '16');
        check('export flyout has 4 format items (ids preserved)', dD.querySelectorAll('#exportMenu .btn').length === 4 && !!dD.getElementById('exportPngBtn') && !!dD.getElementById('exportJsonBtn'));
        check('export trigger has menu semantics', dD.getElementById('exportMenuBtn').getAttribute('aria-haspopup') === 'menu');
        domD.window.close();
    }


    console.log('[17] in-page error classification (T68: stream cut continues run / 0-byte first point fatal)');
    {
        const realFetch = w.fetch;
        const enc = new TextEncoder();
        const mkStreamResp = () => ({
            ok: true, status: 200,
            headers: { get: () => null },
            body: {
                getReader() {
                    let n = 0;
                    return {
                        read() {
                            if (n++ === 0) return Promise.resolve({ done: false, value: enc.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n') });
                            return Promise.reject(new TypeError('net::ERR_CONNECTION_RESET'));
                        },
                        cancel() { },
                    };
                },
            },
        });
        w.fetch = () => Promise.resolve(mkStreamResp());   // every point: ok headers + one chunk + TypeError cut
        // minimal custom ladder: 2 points, 1 repeat, no delay
        $('#minInputLength').value = '256'; input($('#minInputLength'));
        $('#maxInputLength').value = '512'; input($('#maxInputLength'));
        $('#requestDelay').value = '0'; input($('#requestDelay'));
        $('#requestTimeout').value = '20'; input($('#requestTimeout'));
        const rep = $('#repeatCount'); if (rep) { rep.value = '1'; input(rep); }
        click($('#startBtn'));
        let done17 = false;
        for (let i = 0; i < 30; i++) { await sleep(500); if (/开始测试|Start/.test($('#startBtn').textContent)) { done17 = true; break; } }
        check('run finished with mocked fetch', done17, $('#statusText').textContent);
        const errCells = Array.from(d.querySelectorAll('#resultBody .st-err'));
        check('both points attempted (stream cut is NOT fatal)', errCells.length === 2, String(errCells.length));
        const t1 = errCells[0] && errCells[0].getAttribute('title') || '';
        check('stream-cut tooltip says cut/interrupted (zh or en), no CORS', /连接中断|Connection cut/.test(t1) && !/CORS|跨域/.test(t1), t1.slice(0, 50));
        check('no fatal banner / field guidance on stream cut', d.getElementById('sideBanner').hidden && !d.querySelector('.field-error #baseUrl'));

        // 0-byte first point: fetch itself rejects -> network + CORS hint (first point) + fatal stop
        w.fetch = () => Promise.reject(new TypeError('fetch failed'));
        click($('#startBtn'));
        let done17b = false;
        for (let i = 0; i < 20; i++) { await sleep(300); if (/开始测试|Start/.test($('#startBtn').textContent)) { done17b = true; break; } }
        check('fatal run finished quickly', done17b);
        const banner17 = d.getElementById('sideBanner');
        check('first-point 0-byte is fatal: banner + CORS hint', !banner17.hidden && /CORS|跨域/.test(banner17.textContent), banner17.textContent.slice(0, 60));
        check('baseUrl guided on fatal network', !!d.querySelector('.field-error #baseUrl'));
        w.fetch = realFetch;
    }


    console.log('[18] deployment help dialog (T69)');
    {
        const helpBtn = d.getElementById('helpBtn');
        check('topbar help button exists (always visible)', !!helpBtn && helpBtn.hidden === false);
        check('help a11y wiring', helpBtn.getAttribute('aria-label') !== '' && helpBtn.hasAttribute('data-tip'));
        click(helpBtn); await sleep(30);
        const hm = d.querySelector('#modalRoot .modal');
        check('help dialog opens via showModal with dialog role', !!hm && hm.getAttribute('role') === 'dialog' && hm.getAttribute('aria-modal') === 'true');
        const helpText = hm ? hm.textContent : '';
        check('section 1 browser limits present (zh|en)', /浏览器限制|Browser limits/.test(helpText));
        check('mixed content guidance documented', /混合内容|mixed.?content/i.test(helpText));
        check('duplicate-ACAO root cause documented', /重复|DUPLICATE|duplicates/i.test(helpText) && /Access-Control-Allow-Origin/.test(helpText));
        check('UNIFIED template as single copyable CODE BLOCK (T76)', d.querySelectorAll('#modalRoot .help-code pre code').length === 2 && /proxy_buffering off/.test(helpText));
        check('unified conf covers bench+agent markers', /listen 443 ssl http2/.test(helpText) && /proxy_hide_header Access-Control-Allow-Origin/.test(helpText) && /proxy_read_timeout 1800s/.test(helpText) && /proxy_next_upstream off/.test(helpText) && /keepalive 64/.test(helpText) && /client_max_body_size 20m/.test(helpText));
        check('param reference TABLE rendered (T76)', d.querySelectorAll('#modalRoot .help-params .hp-row').length >= 15 && /proxy_read_timeout/.test(helpText) && /参数|Parameter/.test(helpText));
        check('cert section with certbot command', /certbot --nginx/.test(helpText));
        const copyBtns = Array.from(d.querySelectorAll('#modalRoot .help-code-bar .btn'));
        check('copy buttons present on every code block', copyBtns.length === 2 && copyBtns.every((b) => /复制|Copy/.test(b.textContent)));
        w.__copiedText = null;
        if (navigator.clipboard === undefined) { w.navigator.clipboard = { writeText: (t) => { w.__copiedText = t; return Promise.resolve(); } }; }
        else { const orig = w.navigator.clipboard.writeText; w.navigator.clipboard.writeText = (t) => { w.__copiedText = t; return orig ? orig(t) : Promise.resolve(); }; }
        copyBtns[0].click(); await sleep(40);
        check('copy puts full conf text on clipboard', typeof w.__copiedText === 'string' && w.__copiedText.includes('server {') && w.__copiedText.includes('proxy_read_timeout'));
        check('section 4 key troubleshooting present', /401/.test(helpText) && /Key|密钥/.test(helpText));
        check('no bare i18n keys leak', !/^[a-z0-9]+\.[a-zA-Z.]+$/m.test(helpText.trim()));
        // language switch re-renders in place (whichever direction)
        const wasZh = /浏览器限制/.test(helpText);
        click($('#langBtn')); await sleep(40);
        const hm2 = d.querySelector('#modalRoot .modal');
        check('help dialog still open after language switch', !!hm2);
        const helpText2 = hm2 ? hm2.textContent : '';
        const flipped = wasZh ? /Browser limits cheat sheet/.test(helpText2) : /浏览器限制/.test(helpText2);
        check('help re-renders to the other language in place', flipped, helpText2.slice(0, 40));
        check('flipped content complete (limits+agent)', /proxy_next_upstream off/.test(helpText2) && (/混合内容/.test(helpText2) || /Mixed content|MIXED CONTENT/.test(helpText2)));
        // Esc closes (showModal native)
        d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(20);
        check('Escape closes help', d.querySelector('#modalRoot .modal') === null);
        click($('#langBtn')); await sleep(20);   // restore original language
        const fav = d.querySelector('link[rel="icon"]');
        check('trophy favicon (svg data URI) present (T73)', !!fav && fav.getAttribute('type') === 'image/svg+xml' && /data:image\/svg\+xml/.test(fav.href) && decodeURIComponent(fav.href).includes('h7v3.2a3.5'));
    }

    console.log('\n' + (failures ? '✗ ' + failures + ' FAILURES' : '✓ ALL UI CHECKS PASSED'));
    process.exit(failures ? 2 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
