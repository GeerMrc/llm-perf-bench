#!/usr/bin/env node
/* Worker unit tests — pure functions (kv.mjs / sanitize.mjs) + api handler contract
   via direct Request objects (no HTTP server; the e2e suite in worker_e2e_test.js
   goes through tools/worker_shim.mjs). CJS: ESM worker sources are imported dynamically
   as .mjs (repo convention — package.json has no "type":"module"). */
'use strict';

let failures = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, cond, extra) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined && extra !== '' ? '  ' + extra : ''));
    if (!cond) failures++;
};

(async () => {
    /* ============ [K] kv.mjs (T30) ============ */
    const kv = await import('../src/worker/kv.mjs');

    console.log('[K1] enums & formats');
    check('METRICS = decode/prefill/ttft', JSON.stringify(kv.METRICS) === JSON.stringify(['decode', 'prefill', 'ttft']));
    check('PRESETS = 5 built-ins', kv.PRESETS.length === 5 && kv.PRESETS.includes('standard'));
    check('preset whitelist rejects custom', kv.isPreset('custom') === false && kv.isPreset('standard') === true);
    check('metric whitelist', kv.isMetric('decode') === true && kv.isMetric('e2e') === false);
    check('uuid v4 accepted', kv.isUuid('123e4567-e89b-42d3-a456-426614174000') === true);
    check('uuid v1 rejected (version nibble)', kv.isUuid('123e4567-e89b-12d3-a456-426614174000') === false);
    check('uuid with injection chars rejected', kv.isUuid('123e4567-e89b-42d3-a456-42661417400:lb') === false);
    check('uuid variant nibble enforced', kv.isUuid('123e4567-e89b-42d3-c456-426614174000') === false);

    console.log('[K2] scoreKey encoding — lexicographic order == rank order');
    const fast = kv.speedScoreKey(123.45);
    const slow = kv.speedScoreKey(12.34);
    const fastest = kv.speedScoreKey(9999.99);
    check('speed keys fixed width 7', fast.length === 7 && slow.length === 7 && fastest.length === 7);
    check('higher speed sorts first (inverted)', fastest < fast && fast < slow, `${fastest} < ${fast} < ${slow}`);
    check('speed roundtrip via scoreFromKey', Math.abs(kv.scoreFromKey('decode', fast) - 123.45) < 0.011);
    check('speed clamp at ceiling', kv.speedScoreKey(1e9) === '0000000');
    check('speed zero → max key', kv.speedScoreKey(0) === '9999999');
    check('speed invalid → null', kv.speedScoreKey(-1) === null && kv.speedScoreKey(NaN) === null && kv.speedScoreKey('x') === null);
    const t1 = kv.ttftScoreKey(85.4);
    const t2 = kv.ttftScoreKey(1230);
    check('ttft keys fixed width 8', t1.length === 8 && t2.length === 8);
    check('lower ttft sorts first (ascending)', t1 < t2, `${t1} < ${t2}`);
    check('ttft invalid → null', kv.ttftScoreKey(-5) === null && kv.ttftScoreKey(1e9) === null);
    check('scoreKeyFor dispatch', kv.scoreKeyFor('ttft', 100) === '00000100' && kv.scoreKeyFor('decode', 100) !== null);

    console.log('[K3] board key build/parse roundtrip');
    const bk = kv.boardKey('standard', 'decode', '00987654', '123e4567-e89b-42d3-a456-426614174000', 1789600000000);
    const pk = kv.parseBoardKey(bk);
    check('roundtrip fields', pk && pk.preset === 'standard' && pk.metric === 'decode' && pk.scoreKey === '00987654'
        && pk.uuid === '123e4567-e89b-42d3-a456-426614174000' && pk.ts === 1789600000000, bk);
    check('parse rejects malformed', kv.parseBoardKey('lb:a:b:c:d') === null && kv.parseBoardKey('xx:1:2:3:4:5') === null);
    check('parse rejects non-numeric ts', kv.parseBoardKey('lb:a:b:c:d:e') === null);
    check('boardPrefix', kv.boardPrefix('chat', 'ttft') === 'lb:chat:ttft:');

    console.log('[K4] rate-limit keys & date');
    check('rlKey', kv.rlKey('a1b2c3d4e5f6a1b2') === 'rl:a1b2c3d4e5f6a1b2');
    check('dqKey', kv.dqKey('123e4567-e89b-42d3-a456-426614174000', '20260917') === 'dq:123e4567-e89b-42d3-a456-426614174000:20260917');
    check('ymd format', /^\d{8}$/.test(kv.ymd(new Date('2026-09-17T00:00:00Z'))) && kv.ymd(new Date('2026-09-17T00:00:00Z')) === '20260917');
    check('TTLs match plan §3.4', kv.ENTRY_TTL_S === 15552000 && kv.RL_TTL_S === 60 && kv.DQ_TTL_S === 86400 && kv.DQ_DAILY_LIMIT === 20);

    /* ============ [S] sanitize.mjs (T31) ============ */
    const { sanitizeSubmit, classifyEpClass, cleanText, utf8Len } = await import('../src/worker/sanitize.mjs');
    const UUID = '123e4567-e89b-42d3-a456-426614174000';
    const TS = 1789600000000;
    const goodRaw = {
        uuid: UUID, proto: 'openai-completions', preset: 'standard',
        name: 'tester', model: 'Qwen3.8-27B-NVFP4', gpu: 'RTX 5090', engine: 'sglang', engineModel: 'nvfp4',
        os: 'Ubuntu 24.04', epClass: 'local:sglang',
        decode: 55.5, prefill: 2400.25, ttft: 312.7, tpot: 18.1, e2e: 9000, refIn: 2048,
    };
    const g = sanitizeSubmit(goodRaw, { uuid: UUID, ts: TS });
    console.log('[S1] happy path');
    check('accepts valid submission', g.ok === true, g.ok ? '' : JSON.stringify(g.error));
    check('entry carries schema v/uuid/ts', g.entry.v === 1 && g.entry.uuid === UUID && g.entry.ts === TS);
    check('metadata has uuid (REVIEW-T23 P2#4)', g.metadata.uuid === UUID);
    check('metadata within 1KB', utf8Len(JSON.stringify(g.metadata)) <= 1024);
    check('value within 2KB', utf8Len(g.value) <= 2048);
    check('epClass local label kept', g.entry.epClass === 'local:sglang');

    console.log('[S2] text cleaning & caps (dual: chars per baseline §3.5 + bytes per metadata budget)');
    check('control chars stripped + trimmed', cleanText('  ab\u0000c\u001Fd\u007F  ', 100, 100) === 'abcd');
    check('C1 + bidi + line-sep stripped (T35c)', cleanText('a\u0085b\u2028c\u202Ed', 100, 100) === 'abcd');
    check('char cap truncates ASCII', cleanText('a'.repeat(60), 10, 100) === 'aaaaaaaaaa');
    check('byte cap truncates CJK without surrogate split', cleanText('汉'.repeat(20), 100, 48) === '汉'.repeat(16));
    const longName = sanitizeSubmit({ ...goodRaw, name: 'N'.repeat(200) }, { uuid: UUID, ts: TS });
    check('oversized name truncated to 16 chars (baseline)', longName.ok && longName.entry.name.length === 16, String(longName.entry.name && longName.entry.name.length));
    const longNameCjk = sanitizeSubmit({ ...goodRaw, name: '汉'.repeat(200) }, { uuid: UUID, ts: TS });
    check('CJK name capped at 16 chars AND 48B', longNameCjk.ok && [...longNameCjk.entry.name].length === 16 && utf8Len(longNameCjk.entry.name) <= 48);
    const anonymous = sanitizeSubmit({ ...goodRaw, name: '   ' }, { uuid: UUID, ts: TS });
    check('blank name → anonymous', anonymous.ok && anonymous.entry.name === 'anonymous');

    console.log('[S3] enum/format validation (reject, never truncate)');
    check('bad proto rejected', sanitizeSubmit({ ...goodRaw, proto: 'grpc' }, { uuid: UUID, ts: TS }).ok === false);
    check('custom preset rejected', sanitizeSubmit({ ...goodRaw, preset: 'custom' }, { uuid: UUID, ts: TS }).ok === false);
    check('bad uuid rejected', sanitizeSubmit(goodRaw, { uuid: 'not-a-uuid', ts: TS }).ok === false);
    check('missing decode rejected', sanitizeSubmit({ ...goodRaw, decode: undefined }, { uuid: UUID, ts: TS }).ok === false);
    check('negative ttft rejected', sanitizeSubmit({ ...goodRaw, ttft: -1 }, { uuid: UUID, ts: TS }).ok === false);
    check('non-finite prefill rejected', sanitizeSubmit({ ...goodRaw, prefill: 'abc' }, { uuid: UUID, ts: TS }).ok === false);
    check('numeric string accepted (coerced)', sanitizeSubmit({ ...goodRaw, decode: '55.5' }, { uuid: UUID, ts: TS }).entry.decode === 55.5);
    check('out-of-range refIn rejected', sanitizeSubmit({ ...goodRaw, refIn: 1e9 }, { uuid: UUID, ts: TS }).ok === false);

    console.log('[S4] metadata budget — structural bound + defensive drop order');
    const fatRaw = {
        ...goodRaw,
        name: '汉'.repeat(16), model: '汉'.repeat(64), gpu: '汉'.repeat(64),
        engine: '汉'.repeat(32), engineModel: '汉'.repeat(64), os: '汉'.repeat(32),
    };
    const fat = sanitizeSubmit(fatRaw, { uuid: UUID, ts: TS });
    check('fat CJK submission accepted', fat.ok === true, fat.ok ? '' : JSON.stringify(fat.error));
    check('metadata omits os/engineModel by design (board render)', fat.ok && fat.metadata.os === undefined && fat.metadata.engineModel === undefined, JSON.stringify(Object.keys(fat.metadata || {})));
    check('worst-case byte caps keep metadata ≤1KB structurally', fat.ok && utf8Len(JSON.stringify(fat.metadata)) <= 1024, String(fat.ok && utf8Len(JSON.stringify(fat.metadata))));
    check('core rank fields never dropped', fat.ok && fat.metadata.decode === goodRaw.decode && fat.metadata.name === fatRaw.name && fat.metadata.gpu === fatRaw.gpu);

    /* ============ [A] api.mjs contract via direct Requests (T32) ============ */
    const { handleApi } = await import('../src/worker/api.mjs');
    const { MemoryKV } = await import('../tools/worker_shim.mjs');
    const mkEnv = (salt = 'test-salt') => ({ LEADERBOARD: new MemoryKV(), RATE_LIMIT_SALT: salt });
    const UUID2 = '999e4567-e89b-42d3-a456-426614174999';
    const post = (env, body, { ip = '1.2.3.4', ct = 'application/json', raw } = {}) => handleApi(
        new Request('http://x/api/leaderboard/submit', {
            method: 'POST',
            headers: { 'content-type': ct, 'CF-Connecting-IP': ip },
            body: raw != null ? raw : JSON.stringify(body),
        }), env);
    const get = (env, qs) => handleApi(new Request('http://x/api/leaderboard' + qs), env);

    console.log('[A1] health & unknown');
    const h = await handleApi(new Request('http://x/api/health'), mkEnv());
    check('health {ok,ts}', h.status === 200 && (await h.json()).ok === true);
    const unk = await handleApi(new Request('http://x/api/nope'), mkEnv());
    check('unknown api → 404 bad_request contract', unk.status === 404 && (await unk.json()).error.kind === 'bad_request');

    console.log('[A2] submit happy path');
    const envA = mkEnv();
    const r1 = await post(envA, { ...goodRaw, uuid: UUID }, {});
    const j1 = await r1.json();
    check('submit ok', r1.status === 200 && j1.ok === true, JSON.stringify(j1).slice(0, 120));
    check('estRank snapshot returned (own key visible locally)', j1.estRank === 1, String(j1.estRank));
    check('consistency annotated', j1.consistency === 'approximate-snapshot');
    const kvKeys = await envA.LEADERBOARD.list({ prefix: 'lb:' });
    check('three board keys written (decode/prefill/ttft)', kvKeys.keys.length === 3, String(kvKeys.keys.length));
    check('keys carry metadata', kvKeys.keys.every((k) => k.metadata && k.metadata.uuid === UUID));
    check('rl + dq keys written', (await envA.LEADERBOARD.list({ prefix: 'rl:' })).keys.length === 1
        && (await envA.LEADERBOARD.list({ prefix: 'dq:' })).keys.length === 1);

    console.log('[A3] ranking order via list');
    const envB = mkEnv();
    await post(envB, { ...goodRaw, uuid: UUID, decode: 50 }, { ip: '9.9.9.9' });   // slower
    await post(envB, { ...goodRaw, uuid: UUID2, decode: 90 }, { ip: '9.9.9.10' }); // faster
    const lb = await get(envB, '?preset=standard&metric=decode&limit=10');
    const lbj = await lb.json();
    check('list ok', lb.status === 200 && lbj.ok === true && lbj.entries.length === 2);
    check('faster decode ranks first (lexicographic)', lbj.entries[0].uuid === UUID2 && lbj.entries[0].rank === 1, JSON.stringify(lbj.entries.map((e) => [e.rank, e.uuid])));
    check('ttft board: lower ranks first', (await (await get(envB, '?preset=standard&metric=ttft')).json()).entries[0].rank === 1);
    const badQ = await get(envB, '?preset=custom&metric=decode');
    check('list rejects custom preset', badQ.status === 400 && (await badQ.json()).error.kind === 'bad_request');
    const badM = await get(envB, '?preset=standard&metric=e2e');
    check('list rejects non-board metric', badM.status === 400);

    console.log('[A3b] one-entry-per-user replace semantics (T79)');
    {
        const envR = mkEnv();
        const U = 'cece4567-e89b-42d3-a456-42661417cece';
        const body = (decode) => ({ uuid: U, proto: 'openai-completions', preset: 'chat', name: 'replacer', model: 'm', gpu: 'g', engine: 'e', epClass: 'local:lan', decode, prefill: 2000, ttft: 400, refIn: 8192 });
        await post(envR, body(50), { ip: '6.6.6.1' }); await sleep(30);
        await post(envR, body(80), { ip: '6.6.6.2' }); await sleep(30);   // better resubmit
        const lbR = await get(envR, '?preset=chat&metric=decode');
        const jr = await lbR.json();
        check('resubmit replaces (single entry)', jr.entries.length === 1, JSON.stringify(jr.entries.map(e => [e.name, e.decode])));
        check('board shows the NEW value', jr.entries[0] && jr.entries[0].decode === 80, String(jr.entries[0] && jr.entries[0].decode));
        const keysR = await envR.LEADERBOARD.list({ prefix: 'lb:' });
        check('old board keys deleted (3 keys total for one run)', keysR.keys.length === 3, String(keysR.keys.length));
        const ptr = await envR.LEADERBOARD.list({ prefix: 'u:' });
        check('user pointer written', ptr.keys.length === 1);
        // legacy stacked duplicates: manually stack, then list dedups
        await envR.LEADERBOARD.put('lb:chat:decode:' + '0'.repeat(7) + ':' + U + ':111', '{}', { metadata: { uuid: U, name: 'dup', decode: 1 } });
        const lbD = await (await get(envR, '?preset=chat&metric=decode&limit=10')).json();
        check('list-side dedup keeps one per uuid', lbD.entries.filter(e => e.uuid === U).length === 1, JSON.stringify(lbD.entries.map(e => e.uuid)));
    }

    console.log('[A4] soft rate limits');
    const r2same = await post(envB, { ...goodRaw, uuid: UUID, decode: 60 }, { ip: '9.9.9.9' });
    check('same ip within 60s → rate_limited', r2same.status === 429 && (await r2same.json()).error.kind === 'rate_limited');
    const envC = mkEnv();
    let quotaHit = false;
    for (let i = 0; i < 21; i++) {
        const r = await post(envC, { ...goodRaw, uuid: UUID, decode: 50 + i }, { ip: '7.7.7.' + i });
        const j = await r.json();
        if (!j.ok && j.error && j.error.kind === 'rate_limited' && r.status === 429) {
            quotaHit = (i === 20); // first 20 pass (distinct ips bypass rl), 21st hits daily quota
            break;
        }
    }
    check('daily quota 20/uuid enforced (soft)', quotaHit === true);

    /* ============ [N] sanitization matrix — full negative rows (T33) ============ */
    console.log('[N1] sensitive fields never survive the whitelist');
    const poisoned = {
        ...goodRaw,
        apiKey: 'sk-SUPER-SECRET',
        baseUrl: 'https://api.openai.com/v1',
        Authorization: 'Bearer sk-LEAK',
        sys: 'SYSTEM PROMPT LEAK', user: 'USER PROMPT LEAK',
        visText: 'OUTPUT LEAK', reaText: 'THINKING LEAK',
        serverTimings: { prompt_per_second: 1, predicted_per_second: 2, cache_n: 3 },
        runs: [{ ttft: 1 }], wallMs: 123, cv: { ttft: 0.1 },
        __proto__x: 'x', constructor: 'x',
    };
    const pn = sanitizeSubmit(poisoned, { uuid: UUID, ts: TS });
    check('poisoned submission still accepted (whitelist pick)', pn.ok === true);
    const stored = JSON.stringify(pn.entry) + JSON.stringify(pn.metadata);
    for (const secret of ['sk-SUPER-SECRET', 'api.openai.com', 'sk-LEAK', 'SYSTEM PROMPT LEAK', 'USER PROMPT LEAK', 'OUTPUT LEAK', 'THINKING LEAK', 'serverTimings', 'cache_n', 'wallMs']) {
        check('not stored: ' + secret, !stored.includes(secret));
    }
    check('entry field set exactly = whitelist', JSON.stringify(Object.keys(pn.entry).sort()) === JSON.stringify(['decode', 'e2e', 'engine', 'engineModel', 'epClass', 'gpu', 'model', 'name', 'os', 'prefill', 'preset', 'proto', 'refIn', 'tpot', 'ts', 'ttft', 'uuid', 'v'].sort()), JSON.stringify(Object.keys(pn.entry).sort()));

    console.log('[N2] endpoint class masking (client sends label only, server re-classifies)');
    check('raw public URL label → ***', classifyEpClass('https://api.openai.com/v1') === '***');
    check('raw ip:port → ***', classifyEpClass('http://1.2.3.4:8080') === '***');
    check('strict local label kept', classifyEpClass('local:sglang') === 'local:sglang');
    check('local label with injection → ***', classifyEpClass('local:sglang:lb') === '***');
    check('uppercase/craft label → ***', classifyEpClass('Local:SG LANG') === '***');
    check('empty → empty (no endpoint info)', classifyEpClass('') === '');
    const envMask = mkEnv();
    const rm = await post(envMask, { ...goodRaw, uuid: UUID, epClass: 'https://evil.example.com' }, { ip: '5.5.5.5' });
    check('submit with raw URL label accepted (masked server-side)', rm.status === 200);
    const maskKeys = await envMask.LEADERBOARD.list({ prefix: 'lb:' });
    const storedVal = await envMask.LEADERBOARD.get(maskKeys.keys[0].name);
    check('stored value masks URL as ***', typeof storedVal === 'string' && storedVal.includes('"epClass":"***"') && !storedVal.includes('evil.example.com'));

    console.log('[N3] request gates');
    const envD = mkEnv();
    const bigRaw = JSON.stringify({ ...goodRaw, model: 'M'.repeat(9000) });
    const tooBig = await handleApi(new Request('http://x/api/leaderboard/submit', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: bigRaw,
    }), envD);
    check('>8KB body rejected 413', tooBig.status === 413 && (await tooBig.json()).error.kind === 'bad_request');
    const wrongCt = await post(envD, JSON.stringify(goodRaw), { ct: 'text/plain' });
    check('non-JSON content-type rejected 415', wrongCt.status === 415 && (await wrongCt.json()).error.kind === 'bad_request');
        const badJson = await handleApi(new Request('http://x/api/leaderboard/submit', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json',
        }), envD);
        check('invalid JSON rejected 400', badJson.status === 400);
        const cjkBig = await handleApi(new Request('http://x/api/leaderboard/submit', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '汉'.repeat(3000), // 3000 UTF-16 units < 8192, but 9000 UTF-8 bytes > 8192
        }), envD);
        check('byte-accurate 8KB gate rejects CJK overflow (T35c)', cjkBig.status === 413);
    const arr = await handleApi(new Request('http://x/api/leaderboard/submit', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '[1,2,3]',
    }), envD);
    check('array body rejected', arr.status === 400);

    console.log('\n' + (failures ? '✗ ' + failures + ' FAILURES' : '✓ ALL WORKER-API CHECKS PASSED'));
    process.exit(failures ? 2 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
