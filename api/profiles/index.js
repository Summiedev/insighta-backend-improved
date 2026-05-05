const zlib = require('zlib');
const { getDb } = require('../../src/db');
const { buildQuery } = require('../../src/queryBuilder');
const { buildPaginationLinks, formatProfile, requireApiVersion, setCors } = require('../../src/helpers');
const { parseJsonBody } = require('../../src/auth');
const { createProfileFromName } = require('../../src/profileCreator');
const { protect } = require('../../src/middleware/auth');
const { applyObservability, RATE_LIMIT_POLICIES } = require('../../src/middleware/observability');
const { normalizeFilters, canonicalKeyFromNormalized } = require('../../src/queryNormalizer');
const { get: cacheGet, set: cacheSet } = require('../../src/queryCache');

let cachedExistingProfileNames = null;

async function getExistingProfileNames(col) {
  if (cachedExistingProfileNames) {
    return cachedExistingProfileNames;
  }

  const existingProfiles = await col.find({}, { projection: { name: 1 } }).toArray();
  cachedExistingProfileNames = new Set(existingProfiles.map((profile) => String(profile.name)));
  return cachedExistingProfileNames;
}

function rememberExistingProfileName(name) {
  if (!cachedExistingProfileNames) return;
  cachedExistingProfileNames.add(String(name));
}

function forgetExistingProfileName(name) {
  if (!cachedExistingProfileNames) return;
  cachedExistingProfileNames.delete(String(name));
}

async function getExistingNamesForBatch(col, names) {
  if (!names.length) return new Set();
  const existing = await col
    .find({ name: { $in: names } }, { projection: { name: 1 } })
    .toArray();
  return new Set(existing.map((profile) => String(profile.name)));
}

function buildResponse(req, page, limit, total, rows) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    status: 'success',
    page: Number(page),
    limit: Number(limit),
    total: Number(total),
    total_pages: totalPages,
    links: buildPaginationLinks(req, Number(page), Number(limit), Number(total), '/api/profiles'),
    data: rows.map(formatProfile),
  };
}

