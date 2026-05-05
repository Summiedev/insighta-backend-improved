const crypto = require('crypto');

const ACCESS_TOKEN_TTL_SECONDS = 3 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 5 * 60;
const STATE_TTL_SECONDS = 10 * 60;

function utcDatePlusSeconds(seconds) {
  return new Date(Date.now() + (seconds * 1000));
}

function parseBooleanEnv(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function splitCsv(value) {
  if (!value) return new Set();
  return new Set(
    String(value)
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

function splitCsvLower(value) {
  if (!value) return new Set();
  return new Set(
    String(value)
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getAuthConfig() {
  const missing = [];
  if (!process.env.GITHUB_CLIENT_ID) missing.push('GITHUB_CLIENT_ID');
  if (!process.env.GITHUB_CLIENT_SECRET) missing.push('GITHUB_CLIENT_SECRET');
  if (!process.env.GITHUB_REDIRECT_URI) missing.push('GITHUB_REDIRECT_URI');
  if (!process.env.JWT_ACCESS_SECRET) missing.push('JWT_ACCESS_SECRET');

  if (missing.length) {
    throw new Error(`Missing required auth environment variables: ${missing.join(', ')}`);
  }

  return {
    githubClientId: process.env.GITHUB_CLIENT_ID,
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
    githubRedirectUri: process.env.GITHUB_REDIRECT_URI,
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtIssuer: process.env.JWT_ISSUER || 'insighta-labs-api',
    tokenHashSecret: process.env.AUTH_TOKEN_HASH_SECRET || process.env.JWT_ACCESS_SECRET,
    cookieDomain: process.env.AUTH_COOKIE_DOMAIN || '',
    cookieSecure: parseBooleanEnv(process.env.AUTH_COOKIE_SECURE, true),
    adminGithubIds: splitCsv(process.env.AUTH_ADMIN_GITHUB_IDS),
    adminGithubUsernames: splitCsvLower(process.env.AUTH_ADMIN_GITHUB_USERNAMES),
  };
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function sha256Base64Url(input) {
  return crypto.createHash('sha256').update(input).digest('base64url');
}

function randomBase64Url(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function generatePkcePair() {
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = sha256Base64Url(codeVerifier);
  return { codeVerifier, codeChallenge };
}

function generateState() {
  return randomBase64Url(32);
}

function hashState(state, secret) {
  return sha256Hex(`${secret}:${state}`);
}

function hashRefreshToken(refreshToken, secret) {
  return sha256Hex(`${secret}:${refreshToken}`);
}

function base64UrlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function createAccessToken(user, config) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    github_id: user.github_id,
    username: user.username,
    role: user.role,
    iat: issuedAt,
    exp: issuedAt + ACCESS_TOKEN_TTL_SECONDS,
    iss: config.jwtIssuer,
  };

  const headerEncoded = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payloadEncoded = base64UrlJson(payload);
  const signature = crypto
    .createHmac('sha256', config.jwtAccessSecret)
    .update(`${headerEncoded}.${payloadEncoded}`)
    .digest('base64url');

  return `${headerEncoded}.${payloadEncoded}.${signature}`;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

function verifyAccessToken(token, config) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerEncoded, payloadEncoded, signatureEncoded] = parts;

  let header;
  let payload;
  try {
    header = safeJsonParse(Buffer.from(headerEncoded, 'base64url').toString('utf8'));
    payload = safeJsonParse(Buffer.from(payloadEncoded, 'base64url').toString('utf8'));
  } catch (_err) {
    return null;
  }

  if (!header || header.alg !== 'HS256' || !payload) return null;

  const expectedSignature = crypto
    .createHmac('sha256', config.jwtAccessSecret)
    .update(`${headerEncoded}.${payloadEncoded}`)
    .digest('base64url');

  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signatureEncoded || '');
  if (expectedBuffer.length !== actualBuffer.length) return null;

  if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (payload.iss && payload.iss !== config.jwtIssuer) return null;
  if (!payload.sub || !payload.role) return null;

  return payload;
}

function generateRefreshToken() {
  return randomBase64Url(64);
}

function serializeCookie(name, value, options = {}) {
  const attrs = [`${name}=${encodeURIComponent(value)}`];

  attrs.push(`Path=${options.path || '/'}`);
  if (options.maxAge !== undefined) attrs.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.httpOnly !== false) attrs.push('HttpOnly');
  if (options.secure !== false) attrs.push('Secure');
  attrs.push(`SameSite=${options.sameSite || 'Strict'}`);
  if (options.domain) attrs.push(`Domain=${options.domain}`);

  return attrs.join('; ');
}

function buildAuthSetCookieHeaders(accessToken, refreshToken, config) {
  const baseOptions = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'None',
    domain: config.cookieDomain || undefined,
  };

  return [
    serializeCookie('access_token', accessToken, {
      ...baseOptions,
      path: '/',
      maxAge: ACCESS_TOKEN_TTL_SECONDS,
    }),
    serializeCookie('refresh_token', refreshToken, {
      ...baseOptions,
      path: '/auth',
      maxAge: REFRESH_TOKEN_TTL_SECONDS,
    }),
  ];
}

function buildClearAuthCookieHeaders(config) {
  const baseOptions = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'None',
    domain: config.cookieDomain || undefined,
    maxAge: 0,
  };

  return [
    serializeCookie('access_token', '', { ...baseOptions, path: '/' }),
    serializeCookie('refresh_token', '', { ...baseOptions, path: '/auth' }),
  ];
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = {};

  cookieHeader.split(';').forEach((chunk) => {
    const idx = chunk.indexOf('=');
    if (idx < 0) return;
    const key = chunk.slice(0, idx).trim();
    const value = chunk.slice(idx + 1).trim();
    if (!key) return;
    cookies[key] = decodeURIComponent(value);
  });

  return cookies;
}

