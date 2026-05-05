/**
 * queryBuilder.js — Builds a MongoDB filter object + sort/pagination options
 * from a flat filters object. Shared by both /api/profiles and /api/profiles/search.
 */

const VALID_GENDERS    = new Set(['male', 'female']);
const VALID_AGE_GROUPS = new Set(['child', 'teenager', 'adult', 'senior']);
const VALID_SORT_BY    = new Set(['age', 'created_at', 'gender_probability']);
const VALID_ORDERS     = new Set(['asc', 'desc']);

/**
 * Validates and builds query components from a raw filters object.
 *
 * @param {object} raw  - flat key/value params (strings from query string or NL parser)
 * @returns {{ mongoFilter, sort, page, limit }}
 * @throws {{ status, message }} on validation failure
 */
function buildQuery(raw) {
  const mongoFilter = {};

  // ── gender ────────────────────────────────────────────────────────────────
  if (raw.gender !== undefined && raw.gender !== null && raw.gender !== '') {
    const g = String(raw.gender).toLowerCase();
    if (!VALID_GENDERS.has(g)) {
      throw { status: 422, message: "Invalid query parameters" };
    }
    mongoFilter.gender = g;
  }

  // ── age_group ─────────────────────────────────────────────────────────────
  if (raw.age_group !== undefined && raw.age_group !== null && raw.age_group !== '') {
    const ag = String(raw.age_group).toLowerCase();
    if (!VALID_AGE_GROUPS.has(ag)) {
      throw { status: 422, message: "Invalid query parameters" };
    }
    mongoFilter.age_group = ag;
  }

  // ── country_id ────────────────────────────────────────────────────────────
  if (raw.country_id !== undefined && raw.country_id !== null && raw.country_id !== '') {
    mongoFilter.country_id = String(raw.country_id).toUpperCase();
  }

  // ── min_age / max_age ─────────────────────────────────────────────────────
  const ageFilter = {};
  if (raw.min_age !== undefined && raw.min_age !== null && raw.min_age !== '') {
    const v = Number(raw.min_age);
    if (!Number.isInteger(v) || v < 0) throw { status: 422, message: "Invalid query parameters" };
    ageFilter.$gte = v;
  }
  if (raw.max_age !== undefined && raw.max_age !== null && raw.max_age !== '') {
    const v = Number(raw.max_age);
    if (!Number.isInteger(v) || v < 0) throw { status: 422, message: "Invalid query parameters" };
    ageFilter.$lte = v;
  }
  if (Object.keys(ageFilter).length) mongoFilter.age = ageFilter;

  // ── min_gender_probability ────────────────────────────────────────────────
  if (raw.min_gender_probability !== undefined && raw.min_gender_probability !== null && raw.min_gender_probability !== '') {
    const v = Number(raw.min_gender_probability);
    if (isNaN(v) || v < 0 || v > 1) throw { status: 422, message: "Invalid query parameters" };
    mongoFilter.gender_probability = { $gte: v };
  }

  // ── min_country_probability ───────────────────────────────────────────────
  if (raw.min_country_probability !== undefined && raw.min_country_probability !== null && raw.min_country_probability !== '') {
    const v = Number(raw.min_country_probability);
    if (isNaN(v) || v < 0 || v > 1) throw { status: 422, message: "Invalid query parameters" };
    mongoFilter.country_probability = { $gte: v };
  }

  // ── sort ──────────────────────────────────────────────────────────────────
  const sortBy = raw.sort_by || 'created_at';
  const order  = (raw.order || 'asc').toLowerCase();

  if (!VALID_SORT_BY.has(sortBy)) throw { status: 422, message: "Invalid query parameters" };
  if (!VALID_ORDERS.has(order))   throw { status: 422, message: "Invalid query parameters" };

  const sort = { [sortBy]: order === 'asc' ? 1 : -1 };

  // ── pagination ────────────────────────────────────────────────────────────
  const page = Math.max(1, Math.floor(parseInt(raw.page, 10)) || 1);
  let   limit = Math.floor(parseInt(raw.limit, 10));
  if (isNaN(limit) || limit < 1) limit = 10;
  if (limit > 50) limit = 50;

  return { mongoFilter, sort, page, limit };
}

module.exports = { buildQuery };
