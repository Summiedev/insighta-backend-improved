const { getDb } = require('../../../src/db');
const { setCors, utcNow } = require('../../../src/helpers');
const { uuidv7 } = require('../../../src/uuidv7');
const { applyObservability, RATE_LIMIT_POLICIES } = require('../../../src/middleware/observability');
const {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  buildAuthSetCookieHeaders,
  buildClearAuthCookieHeaders,
  createAccessToken,
  generateRefreshToken,
  getAuthConfig,
  hashRefreshToken,
  parseCookies,
  parseJsonBody,
  utcDatePlusSeconds,
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
    console.error('POST /auth/refresh configuration error:', err);
    return res.status(500).json({ status: 'error', message: 'Auth service misconfigured' });
  }

  try {
    const body = await parseJsonBody(req);
    const cookies = parseCookies(req);

    const cookieRefreshToken = cookies.refresh_token || '';
    const bodyRefreshToken = body && typeof body.refresh_token === 'string' ? body.refresh_token : '';
    const presentedRefreshToken = (cookieRefreshToken || bodyRefreshToken || '').trim();

    if (!presentedRefreshToken) {
      return res.status(400).json({ status: 'error', message: 'Refresh token required' });
    }

    const isCli = Boolean(bodyRefreshToken) || String(req.headers['x-auth-client'] || '').toLowerCase() === 'cli';

    const db = await getDb();
    const refreshTokens = db.collection('refresh_tokens');
    const users = db.collection('users');

    const tokenHash = hashRefreshToken(presentedRefreshToken, config.tokenHashSecret);
    const tokenDoc = await refreshTokens.findOne({ hashed_refresh_token: tokenHash });

    if (!tokenDoc) {
      if (!isCli) {
        res.setHeader('Set-Cookie', buildClearAuthCookieHeaders(config));
      }
      return res.status(401).json({ status: 'error', message: 'Invalid refresh token' });
    }

    const now = Date.now();
    const isExpired = !tokenDoc.expires_at || new Date(tokenDoc.expires_at).getTime() <= now;
    if (tokenDoc.revoked || isExpired) {
      if (tokenDoc.user_id) {
        await refreshTokens.updateMany(
          { user_id: tokenDoc.user_id, revoked: false },
          { $set: { revoked: true, revoked_at: utcNow(), revoke_reason: tokenDoc.revoked ? 'reuse_detected' : 'expired' } }
        );
      }

      if (!isCli) {
        res.setHeader('Set-Cookie', buildClearAuthCookieHeaders(config));
      }

      return res.status(401).json({
        status: 'error',
        message: tokenDoc.revoked ? 'Refresh token reuse detected' : 'Refresh token expired',
      });
    }

    const user = await users.findOne({ id: tokenDoc.user_id });
    if (!user) {
      await refreshTokens.updateOne(
        { _id: tokenDoc._id },
        { $set: { revoked: true, revoked_at: utcNow(), revoke_reason: 'user_missing' } }
      );

      if (!isCli) {
        res.setHeader('Set-Cookie', buildClearAuthCookieHeaders(config));
      }
      return res.status(401).json({ status: 'error', message: 'Invalid refresh token' });
    }

    await refreshTokens.updateOne(
      { _id: tokenDoc._id },
      { $set: { revoked: true, revoked_at: utcNow(), revoke_reason: 'rotated' } }
    );

    const nextRefreshToken = generateRefreshToken();
    await refreshTokens.insertOne({
      id: uuidv7(),
      user_id: user.id,
      hashed_refresh_token: hashRefreshToken(nextRefreshToken, config.tokenHashSecret),
      expires_at: utcDatePlusSeconds(REFRESH_TOKEN_TTL_SECONDS),
      revoked: false,
      created_at: utcNow(),
    });

    const nextAccessToken = createAccessToken(user, config);

    if (isCli) {
      return res.status(200).json({
        status: 'success',
        access_token: nextAccessToken,
        refresh_token: nextRefreshToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_expires_in: REFRESH_TOKEN_TTL_SECONDS,
      });
    }

    res.setHeader('Set-Cookie', buildAuthSetCookieHeaders(nextAccessToken, nextRefreshToken, config));
    return res.status(200).json({
      status: 'success',
      access_token: nextAccessToken,
      refresh_token: nextRefreshToken,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_expires_in: REFRESH_TOKEN_TTL_SECONDS,
    });
  } catch (err) {
    console.error('POST /auth/refresh error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

module.exports = applyObservability(handler, {
  routeId: 'POST /auth/refresh',
  policy: RATE_LIMIT_POLICIES.authStrict,
});