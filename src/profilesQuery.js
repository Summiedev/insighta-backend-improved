const { getDb } = require('./db');
const { buildQuery } = require('./queryBuilder');
const { buildPaginationLinks, formatProfile } = require('./helpers');

function buildSearchQueryRaw(reqQuery, nlFilters) {
  return {
    ...nlFilters,
    page: reqQuery.page || 1,
    limit: reqQuery.limit || 10,
    sort_by: reqQuery.sort_by,
    order: reqQuery.order,
  };
}

function buildPaginationMeta(req, page, limit, total, fallbackPath) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / page);
  return {
    page: Number(page),
    limit: Number(limit),
    total: Number(total),
    total_pages: totalPages,
    has_next: totalPages > 0 && page < totalPages,
    has_prev: totalPages > 0 && page > 1,
    links: buildPaginationLinks(req, Number(page), Number(limit), Number(total), fallbackPath),
  };
}

async function runProfilesQuery(reqOrRaw, maybeRaw, fallbackPath) {
  const req = maybeRaw === undefined ? null : reqOrRaw;
  const raw = maybeRaw === undefined ? reqOrRaw : maybeRaw;
  const { mongoFilter, sort, page, limit } = buildQuery(raw);

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

  return {
    ...buildPaginationMeta(req, page, limit, total, fallbackPath),
    data: rows.map(formatProfile),
  };
}

async function createProfilesExportCursor(raw, exportLimit) {
  const { mongoFilter, sort } = buildQuery(raw);

  const db = await getDb();
  const col = db.collection('profiles');

  return col.find(mongoFilter)
    .sort(sort)
    .limit(exportLimit);
}

module.exports = {
  buildSearchQueryRaw,
  createProfilesExportCursor,
  runProfilesQuery,
};