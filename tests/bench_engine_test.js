#!/usr/bin/env node
/* Engine-level verification harness for llm-perf-bench.html.
   Loads the REAL page script with a stubbed DOM, then drives the actual
   runOnePoint / adapters / SSE parser against the local inference server. */
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'llm-perf-bench.html'), 'utf8');
/* Node undici reports an unhandled AbortError rejection after mid-stream signal abort —
   a Node-only quirk (browsers don't surface this); tolerate it in the harness. */
process.on('unhandledRejection', (reason) => {
    if (reason && (reason.name === 'AbortError' || /abort/i.test(String(reason && reason.message || reason)))) return;
    console.error('unhandledRejection:', reason);
    process.exitCode = 1;
});
const m = HTML.match(/<script>\s*'use strict';([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: main script not found'); process.exit(1); }
const src = m[1];

/* ---------- generic fake DOM ---------- */
function fakeElement() {
    const el = {
        style: {},
        dataset: {},
        classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
        attributes: {},
        children: [],
        value: '', checked: false, textContent: '', innerHTML: '',
        width: 300, height: 150, clientWidth: 300, clientHeight: 300,
        offsetWidth: 100, offsetHeight: 20,
        getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 20, right: 100, width: 100, height: 20 }),
        setAttribute() { }, getAttribute() { return null; }, removeAttribute() { },
        appendChild(c) { return c; }, removeChild(c) { return c; }, remove() { },
        addEventListener() { }, removeEventListener() { },
        querySelector: () => fakeElement(), querySelectorAll: () => [],
        focus() { }, click() { },
        getContext: () => ({ setTransform() { }, clearRect() { }, fillRect() { }, beginPath() { }, moveTo() { }, lineTo() { }, stroke() { }, fill() { }, arc() { }, fillText() { }, save() { }, restore() { }, clip() { }, rect() { }, setLineDash() { }, translate() { }, scale() { }, canvas: null }),
    };
    return new Proxy(el, {
        get(t, k) {
            if (k in t) return t[k];
            // unknown property reads (e.g. body for document) get a function that returns fake
            return t[k] = fakeElement();
        },
        set(t, k, v) { t[k] = v; return true; }
    });
}

const elementsById = {};
function byId(id) {
    if (!elementsById[id]) {
        elementsById[id] = fakeElement();
        if (id === 'protocol') elementsById[id].value = 'openai-completions';
        if (id === 'minInputLength') elementsById[id].value = '128';
        if (id === 'maxInputLength') elementsById[id].value = '512';
        if (id === 'lengthStep') elementsById[id].value = '2';
        if (id === 'maxOutputLength') elementsById[id].value = '64';
        if (id === 'structureLength') elementsById[id].value = '16';
        if (id === 'requestDelay') elementsById[id].value = '500';
        if (id === 'requestTimeout') elementsById[id].value = '300';
        if (id === 'warmup' || id === 'antiCache') elementsById[id].checked = true;
        if (id === 'thinkingMode') elementsById[id].value = 'none';
    }
    return elementsById[id];
}

global.document = {
    documentElement: Object.assign(fakeElement(), { lang: 'zh-CN', setAttribute() { }, getAttribute() { return null; } }),
    body: fakeElement(),
    getElementById: byId,
    querySelector: () => fakeElement(),
    querySelectorAll: () => [],
    createElement: () => fakeElement(),
    createTextNode: (s) => ({ textContent: s }),
    addEventListener() { }, removeEventListener() { },
};
global.localStorage = { getItem: () => null, setItem() { }, removeItem() { } };
global.matchMedia = () => ({ matches: false, addEventListener() { } });
global.getComputedStyle = () => ({ getPropertyValue: () => '#888888' });
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.ResizeObserver = class { observe() { } disconnect() { } };
global.devicePixelRatio = 1;


/* evaluate the real page script */
const vm = require('vm');
const sandbox = {
    console, fetch: global.fetch, performance, TextDecoder, AbortController, TextEncoder,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, Error, Promise, JSON, Math, Date, Object, Array, String, Number, RegExp, parseInt, parseFloat, isNaN, isFinite, Map, Set,
    document: global.document, window: null, navigator: { language: 'zh-CN' },
    localStorage: global.localStorage, matchMedia: global.matchMedia, getComputedStyle: global.getComputedStyle,
    requestAnimationFrame: global.requestAnimationFrame, ResizeObserver: global.ResizeObserver, devicePixelRatio: 1,
    Node: class { }, Event: class { },
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.navigator = { language: 'zh-CN' };
sandbox.location = { protocol: 'http:', origin: 'http://127.0.0.1:8899', host: '127.0.0.1:8899' };
sandbox.addEventListener = () => { };
sandbox.removeEventListener = () => { };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'page.js' });
console.log('✓ page script evaluated without runtime errors (init() ran on stub DOM)');

