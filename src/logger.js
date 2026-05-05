const crypto = require('crypto');

function nowIso() {
  return new Date().toISOString();
}

function createRequestId(req) {
  const existing = req.headers['x-request-id'] || req.headers['x-vercel-id'];
  if (existing) return String(existing);
  return crypto.randomBytes(8).toString('hex');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = String(forwarded).split(',')[0].trim();
    if (ip) return ip;
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) return String(realIp).trim();

  return req.socket && req.socket.remoteAddress
    ? String(req.socket.remoteAddress)
    : 'unknown';
}

function getEndpoint(req, routeId) {
  if (routeId) return routeId;
  const raw = req.url || '';
  const qIdx = raw.indexOf('?');
  return qIdx >= 0 ? raw.slice(0, qIdx) : raw;
}

function toErrorMeta(err) {
  if (!err) return {};
  return {
    error_message: err.message || String(err),
    error_name: err.name || 'Error',
    error_stack: err.stack || '',
  };
}

function structuredLog(level, event, meta) {
  const payload = {
    ts: nowIso(),
    level,
    event,
    ...meta,
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  createRequestId,
  getClientIp,
  getEndpoint,
  structuredLog,
  toErrorMeta,
};