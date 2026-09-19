// api.mjs — /api/* handlers (TASKS.md T32).
//
// Endpoints (same-origin JSON only; plan §3.3):
//   GET  /api/health                  → { ok, ts }
//   GET  /api/leaderboard?preset=&metric=&limit=
//   POST /api/leaderboard/submit      → { ok, estRank } | { ok:false, error:{kind,msg} }
//
// Gates: Content-Type must be application/json; body ≤8KB; per-IP-hash min interval
// (rl, 60s TTL) + per-uuid daily quota (dq, 20/day) — both SOFT (KV eventual
// consistency, plan D4). Entries carry a 180-day TTL. estRank is an approximate
// snapshot: it counts better board keys visible at submit time; the just-written key
// may not be visible yet (KV converges within ~60s+).

import {
  METRICS, isMetric, isPreset, scoreKeyFor, boardKey, boardPrefix, parseBoardKey,
  rlKey, dqKey, userPtrKey, ymd, ENTRY_TTL_S, RL_TTL_S, DQ_TTL_S, DQ_DAILY_LIMIT,
} from './kv.mjs';
import { sanitizeSubmit } from './sanitize.mjs';

const MAX_BODY_BYTES = 8192;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
const fail = (status, kind, msg) => json({ ok: false, error: { kind, msg } }, status);

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/health') return json({ ok: true, ts: Date.now() });

  if (path === '/api/leaderboard' && request.method === 'GET') {
    return handleList(url, env);
  }
  if (path === '/api/leaderboard/submit' && request.method === 'POST') {
    return handleSubmit(request, env);
  }
  return fail(404, 'bad_request', 'unknown api endpoint');
}

/* ---------- GET /api/leaderboard ---------- */

async function handleList(url, env) {
  const preset = url.searchParams.get('preset') || 'standard';
  const metric = url.searchParams.get('metric') || 'decode';
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  if (!isPreset(preset)) return fail(400, 'bad_request', 'invalid preset');
  if (!isMetric(metric)) return fail(400, 'bad_request', 'invalid metric');

  let listed;
  try {
    // fetch wider than limit so per-uuid dedup (one entry per user per preset, T79)
    // still fills the requested page even with legacy stacked duplicates
    listed = await env.LEADERBOARD.list({ prefix: boardPrefix(preset, metric), limit: Math.min(100, limit * 5) });
  } catch (e) {
    return fail(500, 'kv_unavailable', 'leaderboard storage unavailable');
  }

  const seen = new Set();
  const entries = [];
  for (const k of listed.keys) {
    const meta = k.metadata || {};
    const uid = meta.uuid != null ? meta.uuid : (parseBoardKey(k.name) || {}).uuid;
    if (uid != null) {
      if (seen.has(uid)) continue;   // keep only each user's best (first in key order)
      seen.add(uid);
    }
    entries.push(k);
    if (entries.length >= limit) break;
  }

  const __legacyMap = entries.map((k, i) => {
    const meta = k.metadata || {};
    const parsed = parseBoardKey(k.name);
    return {
      rank: i + 1,
      uuid: meta.uuid ?? (parsed ? parsed.uuid : undefined),
      name: meta.name ?? 'anonymous',
      model: meta.model ?? '', gpu: meta.gpu ?? '', engine: meta.engine ?? '',
      proto: meta.proto ?? '', preset: meta.preset ?? preset,
      refIn: meta.refIn, decode: meta.decode, prefill: meta.prefill, ttft: meta.ttft,
      ts: meta.ts ?? (parsed ? parsed.ts : undefined),
    };
  });

  const rows = __legacyMap;
  return json({ ok: true, metric, preset, limit, entries: rows, consistency: 'eventual' });
}

/* ---------- POST /api/leaderboard/submit ---------- */