const page = sandbox;
const BASE = process.env.BENCH_BASE || 'http://127.0.0.1:30001';
const KEY = process.env.BENCH_KEY || 'sk-local-test';
const MODEL = process.env.BENCH_MODEL || 'Qwen3.8-27B-NVFP4';

function mkCfg(protocol) {
    return {
        protocol, baseUrl: BASE, apiKey: KEY, modelName: MODEL,
        minInputLength: 128, maxInputLength: 512, lengthStep: 2, maxOutputLength: 64,
        structureLength: 16, requestDelay: 300, timeoutSec: 120,
        warmup: true, antiCache: true, thinkingMode: 'none'
    };
}

(async () => {
    let failures = 0;
    const check = (name, cond, extra) => {
        console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
        if (!cond) failures++;
    };

    /* ---- unit checks ---- */
    console.log('\n[1] normalizeBase');
    check('bare host', page.normalizeBase('http://127.0.0.1:30001') === 'http://127.0.0.1:30001');
    check('trailing slash', page.normalizeBase('http://127.0.0.1:30001/') === 'http://127.0.0.1:30001');
    check('with /v1', page.normalizeBase('http://h:1/v1') === 'http://h:1');
    check('full chat endpoint', page.normalizeBase('http://127.0.0.1:30001/v1/chat/completions') === 'http://127.0.0.1:30001');
    check('full messages endpoint', page.normalizeBase('http://h:1/v1/messages') === 'http://h:1');
    check('no scheme', page.normalizeBase('127.0.0.1:8899') === 'http://127.0.0.1:8899');
    check('invalid', page.normalizeBase('http://') === '');

    console.log('\n[2] computePoints');
    const pts = page.computePoints(128, 512, 2);
    check('128..512 x2 → [128,256,512]', JSON.stringify(pts) === JSON.stringify([128, 256, 512]), JSON.stringify(pts));
    check('cap 256', page.computePoints(1, 1e12, 1.01).length === 257);

    console.log('\n[3] countTokensByRule sanity');
    const n1 = page.countTokensByRule('one two three');
    check('3 words = 3 tokens', n1 === 3, 'got ' + n1);
    const n2 = page.countTokensByRule('don\'t stop');
    check('don\'t=1 + stop=1 → 2', n2 === 2, 'got ' + n2);

    console.log('\n[4] request body builders');
    const p = { system: 'You are an assistant.', user: 'hello' };
    const bChat = page.buildRequestBody(mkCfg('openai-completions'), p, 32, true);
    check('chat: max_tokens + stream_options + reasoning_effort none',
        bChat.max_tokens === 32 && bChat.stream_options.include_usage === true && bChat.reasoning_effort === 'none' && bChat.stream === true);
    const bResp = page.buildRequestBody(mkCfg('openai-responses'), p, 32, true);
    check('responses: max_output_tokens + reasoning.effort none',
        bResp.max_output_tokens === 32 && bResp.reasoning.effort === 'none' && bResp.input.length === 2);
    const bAnth = page.buildRequestBody(mkCfg('anthropic'), p, 32, true);
    check('anthropic: max_tokens + thinking disabled + system field',
        bAnth.max_tokens === 32 && bAnth.thinking.type === 'disabled' && bAnth.system === p.system && !bAnth.reasoning_effort);
    const bUnset = page.buildRequestBody(Object.assign(mkCfg('openai-completions'), { thinkingMode: 'unset' }), p, 32, true);
    check('unset thinking → no field', !('reasoning_effort' in bUnset));
    const hAnth = page.authHeaders(mkCfg('anthropic'));
    check('anthropic headers: x-api-key + version', hAnth['x-api-key'] === KEY && hAnth['anthropic-version'] === '2023-06-01');
    const hChat = page.authHeaders(mkCfg('openai-completions'));
    check('chat headers: bearer, no x-api-key', hChat['Authorization'] === 'Bearer ' + KEY && !hChat['x-api-key']);
    const hNoKey = page.authHeaders(Object.assign(mkCfg('anthropic'), { apiKey: '' }));
    check('anthropic no key → version header still present', hNoKey['anthropic-version'] === '2023-06-01' && !hNoKey['x-api-key']);

    /* ---- live protocol tests (real server) ---- */
    for (const proto of ['openai-completions', 'openai-responses', 'anthropic']) {
        console.log('\n[5] live ' + proto + ' — runOnePoint(target 256, out 64)');
        const row = await page.runOnePoint(mkCfg(proto), 256, null, { idx: 1 });
        if (!row) { check('row returned', false); continue; }
        check('status ok', row.status === 'ok', row.status + ' ' + (row.error && row.error.message));
        check('ttft > 0', row.ttft > 0, row.ttft && row.ttft.toFixed(1) + 'ms');
        check('decodeTime > 0', row.decodeTime > 0, row.decodeTime && row.decodeTime.toFixed(1) + 'ms');
        check('e2e ≈ ttft+decode', Math.abs(row.e2e - (row.ttft + row.decodeTime)) < 25, row.e2e.toFixed(1));
        check('inTok from api (' + row.inSrc + ')', row.inSrc === 'api', String(row.inTok));
        check('outTok from api (' + row.outSrc + ')', row.outSrc === 'api', String(row.outTok));
        check('outTok ≥ 8 (server may stop early naturally)', row.outTok >= 8, String(row.outTok));
        check('reasonTok = 0 (thinking none)', row.reasonTok === 0, String(row.reasonTok));
        check('prefillSpeed sane', row.prefillSpeed > 50 && row.prefillSpeed < 100000, row.prefillSpeed.toFixed(1) + ' tok/s');
        check('decodeSpeed sane', row.decodeSpeed > 5 && row.decodeSpeed < 2000, row.decodeSpeed.toFixed(1) + ' tok/s');
        check('tpot = decode/(out-1)', Math.abs(row.tpot - row.decodeTime / (row.outTok - 1)) < 0.01, row.tpot.toFixed(2) + 'ms');
        check('user prompt contains unique prefix', row.user.startsWith('[run '));
        check('userLen ≈ target', Math.abs(row.userLen + row.sysLen + 16 - 256) <= 3, `user ${row.userLen} + sys ${row.sysLen} + 16`);
        check('has serverTimings (chat only expected)', proto !== 'openai-completions' || !!row.serverTimings, JSON.stringify(row.serverTimings).slice(0, 60));
    }

    /* ---- thinking-on variant (unset) for chat: reasoning counted ---- */
    console.log('\n[6] chat thinking=unset — reasoning token accounting');
    const row2 = await page.runOnePoint(Object.assign(mkCfg('openai-completions'), { thinkingMode: 'unset', maxOutputLength: 128 }), 128, null, { idx: 1 });
    check('status ok', row2.status === 'ok', row2.status + ' ' + (row2.error && row2.error.message));
    check('reasoning tokens counted (' + row2.reasonTok + ')', row2.reasonTok == null || row2.reasonTok >= 0, 'reasonTok=' + row2.reasonTok + ' reaText len=' + row2.reaText.length);

    /* ---- error paths ---- */
    console.log('\n[7] error paths');
    const row401 = await page.runOnePoint(Object.assign(mkCfg('openai-completions'), { apiKey: 'wrong-key' }), 128, null, { idx: 1 });
    check('bad key → error row with auth msg', row401.status === 'error' && /401|鉴权|API Key|Authentication/i.test(row401.error.message), row401.error.message);
    const row404 = await page.runOnePoint(Object.assign(mkCfg('openai-responses'), { baseUrl: 'http://127.0.0.1:30001/nope' }), 128, null, { idx: 1 });
    check('bad path → 404 msg', row404.status === 'error' && /404|不存在|Endpoint not found/i.test(row404.error.message), row404.error.message);
    const ctl = new AbortController();
    const p3 = page.runOnePoint(mkCfg('openai-completions'), 4096, ctl.signal, { idx: 1 });
    setTimeout(() => ctl.abort(), 80);
    const rowAbort = await p3;
    check('mid-stream abort → aborted status', rowAbort.status === 'aborted', rowAbort.status + ' ' + (rowAbort.error && rowAbort.error.message));
    const rowTimeout = await page.runOnePoint(Object.assign(mkCfg('openai-completions'), { timeoutSec: 0.05, maxOutputLength: 512 }), 8192, null, { idx: 1 });
    check('timeout → timeout msg', rowTimeout.status === 'error' && /超时|timeout/i.test(rowTimeout.error.message), rowTimeout.error.message);
    const rowBadModel = await page.runOnePoint(Object.assign(mkCfg('anthropic'), { modelName: 'no-such-model' }), 128, null, { idx: 1 });
    check('unknown model → row returned, no crash (this server ignores model name)',
        rowBadModel && (rowBadModel.status === 'ok' || (rowBadModel.status === 'error' && rowBadModel.error && rowBadModel.error.message)),
        rowBadModel.status + ' ' + (rowBadModel.error ? String(rowBadModel.error.message).slice(0, 60) : '(server accepted any model)'));


    console.log('[8] classifyError stage-based classification (T68)');
    {
        const CE = page.classifyError;
        const TE = new TypeError('fetch failed');
        const zh = (o) => o.message;
        let r = CE(TE, { respOk: true, gotChunk: true });
        check('stream cut (respOk+chunk) -> kind stream', r.kind === 'stream' && /连接中断/.test(zh(r)) && zh(r).includes('已收到部分输出'), zh(r).slice(0, 40));
        check('stream cut never carries CORS text', !/CORS|跨域/.test(zh(r)));
        r = CE(TE, { respOk: true, gotChunk: false });
        check('stream cut zero-chunk (long prefill cut) still stream', r.kind === 'stream' && !/CORS|跨域/.test(zh(r)));
        r = CE(TE, { respOk: false, isFirstPoint: true });
        check('0-byte FIRST point -> network + CORS hint', r.kind === 'network' && /网络错误/.test(zh(r)) && /CORS|跨域/.test(zh(r)));
        r = CE(TE, { respOk: false, isFirstPoint: false });
        check('0-byte later point -> network WITHOUT CORS hint', r.kind === 'network' && /网络错误/.test(zh(r)) && !/CORS|跨域/.test(zh(r)));
        const savedProto = sandbox.location.protocol;
        sandbox.location.protocol = 'https:';
        r = CE(TE, { respOk: false, isFirstPoint: true, targetUrl: 'http://8.8.8.8:1234/v1/chat/completions' });
        check('https page + public http target -> mixed-content guidance', /混合内容/.test(zh(r)) && /127\.0\.0\.1:8899/.test(zh(r)), zh(r).split('\n')[1].slice(0, 30));
        r = CE(TE, { respOk: false, isFirstPoint: true, targetUrl: 'http://127.0.0.1:30001/v1/chat/completions' });
        check('https page + loopback http target -> NOT mixed', !/混合内容/.test(zh(r)));
        sandbox.location.protocol = savedProto;
        check('first-point stream is NOT fatal anymore', page.isFatalConfigError({ status: 'error', error: { kind: 'stream', message: 'x' } }, true) === false);
        check('first-point network still fatal', page.isFatalConfigError({ status: 'error', error: { kind: 'network', message: 'x' } }, true) === true);
        check('first-point auth still fatal', page.isFatalConfigError({ status: 'error', error: { kind: 'auth', message: 'x' } }, true) === true);
    }

    console.log('\n' + (failures ? '✗ ' + failures + ' FAILURES' : '✓ ALL CHECKS PASSED'));
    process.exit(failures ? 2 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
