const { getDb } = require('../src/db');
const { setCors } = require('../src/helpers');
const { protect } = require('../src/middleware/auth');
const { applyObservability, RATE_LIMIT_POLICIES } = require('../src/middleware/observability');

async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const db    = await getDb();
    const count = await db.collection('profiles').countDocuments();
    return res.status(200).json({
      status:    'ok',
      profiles:  count,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Health check database error:', err);

    const payload = {
      status: 'error',
      message: 'Database unavailable',
    };

    if (process.env.NODE_ENV !== 'production') {
      payload.details = err.message;
    }

    return res.status(500).json(payload);
  }
}

module.exports = protect(
  applyObservability(handler, {
    routeId: 'GET /health',
    policy: RATE_LIMIT_POLICIES.queryStandard,
  }),
  ['analyst', 'admin']
);
