const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const { getDb } = require('./src/db');
const { createAccessToken } = require('./src/auth');
const { utcNow } = require('./src/helpers');
const { parseNL } = require('./src/nlParser');
const { normalizeFilters, canonicalKeyFromNormalized } = require('./src/queryNormalizer');

const BASE_URL = 'https://insighta-backend-mauve.vercel.app';
const BACKEND_IP = '216.198.79.195';
const SAVED_CSV_PATH = path.join(__dirname, '.tmp-live-500k-upload.csv');
const LIVE_CHECK_USERNAMES = {
  admin: 'Summiedev',
  analyst: 'kayceelayla07',
};

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return text;
  }
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function httpRequest(method, pathName, token, body, contentType) {
  const url = new URL(`${BASE_URL}${pathName}`);
  const startedAt = Date.now();
  const headers = {
    'X-API-Version': '1',
    Connection: 'keep-alive',
    Host: url.hostname,
  };

  if (token) headers.Authorization = `Bearer ${token}`;
  if (contentType) headers['Content-Type'] = contentType;
  if (body && typeof body === 'string') headers['Content-Length'] = Buffer.byteLength(body);

  return new Promise((resolve, reject) => {
    const request = https.request({
      method,
      hostname: BACKEND_IP,
      path: `${url.pathname}${url.search}`,
      servername: url.hostname,
      timeout: 0,
      headers,
      agent: new https.Agent({ keepAlive: true, maxSockets: 1 }),
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          ms: Date.now() - startedAt,
          body: parseJsonSafe(text),
        });
      });
    });

    request.on('error', reject);
    if (body) request.end(body);
    else request.end();
  });
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function logSection(title) {
  console.log(`\n== ${title} ==`);
}

