require('dotenv').config();
const https = require('https');
const { getDb } = require('./src/db');
const { createAccessToken } = require('./src/auth');
const { utcNow } = require('./src/helpers');

const base = 'https://insighta-backend-mauve.vercel.app';
const versionHeaders = { 'X-API-Version': '1' };

async function http(method, path, token, body, contentType) {
  const headers = { ...versionHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (contentType) headers['Content-Type'] = contentType;
  const start = Date.now();
  const url = new URL(`${base}${path}`);

  return await new Promise((resolve, reject) => {
    const request = https.request({
      method,
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      headers,
    }, (response) => {
      let chunks = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { chunks += chunk; });
      response.on('end', () => {
        resolve({ status: response.statusCode, ms: Date.now() - start, text: chunks });
      });
    });

    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return text;
  }
}

(async () => {
  const db = await getDb();
  const admin = await db.collection('users').findOne({ username: 'Summiedev' }, { projection: { _id: 0, id: 1, github_id: 1, username: 1, role: 1 } });
  const analyst = await db.collection('users').findOne({ username: 'kayceelayla07' }, { projection: { _id: 0, id: 1, github_id: 1, username: 1, role: 1 } });
  if (!admin || !analyst) throw new Error('Required live users not found');

  const config = {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtIssuer: process.env.JWT_ISSUER || 'insighta-labs-api',
  };

  const adminToken = createAccessToken(admin, config);
  const analystToken = createAccessToken(analyst, config);

  const meAdmin = await http('GET', '/api/v1/auth/me', adminToken);
  const meAnalyst = await http('GET', '/api/v1/auth/me', analystToken);

  const profiles1 = await http('GET', '/api/profiles?gender=female&country_id=NG&min_age=20&max_age=45&page=1&limit=10', analystToken);
  const profiles2 = await http('GET', '/api/profiles?max_age=45&limit=10&country_id=NG&gender=female&min_age=20&page=1', analystToken);
  const search1 = await http('GET', '/api/profiles/search?q=Nigerian%20females%20between%20ages%2020%20and%2045&page=1&limit=10', analystToken);
  const search2 = await http('GET', '/api/profiles/search?q=Women%20aged%2020-45%20living%20in%20Nigeria&page=1&limit=10', analystToken);

  const stamp = utcNow().replace(/[:.]/g, '-');
  const csv = [
    'name,gender,age,country_id,country_name,age_group',
    `Stage4B Live Test ${stamp} A,male,31,NG,Nigeria,adult`,
    `Stage4B Live Test ${stamp} B,female,27,GH,Ghana,adult`,
    `Stage4B Live Test ${stamp} C,male,-4,KE,Kenya,child`,
    `Stage4B Live Test ${stamp} A,male,31,NG,Nigeria,adult`,
  ].join('\n');

  const csvUpload = await http('POST', '/api/profiles?bulk=1', adminToken, csv, 'text/csv');

  await db.collection('profiles').deleteMany({ name: { $in: [
    `Stage4B Live Test ${stamp} A`,
    `Stage4B Live Test ${stamp} B`,
  ] } });

  const summary = {
    auth: {
      admin: { status: meAdmin.status, ms: meAdmin.ms, body: parseJsonSafe(meAdmin.text) },
      analyst: { status: meAnalyst.status, ms: meAnalyst.ms, body: parseJsonSafe(meAnalyst.text) },
    },
    query: {
      first: { status: profiles1.status, ms: profiles1.ms, body: parseJsonSafe(profiles1.text) },
      second: { status: profiles2.status, ms: profiles2.ms, body: parseJsonSafe(profiles2.text) },
      search1: { status: search1.status, ms: search1.ms, body: parseJsonSafe(search1.text) },
      search2: { status: search2.status, ms: search2.ms, body: parseJsonSafe(search2.text) },
    },
    csv: { status: csvUpload.status, ms: csvUpload.ms, body: parseJsonSafe(csvUpload.text) },
  };

  console.log(JSON.stringify(summary, null, 2));
})().catch((err) => {
  console.error(JSON.stringify({ error: err.message, stack: err.stack }, null, 2));
  process.exit(1);
});
