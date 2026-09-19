// sanitize.mjs — server-side second-pass sanitization for leaderboard submissions (TASKS.md T31).
//
// The client builder only ever puts whitelisted fields on the wire; this module is the
// SERVER-SIDE SECOND LINE (plan §3.5): unknown fields are dropped wholesale, every
// enum/format is re-validated, free text is control-char-cleaned and byte-capped, and
// the KV metadata blob is budget-checked against the 1024-byte hard limit (with
// deterministic optional-field dropping before rejection).
//
// Sensitive-data invariants enforced here (negative-tested in T33):
//   - apiKey / baseUrl raw / prompts / outputs (sys/user/visText/reaText) are NOT in
//     the whitelist → any injected copy is silently discarded.
//   - epClass: only a strict `local:<name>` label survives; everything else ('***').

import { isPreset, isMetric, isUuid } from './kv.mjs';

export const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic'];
const EP_CLASS_RE = /^local:[a-z0-9-]{1,16}$/;

// [field, maxChars (baseline §3.5), maxUtf8Bytes] — BOTH caps enforced (RECON-P2 P2-1:
// interim build enforced bytes only; baseline promises chars; the byte cap additionally
// protects the 1KB metadata budget, worst-case CJK escapes to 6 bytes/char in JSON).
const TEXT_FIELDS = [
  ['name', 16, 48],
  ['model', 64, 192],
  ['gpu', 64, 192],
  ['engine', 32, 96],
  ['engineModel', 64, 192],
  ['os', 32, 96],
];
// Deterministic drop order when the metadata budget is exceeded (least → most valuable).
const METADATA_DROP_ORDER = ['os', 'engineModel', 'engine', 'gpu', 'model'];

// [field, min, max, required?] — numeric sanity ranges.
const NUM_FIELDS = [
  ['decode', 0, 1e7, true],
  ['prefill', 0, 1e7, true],
  ['ttft', 0, 1e8, true],
  ['tpot', 0, 1e7, false],
  ['e2e', 0, 1e9, false],
  ['refIn', 1, 1e7, true],
];

const err = (msg) => ({ ok: false, error: { kind: 'bad_request', msg } });

// C0 controls, DEL, C1 controls, plus bidi/line separators (RECON-P2 P3: C1 range
// was not cleaned; \u2028/\u2029 break JSON string literals in some consumers).
const CTRL_RE = /[\u0000-\u001F\u007F\u0080-\u009F\u2028\u2029\u200E\u200F\u202A-\u202E]/g;

export function cleanText(v, maxChars, maxBytes) {
  if (typeof v !== 'string') return '';
  const s = v.replace(CTRL_RE, '').trim();
  // enforce BOTH caps: char count (baseline §3.5) and UTF-8 byte budget (metadata cap);
  // truncate without splitting a surrogate pair
  let out = '';
  let chars = 0;
  let bytes = 0;
  for (const ch of s) {
    const b = utf8Len(ch);
    if (chars + 1 > maxChars || bytes + b > maxBytes) break;
    out += ch;
    chars++;
    bytes += b;
  }
  return out;
}

// TextEncoder works in both workerd and Node.
const TE = new TextEncoder();
export function utf8Len(str) { return TE.encode(str).length; }

export function classifyEpClass(v) {
  if (typeof v !== 'string') return '***';
  const t = v.trim();
  if (t === '') return '';
  return EP_CLASS_RE.test(t) ? t : '***';
}

function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * sanitizeSubmit(raw, { uuid, ts }) → { ok:true, entry, metadata } | { ok:false, error }
 * entry:     full stored JSON (value, ≤2KB budget)
 * metadata:  board-render summary (≤1024 bytes, KV hard limit)
 */
export function sanitizeSubmit(raw, { uuid, ts }) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return err('body must be a JSON object');
  if (!isUuid(uuid)) return err('invalid uuid');
  if (!Number.isInteger(ts) || ts <= 0) return err('invalid ts');

  const proto = raw.proto;
  if (!PROTOCOLS.includes(proto)) return err('invalid proto');
  const preset = raw.preset;
  if (!isPreset(preset)) return err('invalid preset (only built-in presets are rankable)');
  for (const m of ['decode', 'prefill', 'ttft']) {
    if (!isMetric(m)) return err('invalid metric');
    if (num(raw[m]) == null) return err('missing metric: ' + m);
  }

  const entry = { v: 1, uuid, ts, proto, preset };

  for (const [field, maxChars, maxBytes] of TEXT_FIELDS) {
    entry[field] = cleanText(raw[field], maxChars, maxBytes);
  }
  if (entry.name === '') entry.name = 'anonymous';

  for (const [field, min, max, required] of NUM_FIELDS) {
    const n = num(raw[field]);
    if (n == null || n < min || n > max) {
      if (required) return err('invalid numeric field: ' + field);
      continue; // optional numeric missing → omitted
    }
    entry[field] = n;
  }

  entry.epClass = classifyEpClass(raw.epClass);

  const value = JSON.stringify(entry);
  if (utf8Len(value) > 2048) return err('entry exceeds 2KB budget');

  // metadata: board-render summary; enforce the KV 1024-byte hard limit with
  // deterministic optional-field dropping before rejecting.
  let metadata = {
    uuid: entry.uuid, name: entry.name, ts: entry.ts,
    proto: entry.proto, preset: entry.preset, refIn: entry.refIn,
    decode: entry.decode, prefill: entry.prefill, ttft: entry.ttft,
    model: entry.model, gpu: entry.gpu, engine: entry.engine,
  };
  if (utf8Len(JSON.stringify(metadata)) > 1024) {
    for (const f of METADATA_DROP_ORDER) {
      delete metadata[f];
      if (utf8Len(JSON.stringify(metadata)) <= 1024) break;
    }
  }
  if (utf8Len(JSON.stringify(metadata)) > 1024) return err('metadata exceeds 1KB budget');

  return { ok: true, entry, metadata, value };
}
