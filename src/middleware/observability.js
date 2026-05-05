const { consumeRateLimit } = require('../rateLimiter');
const {
  createRequestId,
  getClientIp,
  getEndpoint,
  structuredLog,
  toErrorMeta,
} = require('../logger');

const RATE_LIMIT_POLICIES = {
  authStrict: {
    limit: Number(process.env.RATE_LIMIT_AUTH_MAX || 10),
    windowSec: Number(process.env.RATE_LIMIT_AUTH_WINDOW_SEC || 60),
    identityScope: 'ip',
  },
  queryStandard: {
    limit: Number(process.env.RATE_LIMIT_QUERY_MAX || 120),
    windowSec: Number(process.env.RATE_LIMIT_QUERY_WINDOW_SEC || 60),
    identityScope: 'user_or_ip',
  },
};

function withRateLimit(handler, opts) {
  const routeId = opts.routeId || 'route';
  const policy = opts.policy || RATE_LIMIT_POLICIES.queryStandard;

  return async function rateLimitedHandler(req, res) {
    if (req.method === 'OPTIONS') return handler(req, res);

    const result = await consumeRateLimit(req, {
      ...policy,
      routeId,
    });

    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(result.resetAtSec));
    res.setHeader('X-RateLimit-Policy', `${policy.limit};w=${policy.windowSec}`);
    res.setHeader('X-RateLimit-Strategy', result.strategy);

    if (!result.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, result.resetAtSec - Math.floor(Date.now() / 1000))));
      return res.status(429).json({
        status: 'error',
        message: 'Too many requests',
      });
    }

    return handler(req, res);
  };
}

function withRequestLogging(handler, opts) {
  const routeId = opts.routeId || 'route';

  return async function loggedHandler(req, res) {
    const startedAt = process.hrtime.bigint();

    const requestId = createRequestId(req);
    const endpoint = getEndpoint(req, routeId);
    const method = req.method;
    const clientIp = getClientIp(req);

    res.setHeader('X-Request-Id', requestId);
    req.requestId = requestId;

    structuredLog('info', 'request_received', {
      request_id: requestId,
      endpoint,
      method,
      client_ip: clientIp,
      user_id: req.auth && req.auth.userId ? req.auth.userId : null,
    });

    try {
      const out = await handler(req, res);
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      const completionMeta = {
        request_id: requestId,
        endpoint,
        method,
        client_ip: clientIp,
        user_id: req.auth && req.auth.userId ? req.auth.userId : null,
        status_code: res.statusCode,
        latency_ms: Number(elapsedMs.toFixed(2)),
      };

      if (res.statusCode >= 500) {
        structuredLog('error', 'request_completed_with_error_status', completionMeta);
      } else {
        structuredLog('info', 'request_completed', completionMeta);
      }

      return out;
    } catch (err) {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      structuredLog('error', 'request_failed', {
        request_id: requestId,
        endpoint,
        method,
        client_ip: clientIp,
        user_id: req.auth && req.auth.userId ? req.auth.userId : null,
        status_code: res.statusCode || 500,
        latency_ms: Number(elapsedMs.toFixed(2)),
        ...toErrorMeta(err),
      });

      throw err;
    }
  };
}

function applyObservability(handler, opts) {
  return withRequestLogging(withRateLimit(handler, opts), opts);
}

module.exports = {
  RATE_LIMIT_POLICIES,
  applyObservability,
  withRateLimit,
  withRequestLogging,
};