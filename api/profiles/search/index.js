const { getDb } = require('../../../src/db');
const { parseNL } = require('../../../src/nlParser');
const { buildQuery } = require('../../../src/queryBuilder');
const { formatProfile, requireApiVersion, setCors } = require('../../../src/helpers');
const { protect } = require('../../../src/middleware/auth');
const { normalizeFilters, canonicalKeyFromNormalized } = require('../../../src/queryNormalizer');
const { get: cacheGet, set: cacheSet } = require('../../../src/queryCache');

async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireApiVersion(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  const q = (req.query.q || '').trim();
  if (!q) {
    return res.status(400).json({ status: 'error', message: 'Invalid query parameters' });
  }

  let nlFilters;
  try {
    nlFilters = parseNL(q);
  } catch (_err) {
    return res.status(422).json({ status: 'error', message: 'Unable to interpret query' });
  }

  const merged = {
    ...nlFilters,
    page: req.query.page || 1,
    limit: req.query.limit || 10,
    sort_by: req.query.sort_by,
    order: req.query.order,
  };

  // Normalize and cache key
  const normalized = normalizeFilters(merged);
  const cacheKey = canonicalKeyFromNormalized(normalized);
  const cached = cacheGet(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  let queryComponents;
  try {
    queryComponents = buildQuery(normalized);
  } catch (err) {
    return res.status(err.status || 422).json({ status: 'error', message: err.message });
  }

  const { mongoFilter, sort, page, limit } = queryComponents;

  try {
    const db = await getDb();
    const col = db.collection('profiles');

    const [total, rows] = await Promise.all([
      col.countDocuments(mongoFilter),
      col.find(mongoFilter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const makeLink = (targetPage) => {
      if (!targetPage || targetPage < 1 || totalPages === 0 || targetPage > totalPages) return null;
      const params = new URLSearchParams();
      Object.keys(req.query).forEach((key) => {
        const value = req.query[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          params.set(key, String(value));
        }
      });
      params.set('page', String(targetPage));
      params.set('limit', String(limit));
      return `/api/profiles/search?${params.toString()}`;
    };

    const resp = {
      status: 'success',
      page: Number(page),
      limit: Number(limit),
      total: Number(total),
      total_pages: totalPages,
      links: {
        self: makeLink(page),
        next: makeLink(page + 1),
        prev: makeLink(page - 1),
      },
      data: rows.map(formatProfile),
    };
    try { cacheSet(cacheKey, resp, 5000); } catch (_) {}
    return res.status(200).json(resp);
  } catch (err) {
    console.error('GET /api/profiles/search error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

module.exports = protect(handler, ['analyst', 'admin']);
