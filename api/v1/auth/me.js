const { setCors } = require('../../../src/helpers');
const { protect } = require('../../../src/middleware/auth');
const { applyObservability, RATE_LIMIT_POLICIES } = require('../../../src/middleware/observability');

async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  return res.status(200).json({ status: 'success', data: req.auth.user });
}

module.exports = protect(
  applyObservability(handler, {
    routeId: 'GET /auth/me',
    policy: RATE_LIMIT_POLICIES.queryStandard,
  }),
  ['analyst', 'admin']
);