function localChecks() {
  logSection('Local Checks');

  const q1 = parseNL('Nigerian females between ages 20 and 45');
  const q2 = parseNL('Women aged 20-45 living in Nigeria');
  assertCondition(deepEqual(q1, q2), 'NL parser equivalence failed');

  const norm1 = normalizeFilters({ gender: 'FEMALE', country_id: 'ng', min_age: 45, max_age: 20, page: '1', limit: '10' });
  const norm2 = normalizeFilters({ max_age: 45, limit: 10, country_id: 'NG', gender: 'female', min_age: 20, page: 1 });
  assertCondition(canonicalKeyFromNormalized(norm1) === canonicalKeyFromNormalized(norm2), 'Normalization cache key mismatch');

  const csvExists = fs.existsSync(SAVED_CSV_PATH);
  const csvStats = csvExists ? fs.statSync(SAVED_CSV_PATH) : null;

  const result = {
    nl_parser_equivalence: true,
    normalization_equivalence: true,
    saved_csv: csvExists ? {
      path: SAVED_CSV_PATH,
      size_bytes: csvStats.size,
      size_mb: Number((csvStats.size / 1024 / 1024).toFixed(2)),
      modified: csvStats.mtime,
    } : null,
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function getLiveUsers() {
  const db = await getDb();
  const users = await db.collection('users').find(
    { username: { $in: [LIVE_CHECK_USERNAMES.admin, LIVE_CHECK_USERNAMES.analyst] } },
    { projection: { _id: 0, id: 1, github_id: 1, username: 1, role: 1 } }
  ).toArray();

  const byUsername = new Map(users.map((user) => [user.username, user]));
  const admin = byUsername.get(LIVE_CHECK_USERNAMES.admin);
  const analyst = byUsername.get(LIVE_CHECK_USERNAMES.analyst);

  assertCondition(admin, `Live admin user not found: ${LIVE_CHECK_USERNAMES.admin}`);
  assertCondition(analyst, `Live analyst user not found: ${LIVE_CHECK_USERNAMES.analyst}`);

  return { admin, analyst };
}

function makeToken(user) {
  return createAccessToken(user, {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtIssuer: process.env.JWT_ISSUER || 'insighta-labs-api',
  });
}

function buildSmallCsv() {
  const stamp = utcNow().replace(/[:.]/g, '-');
  return [
    'name,gender,age,country_id,country_name,age_group',
    `Stage4B Check ${stamp} A,male,31,NG,Nigeria,adult`,
    `Stage4B Check ${stamp} B,female,27,GH,Ghana,adult`,
    `Stage4B Check ${stamp} C,male,-4,KE,Kenya,child`,
    `Stage4B Check ${stamp} A,male,31,NG,Nigeria,adult`,
  ].join('\n');
}

async function liveChecks() {
  logSection('Live Checks');

  const { admin, analyst } = await getLiveUsers();
  const adminToken = makeToken(admin);
  const analystToken = makeToken(analyst);

  const adminMe = await httpRequest('GET', '/api/v1/auth/me', adminToken);
  const analystMe = await httpRequest('GET', '/api/v1/auth/me', analystToken);
  assertCondition(adminMe.status === 200, 'Admin /auth/me failed');
  assertCondition(analystMe.status === 200, 'Analyst /auth/me failed');

  const structuredA = await httpRequest('GET', '/api/profiles?gender=female&country_id=NG&min_age=20&max_age=45&page=1&limit=10', analystToken);
  const structuredB = await httpRequest('GET', '/api/profiles?max_age=45&limit=10&country_id=NG&gender=female&min_age=20&page=1', analystToken);
  assertCondition(structuredA.status === 200, 'Structured query first request failed');
  assertCondition(structuredB.status === 200, 'Structured query second request failed');
  assertCondition(deepEqual(structuredA.body, structuredB.body), 'Structured query cache/normalization mismatch');

  const searchA = await httpRequest('GET', '/api/profiles/search?q=Nigerian%20females%20between%20ages%2020%20and%2045&page=1&limit=10', analystToken);
  const searchB = await httpRequest('GET', '/api/profiles/search?q=Women%20aged%2020-45%20living%20in%20Nigeria&page=1&limit=10', analystToken);
  assertCondition(searchA.status === 200, 'Search query A failed');
  assertCondition(searchB.status === 200, 'Search query B failed');
  assertCondition(deepEqual(searchA.body, searchB.body), 'NL query equivalence mismatch');

  const csvUpload = await httpRequest('POST', '/api/profiles?bulk=1', adminToken, buildSmallCsv(), 'text/csv');
  assertCondition(csvUpload.status === 200, 'Small CSV upload failed');

  const summary = {
    auth: {
      admin: { status: adminMe.status, ms: adminMe.ms, body: adminMe.body },
      analyst: { status: analystMe.status, ms: analystMe.ms, body: analystMe.body },
    },
    query: {
      structured_first: { status: structuredA.status, ms: structuredA.ms, body: structuredA.body },
      structured_second: { status: structuredB.status, ms: structuredB.ms, body: structuredB.body },
      nl_first: { status: searchA.status, ms: searchA.ms, body: searchA.body },
      nl_second: { status: searchB.status, ms: searchB.ms, body: searchB.body },
    },
    csv: { status: csvUpload.status, ms: csvUpload.ms, body: csvUpload.body },
  };

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

function fullCsvCheck() {
  logSection('Full CSV Check');

  const runner = spawnSync(process.execPath, [
    path.join(__dirname, '.tmp-auto-500k-chunked-upload.js'),
    '500000',
    '2500',
    '0',
    '0',
    '1',
  ], {
    cwd: __dirname,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
  });

  if (runner.stdout) process.stdout.write(runner.stdout);
  if (runner.stderr) process.stderr.write(runner.stderr);
  assertCondition(runner.status === 0, `Full CSV check failed with exit code ${runner.status}`);

  return { exitCode: runner.status };
}

(async () => {
  const args = new Set(process.argv.slice(2));
  const runLocal = !args.has('--live-only');
  const runLive = !args.has('--local-only');
  const runFull = args.has('--full-csv');

  const report = {};
  if (runLocal) report.local = localChecks();
  if (runLive) report.live = await liveChecks();
  if (runFull) report.full_csv = fullCsvCheck();

  console.log('\nFINAL_REPORT ' + JSON.stringify(report, null, 2));
})().catch((err) => {
  console.error('\n' + JSON.stringify({ error: err.message, stack: err.stack }, null, 2));
  process.exit(1);
});
