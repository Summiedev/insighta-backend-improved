const crypto = require('crypto');
const { getDb } = require('../../../../src/db');
const { utcNow, setCors } = require('../../../../src/helpers');
const { uuidv7 } = require('../../../../src/uuidv7');
const { applyObservability, RATE_LIMIT_POLICIES } = require('../../../../src/middleware/observability');
const {
  STATE_TTL_SECONDS,
  buildGithubAuthorizeUrl,
  generatePkcePair,
  generateState,
  getAuthConfig,
  hashState,
  utcDatePlusSeconds,
} = require('../../../../src/auth');

async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  let config;
  try {
    config = getAuthConfig();
  } catch (err) {
    console.error('GET /auth/github configuration error:', err);
    return res.status(500).json({ status: 'error', message: 'Auth service misconfigured' });
  }

  const clientMode = String(req.query.client || req.query.mode || 'browser').toLowerCase() === 'cli'
    ? 'cli'
    : 'browser';

  const cliRedirectUri = String(req.query.redirect_uri || req.query.redirectUri || '').trim();
  if (clientMode === 'cli' && cliRedirectUri) {
    const isLocalCallback = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/(callback|auth\/github\/callback)\/?$/i.test(cliRedirectUri);
    let isDeployedCallback = false;
    try {
      const configured = new URL(config.githubRedirectUri);
      const requested = new URL(cliRedirectUri);
      const sameOrigin = configured.origin === requested.origin;
      const deployedPath = requested.pathname.replace(/\/+$/, '');
      isDeployedCallback = sameOrigin && deployedPath === '/auth/github/callback';
    } catch (_err) {
      isDeployedCallback = false;
    }

    if (!isLocalCallback && !isDeployedCallback) {
      return res.status(400).json({ status: 'error', message: 'Invalid query parameters' });
    }
  }

  const suppliedState = String(req.query.state || '').trim();
  const suppliedCodeVerifier = String(req.query.code_verifier || '').trim();
  const suppliedCodeChallenge = String(req.query.code_challenge || '').trim();

  const generatedPkce = generatePkcePair();
  const state = suppliedState || generateState();
  const codeVerifier = suppliedCodeVerifier || generatedPkce.codeVerifier;
  const codeChallenge = suppliedCodeChallenge || (suppliedCodeVerifier
    ? crypto.createHash('sha256').update(suppliedCodeVerifier).digest('base64url')
    : generatedPkce.codeChallenge);
  const stateHash = hashState(state, config.tokenHashSecret);
  // For CLI mode use the provided CLI redirect or configured redirect.
  // For browser mode, build a redirect URI that points to this backend instance
  // so GitHub will callback to the server (not the CLI local callback).
  const redirectUri = clientMode === 'cli'
    ? (cliRedirectUri || config.githubRedirectUri)
    : (() => {
      const proto = (req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol'] || 'http').split(',')[0].trim();
      const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${process.env.PORT || 3000}`;
      // Ensure we create a host without path, keep port when present
      const origin = host.startsWith('localhost') || host.includes(':') ? `${proto}://${host}` : `${proto}://${host}`;
      return `${origin.replace(/\/$/, '')}/auth/github/callback`;
    })();

  try {
    const db = await getDb();
    await db.collection('auth_states').insertOne({
      id: uuidv7(),
      state_hash: stateHash,
      code_verifier: codeVerifier,
      client_mode: clientMode,
      redirect_uri: redirectUri,
      created_at: utcNow(),
      expires_at: utcDatePlusSeconds(STATE_TTL_SECONDS),
    });

    const authorizeUrl = buildGithubAuthorizeUrl({ ...config, githubRedirectUri: redirectUri }, state, codeChallenge);

    if (clientMode === 'cli') {
      return res.status(200).json({
        status: 'success',
        data: {
          authorization_url: authorizeUrl,
          state,
          expires_in: STATE_TTL_SECONDS,
        },
      });
    }

    res.setHeader('Location', authorizeUrl);
    return res.status(302).end();
  } catch (err) {
    console.error('GET /auth/github error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

module.exports = applyObservability(handler, {
  routeId: 'GET /auth/github',
  policy: RATE_LIMIT_POLICIES.authStrict,
});