async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch (_err) {
      return {};
    }
  }

  return {};
}

function buildGithubAuthorizeUrl(config, state, codeChallenge) {
  const params = new URLSearchParams({
    client_id: config.githubClientId,
    redirect_uri: config.githubRedirectUri,
    scope: 'read:user user:email',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

async function exchangeGithubCodeForToken(config, code, codeVerifier, redirectUri) {
  const body = new URLSearchParams({
    client_id: config.githubClientId,
    client_secret: config.githubClientSecret,
    code,
    redirect_uri: redirectUri || config.githubRedirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'insighta-labs-api',
    },
    body: body.toString(),
  });

  const data = await response.json();
  if (!response.ok || data.error || !data.access_token) {
    const detail = data.error_description || data.error || 'token exchange failed';
    throw new Error(`GitHub token exchange failed: ${detail}`);
  }

  return data.access_token;
}

async function fetchGithubUser(accessToken) {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'insighta-labs-api',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch GitHub user profile: ${response.status}`);
  }

  return response.json();
}

async function fetchGithubPrimaryEmail(accessToken) {
  const response = await fetch('https://api.github.com/user/emails', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'insighta-labs-api',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    return null;
  }

  const emails = await response.json();
  if (!Array.isArray(emails)) return null;

  const primaryVerified = emails.find((email) => email.primary && email.verified);
  if (primaryVerified && primaryVerified.email) return primaryVerified.email;

  const verified = emails.find((email) => email.verified);
  if (verified && verified.email) return verified.email;

  return null;
}

function resolveUserRole(config, githubProfile, existingRole) {
  const githubId = String(githubProfile.id || '');
  const username = String(githubProfile.login || '').toLowerCase();

  if (config.adminGithubIds.has(githubId) || config.adminGithubUsernames.has(username)) {
    return 'admin';
  }

  return existingRole || 'analyst';
}

module.exports = {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  STATE_TTL_SECONDS,
  buildAuthSetCookieHeaders,
  buildClearAuthCookieHeaders,
  buildGithubAuthorizeUrl,
  createAccessToken,
  exchangeGithubCodeForToken,
  fetchGithubPrimaryEmail,
  fetchGithubUser,
  generatePkcePair,
  generateRefreshToken,
  generateState,
  getAuthConfig,
  hashRefreshToken,
  hashState,
  parseCookies,
  parseJsonBody,
  resolveUserRole,
  utcDatePlusSeconds,
  verifyAccessToken,
};