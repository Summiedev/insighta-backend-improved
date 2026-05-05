const { formatProfile, requireApiVersion, setCors } = require('../../src/helpers');
const { protect } = require('../../src/middleware/auth');
const { applyObservability, RATE_LIMIT_POLICIES } = require('../../src/middleware/observability');
const { createProfilesExportCursor } = require('../../src/profilesQuery');

const HEADERS = ['id', 'name', 'gender', 'gender_probability', 'age', 'age_group', 'country_id', 'country_name', 'country_probability', 'created_at'];

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function writeLine(res, line) {
  const ok = res.write(line);
  if (ok) return;
  await new Promise((resolve) => res.once('drain', resolve));
}

async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireApiVersion(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  if (String(req.query.format || 'csv').toLowerCase() !== 'csv') {
    return res.status(400).json({ status: 'error', message: 'Invalid query parameters' });
  }

  const exportLimitRaw = parseInt(req.query.export_limit, 10);
  const exportLimit = Number.isInteger(exportLimitRaw) ? Math.min(Math.max(exportLimitRaw, 1), 5000) : 1000;

  try {
    const cursor = await createProfilesExportCursor(req.query, exportLimit);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="profiles_${timestamp}.csv"`);
    res.statusCode = 200;

    await writeLine(res, `${HEADERS.join(',')}\n`);

    for await (const raw of cursor) {
      const profile = formatProfile(raw);
      const line = HEADERS.map((key) => csvEscape(profile[key])).join(',');
      await writeLine(res, `${line}\n`);
    }

    return res.end();
  } catch (err) {
    console.error('GET /api/profiles/export error:', err);
    if (res.headersSent) {
      return res.end();
    }
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

module.exports = protect(
  applyObservability(handler, {
    routeId: 'GET /api/profiles/export',
    policy: RATE_LIMIT_POLICIES.queryStandard,
  }),
  ['admin']
);