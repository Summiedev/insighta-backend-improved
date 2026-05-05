const { getDb } = require('../db');
const { setCors } = require('../helpers');
const { getAuthConfig, parseCookies, verifyAccessToken } = require('../auth');

function unauthorized(res) {
  return res.status(401).json({ status: 'error', message: 'Unauthorized' });
}

function forbidden(res) {
  return res.status(403).json({ status: 'error', message: 'Forbidden' });
}

function readAccessToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  const cookieHeader = req.headers.cookie || '';
  console.log('[AUTH] 🔍 Cookie header:', cookieHeader ? `"${cookieHeader}"` : '<EMPTY>');
  
  const cookies = parseCookies(req);
  const token = (cookies.access_token || '').trim();
  
  if (!token) {
    console.error('[AUTH] ❌ NO_TOKEN - access_token cookie not found. Available cookies:', Object.keys(cookies));
  } else {
    console.log('[AUTH] ✅ Found access_token cookie, length:', token.length);
  }
  
  return token;
}

function authenticate() {
  return function withAuthentication(handler) {
    return async function authenticatedHandler(req, res) {
      setCors(res, req);
      if (req.method === 'OPTIONS') return handler(req, res);

      let config;
      try {
        config = getAuthConfig();
      } catch (err) {
        console.error('Auth configuration error:', err);
        return res.status(500).json({ status: 'error', message: 'Auth service misconfigured' });
      }

      const token = readAccessToken(req);
      if (!token) {
        return unauthorized(res);
      }

      const payload = verifyAccessToken(token, config);
      if (!payload) {
        console.error('[AUTH] ❌ TOKEN_VERIFICATION_FAILED - signature invalid or expired');
        return unauthorized(res);
      }
      console.log('[AUTH] ✅ Token verified');

      const db = await getDb();
      console.log('[AUTH] 🔍 Looking up user with id:', payload.sub);
      const user = await db.collection('users').findOne({ id: payload.sub }, { projection: { _id: 0 } });

      if (!user) {
        console.error('[AUTH] ❌ USER_LOOKUP_FAILED - no user with id:', payload.sub);
        console.error('[AUTH] Queried collection "users" with { id: "' + payload.sub + '" }');
        return unauthorized(res);
      }
      console.log('[AUTH] ✅ User found:', user.username);

      if (user.is_active === false) {
        console.warn(`Auth: User ${payload.sub} is inactive`);
        return forbidden(res);
      }

      req.auth = {
        userId: user.id,
        role: user.role,
        username: user.username,
        githubId: user.github_id,
        user,
      };

      return handler(req, res);
    };
  };
}

function authorize(roles) {
  const allowedRoles = new Set((roles || []).map((role) => String(role).toLowerCase()));

  return function withAuthorization(handler) {
    return async function authorizedHandler(req, res) {
      setCors(res, req);
      if (req.method === 'OPTIONS') return handler(req, res);

      if (!req.auth || !req.auth.role) {
        return unauthorized(res);
      }

      if (!allowedRoles.has(String(req.auth.role).toLowerCase())) {
        return forbidden(res);
      }

      return handler(req, res);
    };
  };
}

function protect(handler, roles) {
  return authenticate()(authorize(roles)(handler));
}

module.exports = {
  authenticate,
  authorize,
  protect,
};