async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireApiVersion(req, res)) return;

  try {
    const id = (req.query.id || '').trim();

    // Handle single profile detail and deletion via id query parameter
    if (id) {
      if (req.method === 'GET') {
        const db = await getDb();
        const profile = await db.collection('profiles').findOne({ id });
        if (!profile) {
          return res.status(404).json({ status: 'error', message: 'Profile not found' });
        }
        return res.status(200).json({ status: 'success', data: formatProfile(profile) });
      }

      if (req.method === 'DELETE') {
        if (!req.auth || String(req.auth.role).toLowerCase() !== 'admin') {
          return res.status(403).json({ status: 'error', message: 'Forbidden' });
        }
        const db = await getDb();
        const existingProfile = await db.collection('profiles').findOne({ id });
        const result = await db.collection('profiles').deleteOne({ id });
        if (!result.deletedCount) {
          return res.status(404).json({ status: 'error', message: 'Profile not found' });
        }
        if (existingProfile && existingProfile.name) {
          forgetExistingProfileName(existingProfile.name);
        }
        return res.status(200).json({ status: 'success', message: 'Profile deleted' });
      }

      return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    // Handle list and create operations
    if (req.method === 'GET') {
      // Normalize query into canonical form for cache key
      const mergedRaw = {
        ...req.query,
        page: req.query.page || 1,
        limit: req.query.limit || 10,
        sort_by: req.query.sort_by,
        order: req.query.order,
      };

      const normalized = normalizeFilters(mergedRaw);
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

      const resp = buildResponse(req, page, limit, total, rows);
      try { cacheSet(cacheKey, resp, 5000); } catch (_) {}
      return res.status(200).json(resp);
    }

    if (req.method === 'POST') {
      if (!req.auth || String(req.auth.role).toLowerCase() !== 'admin') {
        return res.status(403).json({ status: 'error', message: 'Forbidden' });
      }

      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      const isCsv = contentType.includes('text/csv') || String(req.query.bulk || '').trim() === '1';

      if (!isCsv) {
        const body = await parseJsonBody(req);
        const name = String(body.name || '').trim();
        if (!name) {
          return res.status(400).json({ status: 'error', message: 'Invalid query parameters' });
        }

        const profile = await createProfileFromName(name);
        rememberExistingProfileName(profile.name);
        return res.status(201).json({ status: 'success', data: profile });
      }

      // Handle CSV bulk upload via streaming and batched writes - optimized for large files
      const { uuidv7 } = require('../../src/uuidv7');
      const { utcNow } = require('../../src/helpers');
      const VALID_GENDERS = new Set(['male','female']);

      function parseCsvLine(line) {
        const cols = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (inQuotes) {
            if (ch === '"') {
              if (line[i+1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
            } else { cur += ch; }
          } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { cols.push(cur); cur = ''; }
            else { cur += ch; }
          }
        }
        cols.push(cur);
        return cols.map(c => (c === '' ? '' : c));
      }

      const readline = require('readline');
      const db = await getDb();
      const col = db.collection('profiles');

      const contentEncoding = String(req.headers['content-encoding'] || '').toLowerCase();
      let csvInput = req;
      if (contentEncoding.includes('gzip')) {
        const gunzip = zlib.createGunzip();
        req.pipe(gunzip);
        csvInput = gunzip;
      }

      const rl = readline.createInterface({ input: csvInput, crlfDelay: Infinity });
      let headers = null;
      const BATCH_SIZE = 1000; // Chunked processing aligned with the task guidance
      let batch = [];
      const seenNames = new Set();

      const summary = { status: 'success', total_rows: 0, inserted: 0, skipped: 0, reasons: { duplicate_name: 0, invalid_age: 0, missing_fields: 0, malformed: 0 } };

      const processBatch = async (docs) => {
        if (!docs.length) return;
        const names = docs.map((doc) => doc.name);
        const existingNames = await getExistingNamesForBatch(col, names);

        const insertableDocs = [];
        for (const doc of docs) {
          if (existingNames.has(doc.name)) {
            summary.skipped += 1;
            summary.reasons.duplicate_name += 1;
            continue;
          }
          insertableDocs.push(doc);
        }

        if (!insertableDocs.length) return 0;

        try {
          const result = await col.insertMany(insertableDocs, { ordered: false });
          return result.insertedCount || 0;
        } catch (err) {
          if (err && err.result) {
            return err.result.nInserted || 0;
          }
          return 0;
        }
      };

      for await (const rawLine of rl) {
        if (rawLine === null) continue;
        const line = String(rawLine).replace(/\r?\n$/, '');
        if (line.trim() === '') continue;
        summary.total_rows += 1;

        if (!headers) {
          headers = parseCsvLine(line).map(h => String(h || '').trim());
          continue;
        }

        const cols = parseCsvLine(line);
        if (cols.length !== headers.length) { summary.skipped += 1; summary.reasons.malformed += 1; continue; }

        const row = {};
        for (let i = 0; i < headers.length; i++) row[headers[i]] = cols[i] === '' ? null : cols[i];

        const name = String(row.name || row.Name || '').trim();
        if (!name) { summary.skipped += 1; summary.reasons.missing_fields += 1; continue; }

        // Avoid duplicates within the same file before we hit the database.
        if (seenNames.has(name)) { summary.skipped += 1; summary.reasons.duplicate_name += 1; continue; }

        const gender = row.gender ? String(row.gender).toLowerCase() : null;
        if (!gender || !VALID_GENDERS.has(gender)) { summary.skipped += 1; summary.reasons.missing_fields += 1; continue; }

        const age = row.age ? Number(row.age) : NaN;
        if (!Number.isInteger(age) || age < 0) { summary.skipped += 1; summary.reasons.invalid_age += 1; continue; }

        const doc = {
          id: uuidv7(),
          name: name,
          gender: gender,
          gender_probability: row.gender_probability ? Number(row.gender_probability) : null,
          age: age,
          age_group: row.age_group || null,
          country_id: row.country_id ? String(row.country_id).toUpperCase() : null,
          country_name: row.country_name || null,
          country_probability: row.country_probability ? Number(row.country_probability) : null,
          created_at: utcNow(),
        };

        batch.push(doc);
        seenNames.add(name);

        if (batch.length >= BATCH_SIZE) {
          const inserted = await processBatch(batch);
          summary.inserted += inserted;
          batch = [];
        }
      }

      // Final batch
      if (batch.length) {
        const inserted = await processBatch(batch);
        summary.inserted += inserted;
      }

      return res.status(200).json(summary);
    }

    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  } catch (err) {
    console.error('GET/POST/DELETE /api/profiles error:', err);
    if (err && err.status) {
      return res.status(err.status).json({ status: 'error', message: err.message });
    }
    if (err && err.code === 11000) {
      return res.status(409).json({ status: 'error', message: 'Profile already exists' });
    }
    // Catch MongoDB network timeouts and other connection errors
    if (err && (err.name === 'MongoNetworkTimeoutError' || err.name === 'MongoNetworkError' || err.name === 'MongoTimeoutError')) {
      return res.status(503).json({ status: 'error', message: 'Database temporarily unavailable' });
    }
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

module.exports = protect(
  applyObservability(handler, {
    routeId: 'GET/POST /api/profiles',
    policy: RATE_LIMIT_POLICIES.queryStandard,
  }),
  ['analyst', 'admin']
);