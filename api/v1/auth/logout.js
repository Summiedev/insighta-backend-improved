const { getDb } = require('../../../src/db');
const { setCors, utcNow } = require('../../../src/helpers');
const { applyObservability, RATE_LIMIT_POLICIES } = require('../../../src/middleware/observability');
const {
  buildClearAuthCookieHeaders,
  getAuthConfig,
  hashRefreshToken,
  parseCookies,
  parseJsonBody,
} = require('../../../src/auth');

async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  let config;
  try {
    config = getAuthConfig();
  } catch (err) {
    console.error('POST /auth/logout configuration error:', err);
    return res.status(500).json({ status: 'error', message: 'Auth service misconfigured' });
  }

  try {
    const body = await parseJsonBody(req);
    const cookies = parseCookies(req);

    const cookieRefreshToken = cookies.refresh_token || '';
    const bodyRefreshToken = body && typeof body.refresh_token === 'string' ? body.refresh_token : '';
    const presentedRefreshToken = (cookieRefreshToken || bodyRefreshToken || '').trim();

    if (presentedRefreshToken) {
      const db = await getDb();
      await db.collection('refresh_tokens').updateOne(
        {
          hashed_refresh_token: hashRefreshToken(presentedRefreshToken, config.tokenHashSecret),
          revoked: false,
        },
        {
          $set: {
            revoked: true,
            revoked_at: utcNow(),
            revoke_reason: 'logout',
          },
        }
      );
    }

    res.setHeader('Set-Cookie', buildClearAuthCookieHeaders(config));
    return res.status(200).json({ status: 'success', message: 'Logged out' });
  } catch (err) {
    console.error('POST /auth/logout error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

module.exports = applyObservability(handler, {
  routeId: 'POST /auth/logout',
  policy: RATE_LIMIT_POLICIES.authStrict,
});