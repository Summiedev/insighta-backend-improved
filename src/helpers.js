function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function parseAllowedOrigins() {
  const raw = process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:4000,http://127.0.0.1:4000';
  const origins = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const portalUrl = String(process.env.APP_URL || '').trim();
  if (portalUrl) {
    try {
      const origin = new URL(portalUrl).origin;
      if (!origins.includes(origin)) {
        origins.push(origin);
      }
    } catch (_err) {
      // Ignore invalid portal URLs and keep the existing allowlist intact.
    }
  }

  return origins;
}

function formatProfile(p) {
  return {
    id:                  p.id,
    name:                p.name,
    gender:              p.gender,
    gender_probability:  p.gender_probability,
    age:                 p.age,
    age_group:           p.age_group,
    country_id:          p.country_id,
    country_name:        p.country_name,
    country_probability: p.country_probability,
    created_at:          p.created_at,
  };
}

function requireApiVersion(req, res) {
  const version = String(req && req.headers ? (req.headers['x-api-version'] || req.headers['X-API-Version']) : '').trim();

  if (version !== '1') {
    res.status(400).json({ status: 'error', message: 'API version header required' });
    return false;
  }

  return true;
}

function getRequestPath(req, fallbackPath) {
  try {
    if (req && req.url) {
      return new URL(req.url, 'http://localhost').pathname;
    }
  } catch (_err) {
    // ignore malformed URLs in local test mocks
  }

  return fallbackPath || '/api/profiles';
}

function buildPaginationLinks(req, page, limit, total, fallbackPath) {
  const pathname = getRequestPath(req, fallbackPath);
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  const makeLink = (targetPage) => {
    if (!targetPage || targetPage < 1 || totalPages === 0 || targetPage > totalPages) {
      return null;
    }

    const url = new URL(`http://localhost${pathname}`);
    const query = new URLSearchParams();

    if (req && req.query) {
      Object.keys(req.query).forEach((key) => {
        const value = req.query[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          query.set(key, String(value));
        }
      });
    }

    query.set('page', String(targetPage));
    query.set('limit', String(limit));
    url.search = query.toString();
    return `${url.pathname}${url.search}`;
  };

  return {
    self: makeLink(page),
    next: makeLink(page + 1),
    prev: makeLink(page - 1),
  };
}

function setCors(res, req) {
  const allowedOrigins = parseAllowedOrigins();
  const requestOrigin = req && req.headers ? req.headers.origin : '';
  const wildcard = allowedOrigins.includes('*');
  const originAllowed = wildcard || (requestOrigin && allowedOrigins.includes(requestOrigin));

  if (originAllowed && requestOrigin) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else if (wildcard) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin || '*');
    if (requestOrigin) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Version, x-api-version, x-auth-client, x-csrf-token, x-request-id, x-seed-secret');
}

module.exports = { utcNow, formatProfile, setCors, requireApiVersion, buildPaginationLinks };
