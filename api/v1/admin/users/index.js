const { getDb } = require('../../../../src/db');
const { setCors } = require('../../../../src/helpers');
const { protect } = require('../../../../src/middleware/auth');
const { applyObservability, RATE_LIMIT_POLICIES } = require('../../../../src/middleware/observability');

async function listUsersHandler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  const page = Math.max(1, Math.floor(parseInt(req.query.page, 10)) || 1);
  let limit = Math.floor(parseInt(req.query.limit, 10));
  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  try {
    const db = await getDb();
    const col = db.collection('users');

    const [total, rows] = await Promise.all([
      col.countDocuments(),
      col.find({}, { projection: { _id: 0 } })
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
    ]);

    return res.status(200).json({
      status: 'success',
      page,
      limit,
      total,
      data: rows,
    });
  } catch (err) {
    console.error('GET /api/v1/admin/users error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

module.exports = protect(
  applyObservability(listUsersHandler, {
    routeId: 'GET /api/v1/admin/users',
    policy: RATE_LIMIT_POLICIES.queryStandard,
  }),
  ['admin']
);