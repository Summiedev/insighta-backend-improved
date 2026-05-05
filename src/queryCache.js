// Simple in-process TTL cache. Suitable for short-lived caching in serverless
// functions where a shared cache is not available.

const CACHE = new Map();

function nowMs() { return Date.now(); }

function get(key) {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs()) { CACHE.delete(key); return null; }
  return entry.value;
}

function set(key, value, ttlMs = 10000) {
  const expiresAt = nowMs() + ttlMs;
  CACHE.set(key, { value, expiresAt });
}

function size() { return CACHE.size; }

module.exports = { get, set, size };
