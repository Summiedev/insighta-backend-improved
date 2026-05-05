// Deterministic normalization of filter objects so semantically-equal
// queries produce identical canonical forms for cache keys.

function normalizeFilters(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};

  const setIf = (k, v) => {
    if (v === undefined || v === null) return;
    if (typeof v === 'string' && v.trim() === '') return;
    out[k] = v;
  };

  // Gender
  if (raw.gender !== undefined) setIf('gender', String(raw.gender).toLowerCase());

  // Age group
  if (raw.age_group !== undefined) setIf('age_group', String(raw.age_group).toLowerCase());

  // Country id -> uppercase
  if (raw.country_id !== undefined) setIf('country_id', String(raw.country_id).toUpperCase());

  // Numeric ranges
  if (raw.min_age !== undefined) setIf('min_age', Number(raw.min_age));
  if (raw.max_age !== undefined) setIf('max_age', Number(raw.max_age));
  if (raw.min_gender_probability !== undefined) setIf('min_gender_probability', Number(raw.min_gender_probability));
  if (raw.min_country_probability !== undefined) setIf('min_country_probability', Number(raw.min_country_probability));

  // Sort/order/page/limit
  if (raw.sort_by !== undefined) setIf('sort_by', String(raw.sort_by));
  if (raw.order !== undefined) setIf('order', String(raw.order).toLowerCase());
  if (raw.page !== undefined) setIf('page', Number(raw.page));
  if (raw.limit !== undefined) setIf('limit', Number(raw.limit));

  // Normalize age bounds: ensure min <= max when both present
  if (out.min_age !== undefined && out.max_age !== undefined) {
    if (Number.isFinite(out.min_age) && Number.isFinite(out.max_age) && out.min_age > out.max_age) {
      const tmp = out.min_age; out.min_age = out.max_age; out.max_age = tmp;
    }
  }

  // Remove NaN values
  Object.keys(out).forEach((k) => { if (typeof out[k] === 'number' && !Number.isFinite(out[k])) delete out[k]; });

  // Return keys in deterministic order
  const ordered = {};
  Object.keys(out).sort().forEach((k) => { ordered[k] = out[k]; });
  return ordered;
}

function canonicalKeyFromNormalized(norm) {
  // Build stable JSON key from sorted entries (norm is already sorted by keys)
  const parts = [];
  for (const k of Object.keys(norm)) {
    const v = norm[k];
    parts.push(`${k}:${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  }
  return parts.join('|');
}

module.exports = { normalizeFilters, canonicalKeyFromNormalized };
