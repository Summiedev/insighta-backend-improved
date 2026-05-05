const { getClientIp } = require('./logger');

const memoryStore = new Map();

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function getRedisConfig() {
  const url = process.env.RATE_LIMIT_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.RATE_LIMIT_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

async function consumeRedis(key, windowSec) {
  const cfg = getRedisConfig();
  if (!cfg) return null;

  const response = await fetch(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, String(windowSec), 'NX'],
      ['TTL', key],
    ]),
  });

  if (!response.ok) {
    throw new Error(`Redis rate limiter failed with status ${response.status}`);
  }

  const payload = await response.json();
  const results = Array.isArray(payload && payload.result) ? payload.result : [];

  const countRaw = results[0] && results[0].result;
  const ttlRaw = results[2] && results[2].result;

  const count = Number(countRaw || 0);
  const ttl = Number(ttlRaw || windowSec);
  const resetAtSec = nowSec() + (ttl > 0 ? ttl : windowSec);

  return {
    count,
    remaining: 0,
    resetAtSec,
  };
}

function consumeInMemory(key, windowSec) {
  const now = nowSec();
  const current = memoryStore.get(key);

  if (!current || current.resetAtSec <= now) {
    const fresh = { count: 1, resetAtSec: now + windowSec };
    memoryStore.set(key, fresh);
    return { count: fresh.count, resetAtSec: fresh.resetAtSec };
  }

  current.count += 1;
  memoryStore.set(key, current);
  return { count: current.count, resetAtSec: current.resetAtSec };
}

function cleanMemoryStore(maxEntries) {
  if (memoryStore.size <= maxEntries) return;

  const now = nowSec();
  for (const [key, value] of memoryStore.entries()) {
    if (value.resetAtSec <= now) {
      memoryStore.delete(key);
    }
  }

  if (memoryStore.size <= maxEntries) return;

  const entries = Array.from(memoryStore.entries());
  entries.sort((a, b) => a[1].resetAtSec - b[1].resetAtSec);
  const excess = memoryStore.size - maxEntries;
  for (let i = 0; i < excess; i += 1) {
    memoryStore.delete(entries[i][0]);
  }
}

function createRateKey(req, routeId, identityScope) {
  const route = routeId || 'route';

  if (identityScope === 'user_or_ip') {
    const userId = req.auth && req.auth.userId ? String(req.auth.userId) : '';
    if (userId) return `rl:${route}:u:${userId}`;
  }

  if (identityScope === 'user') {
    const userId = req.auth && req.auth.userId ? String(req.auth.userId) : 'anonymous';
    return `rl:${route}:u:${userId}`;
  }

  return `rl:${route}:ip:${getClientIp(req)}`;
}

async function consumeRateLimit(req, options) {
  const limit = Number(options.limit || 60);
  const windowSec = Number(options.windowSec || 60);
  const identityScope = options.identityScope || 'ip';
  const routeId = options.routeId || 'route';
  const maxMemoryEntries = Number(options.maxMemoryEntries || 50000);

  const key = createRateKey(req, routeId, identityScope);

  let bucket;
  let strategy = 'memory';
  try {
    const redisBucket = await consumeRedis(key, windowSec);
    if (redisBucket) {
      bucket = redisBucket;
      strategy = 'redis';
    }
  } catch (_err) {
    bucket = null;
  }

  if (!bucket) {
    cleanMemoryStore(maxMemoryEntries);
    bucket = consumeInMemory(key, windowSec);
  }

  const remaining = Math.max(0, limit - bucket.count);
  const allowed = bucket.count <= limit;

  return {
    allowed,
    limit,
    remaining,
    resetAtSec: bucket.resetAtSec,
    strategy,
    key,
  };
}

module.exports = {
  consumeRateLimit,
};