// kv.mjs — Workers KV key model for the leaderboard (TASKS.md T30).
//
// Core idea: KV `list` returns keys in lexicographic order, so the BOARD KEY IS THE
// INDEX — one list call per board renders top-N without sorting or per-entry gets.
//
//   lb:{preset}:{metric}:{scoreKey}:{uuid}:{ts}
//
// scoreKey is fixed-width zero-padded and ORDER-AWARE:
//   - speeds (decode/prefill, tok/s): higher is better → INVERTED so lexicographic
//     ASC == best-first. 7 digits, centi-units: round(v*100) clamped to [0, 9_999_999].
//   - ttft (ms): lower is better → plain ascending, 8 digits.
// uuid makes keys unique per user; ts lets one user hold several submissions.
//
// Rate-limit keys (SOFT limits — KV is eventually consistent, see plan §3.4/D4):
//   rl:{ipHash}            TTL 60s    — minimum interval between submits
//   dq:{uuid}:{yyyymmdd}   TTL 86400s — daily quota per uuid
//
// All key components coming from clients are validated against strict formats
// (enum / uuid-v4) and REJECTED, never truncated — a crafted `:` inside a component
// must not be able to forge a foreign prefix (REVIEW-T23-list P2#4).

export const METRICS = ['decode', 'prefill', 'ttft'];
export const PRESETS = ['quick', 'standard', 'chat', 'agent', 'coding'];
export const ENTRY_TTL_S = 180 * 24 * 3600; // 180 days (plan §3.4)
export const RL_TTL_S = 60;                 // KV TTL floor is 60s
export const DQ_TTL_S = 86400;
export const DQ_DAILY_LIMIT = 20;

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isMetric(m) { return METRICS.includes(m); }
export function isPreset(p) { return PRESETS.includes(p); }
export function isUuid(u) { return typeof u === 'string' && UUID_V4_RE.test(u); }

/* ---------- scoreKey encoders ---------- */

export function speedScoreKey(v) {
  if (!Number.isFinite(v) || v < 0) return null;
  const s = Math.min(9999999, Math.round(v * 100));
  return String(9999999 - s).padStart(7, '0');
}

export function ttftScoreKey(v) {
  if (!Number.isFinite(v) || v < 0 || v > 99999999) return null;
  return String(Math.round(v)).padStart(8, '0');
}

export function scoreKeyFor(metric, v) {
  return metric === 'ttft' ? ttftScoreKey(v) : speedScoreKey(v);
}

/** Original value recovered from a scoreKey (for display/debug only). */
export function scoreFromKey(metric, scoreKey) {
  if (metric === 'ttft') return Number(scoreKey);
  return (9999999 - Number(scoreKey)) / 100;
}

/* ---------- key builders / parsers ---------- */

export function boardKey(preset, metric, scoreKey, uuid, ts) {
  return `lb:${preset}:${metric}:${scoreKey}:${uuid}:${ts}`;
}

export function boardPrefix(preset, metric) {
  return `lb:${preset}:${metric}:`;
}

export function parseBoardKey(key) {
  const parts = key.split(':');
  if (parts.length !== 6 || parts[0] !== 'lb') return null;
  const ts = Number(parts[5]);
  if (!Number.isInteger(ts) || ts < 0) return null;
  return { preset: parts[1], metric: parts[2], scoreKey: parts[3], uuid: parts[4], ts };
}

export function rlKey(ipHash) { return `rl:${ipHash}`; }

export function dqKey(uuid, yyyymmdd) { return `dq:${uuid}:${yyyymmdd}`; }

/** Per-user-per-preset pointer to their current board keys (T79: one entry per
 *  user per preset — a new submit replaces the previous one instead of stacking). */
export function userPtrKey(uuid, preset) { return `u:${uuid}:${preset}`; }

export function ymd(d = new Date()) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