async function hmacShort(value, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return Array.from(new Uint8Array(sig)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function handleSubmit(request, env) {
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json')) return fail(415, 'bad_request', 'content-type must be application/json');

  const cl = Number(request.headers.get('content-length') || '0');
  if (cl > MAX_BODY_BYTES) return fail(413, 'bad_request', 'body too large');

  let text;
  try { text = await request.text(); } catch (e) { return fail(400, 'bad_request', 'unreadable body'); }
  // byte-accurate gate (RECON-P2 P3: text.length counts UTF-16 units — 9,191B of CJK
  // would slip under an 8192 limit; count real UTF-8 bytes instead)
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail(413, 'bad_request', 'body too large');

  let raw;
  try { raw = JSON.parse(text); } catch (e) { return fail(400, 'bad_request', 'invalid JSON'); }

  const ts = Date.now();
  const uuid = typeof raw.uuid === 'string' ? raw.uuid : '';
  const res = sanitizeSubmit(raw, { uuid, ts });
  if (!res.ok) return fail(400, res.error.kind, res.error.msg);
  const { entry, metadata, value } = res;

  try {
    // soft rate limits (order: cheap reads first)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await hmacShort(ip, env.RATE_LIMIT_SALT || 'unset-salt');
    const rl = await env.LEADERBOARD.get(rlKey(ipHash));
    if (rl != null) return fail(429, 'rate_limited', 'submit interval is 60s — try again shortly');
    const dq = Number((await env.LEADERBOARD.get(dqKey(entry.uuid, ymd()))) || '0');
    if (dq >= DQ_DAILY_LIMIT) return fail(429, 'rate_limited', 'daily submit quota reached (' + DQ_DAILY_LIMIT + ')');

    // one entry per user per preset (T79): delete the previous board keys pointed
    // to by the user pointer, then write the fresh run — resubmits replace, not stack
    const ptrKey = userPtrKey(entry.uuid, entry.preset);
    const oldPtr = await env.LEADERBOARD.get(ptrKey, 'json').catch(() => null);
    const dels = [];
    if (oldPtr && Array.isArray(oldPtr.keys)) {
      for (const k of oldPtr.keys) { try { dels.push(env.LEADERBOARD.delete(k)); } catch (e) { } }
    }

    // three board keys: same value+metadata, per-metric scoreKey ordering
    const writes = [];
    const newKeys = [];
    for (const metric of METRICS) {
      const sk = scoreKeyFor(metric, entry[metric]);
      if (sk == null) return fail(400, 'bad_request', 'unrankable metric value: ' + metric);
      const k = boardKey(entry.preset, metric, sk, entry.uuid, entry.ts);
      newKeys.push(k);
      writes.push(env.LEADERBOARD.put(k, value, { metadata, expirationTtl: ENTRY_TTL_S }));
    }
    writes.push(env.LEADERBOARD.put(ptrKey, JSON.stringify({ keys: newKeys, ts: entry.ts }), { expirationTtl: ENTRY_TTL_S }));
    await Promise.all([...dels, ...writes]);
    await env.LEADERBOARD.put(rlKey(ipHash), '1', { expirationTtl: RL_TTL_S });
    await env.LEADERBOARD.put(dqKey(entry.uuid, ymd()), String(dq + 1), { expirationTtl: DQ_TTL_S });

    // estRank: approximate snapshot on the primary (decode) board
    const listed = await env.LEADERBOARD.list({ prefix: boardPrefix(entry.preset, 'decode'), limit: 100 });
    let estRank = null;
    for (let i = 0; i < listed.keys.length; i++) {
      const k = listed.keys[i];
      const m = k.metadata || {};
      const parsed = parseBoardKey(k.name);
      if ((m.uuid || (parsed && parsed.uuid)) === entry.uuid) { estRank = i + 1; break; }
    }
    return json({ ok: true, estRank, consistency: 'approximate-snapshot' });
  } catch (e) {
    return fail(500, 'kv_unavailable', 'leaderboard storage unavailable');
  }
}
