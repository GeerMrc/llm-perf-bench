#!/usr/bin/env node
/* Worker e2e — full-stack contract through the REAL worker modules over real HTTP,
   served by tools/worker_shim.mjs (ADR-0001: workerd cannot run on this host's glibc;
   the shim runs the exact src/worker/*.mjs code with an in-memory KV). What this
   covers: routing (root-serves-app/assets/api), submit flow, board ordering, soft rate limit,
   error contract. Residual gap vs real workerd (runtime container semantics) is
   closed by `wrangler deploy --dry-run` + the user-side smoke checklist (T46). */
'use strict';
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, extra) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined && extra !== '' ? '  ' + extra : ''));
    if (!cond) failures++;
};

const PORT = Number(process.env.E2E_PORT || 8795);

(async () => {
    const { startServer, makeEnv } = await import('../tools/worker_shim.mjs');
    const env = makeEnv({ salt: 'e2e-test-salt' });
    const server = await startServer({ port: PORT, env });
    const base = `http://127.0.0.1:${PORT}`;
    const j = async (r) => ({ status: r.status, body: await r.json() });
  const fileText = fs.readFileSync(path.join(__dirname, '..', 'src', 'llm-perf-bench.html'), 'utf8');

    try {
        console.log('[E1] routing');
        const root = await fetch(base + '/', { redirect: 'manual' });
        const loc = root.headers.get('location') || '';
        check('GET / serves the app DIRECTLY (no redirect, T80/A-5)', root.status === 200 && loc === '' && (root.headers.get('content-type') || '').includes('text/html'), root.status + ' ' + loc);
        const rootText = await root.text();
        check('root body byte-identical to the app file', rootText === fileText);
        const app = await fetch(base + '/src/llm-perf-bench.html');
        const appText = await app.text();
        check('app asset served byte-identical', app.status === 200 && appText === fileText);
        check('app content-type html', (app.headers.get('content-type') || '').includes('text/html'));
        const nm = await fetch(base + '/node_modules/wrangler/package.json');
        check('node_modules not exposed (404)', nm.status === 404);
        const wsrc = await fetch(base + '/src/worker/index.mjs');
        check('worker source not exposed (404)', wsrc.status === 404);
        const health = await j(await fetch(base + '/api/health'));
        check('health {ok,ts}', health.status === 200 && health.body.ok === true && typeof health.body.ts === 'number');
        const nope = await j(await fetch(base + '/api/nope'));
        check('unknown api → 404 contract', nope.status === 404 && nope.body.error.kind === 'bad_request');

        console.log('[E2] submit → board → my rank');
        const UUID_A = 'aaaa4567-e89b-42d3-a456-426614174000';
        const UUID_B = 'bbbb4567-e89b-42d3-a456-426614174bbb';
        const mkBody = (uuid, decode, prefill, ttft) => ({
            uuid, proto: 'openai-completions', preset: 'standard', name: 'e2e-' + uuid.slice(0, 4),
            model: 'Qwen3.8-27B-NVFP4', gpu: 'RTX 5090', engine: 'sglang', epClass: 'local:sglang',
            decode, prefill, ttft, refIn: 2048,
        });
        const post = (body, ip) => fetch(base + '/api/leaderboard/submit', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
            body: JSON.stringify(body),
        });

        const s1 = await j(await post(mkBody(UUID_A, 40, 2000, 400), '10.0.0.1'));
        check('first submit ok + estRank 1', s1.status === 200 && s1.body.ok === true && s1.body.estRank === 1, JSON.stringify(s1.body));
        const s2 = await j(await post(mkBody(UUID_B, 80, 1000, 200), '10.0.0.2'));
        check('faster submit ok + estRank 1 (passes A)', s2.status === 200 && s2.body.estRank === 1, JSON.stringify(s2.body));

        const lb = await j(await fetch(base + '/api/leaderboard?preset=standard&metric=decode&limit=50'));
        check('board lists 2, B first', lb.status === 200 && lb.body.entries.length === 2 && lb.body.entries[0].uuid === UUID_B, JSON.stringify(lb.body.entries.map((e) => e.uuid)));
        check('ranks 1,2 assigned', lb.body.entries[0].rank === 1 && lb.body.entries[1].rank === 2);
        check('metadata render fields present', lb.body.entries[0].name.startsWith('e2e-') && lb.body.entries[0].model === 'Qwen3.8-27B-NVFP4' && lb.body.entries[0].gpu === 'RTX 5090');
        const lbT = await j(await fetch(base + '/api/leaderboard?preset=standard&metric=ttft'));
        check('ttft board: lower first (B)', lbT.body.entries[0].uuid === UUID_B);
        const lbP = await j(await fetch(base + '/api/leaderboard?preset=standard&metric=prefill'));
        check('prefill board: higher first (A)', lbP.body.entries[0].uuid === UUID_A);

        console.log('[E3] soft rate limit over HTTP');
        const again = await j(await post(mkBody(UUID_A, 41, 2000, 400), '10.0.0.1'));
        check('same ip within 60s → 429 rate_limited', again.status === 429 && again.body.error.kind === 'rate_limited', JSON.stringify(again.body));
        const newIp = await j(await post(mkBody(UUID_A, 42, 2000, 400), '10.0.0.3'));
        check('different ip passes rl', newIp.status === 200);

        console.log('[E4] request gates over HTTP');
        const big = await fetch(base + '/api/leaderboard/submit', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...mkBody(UUID_A, 1, 1, 1), model: 'M'.repeat(9000) }),
        });
        check('>8KB rejected 413', big.status === 413);
        const wrongCt = await fetch(base + '/api/leaderboard/submit', {
            method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
        });
        check('non-JSON CT rejected 415', wrongCt.status === 415);

        console.log('[E5] RATE_LIMIT_SALT injection note');
        // The shim env was created with salt 'e2e-test-salt'; rl keys are derived via
        // HMAC(ip+salt) — verified implicitly by [E3] (rate limit keyed per ip under this salt).
        check('salt-injected env active', env.RATE_LIMIT_SALT === 'e2e-test-salt');
    } finally {
        await new Promise((r) => server.close(r));
    }

    console.log('\n' + (failures ? '✗ ' + failures + ' FAILURES' : '✓ ALL WORKER-E2E CHECKS PASSED'));
    process.exit(failures ? 2 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
