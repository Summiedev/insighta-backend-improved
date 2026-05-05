const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createAccessToken } = require('./src/auth');

const CSV_PATH = path.join(__dirname, '.tmp-live-500k-upload.csv');
const BASE_URL = 'https://insighta-backend-mauve.vercel.app';
const BACKEND_IP = '216.198.79.195';

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return text;
  }
}

function uploadSavedCsv(token) {
  const url = new URL('/api/profiles?bulk=1', BASE_URL);
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      hostname: BACKEND_IP,
      path: `${url.pathname}${url.search}`,
      servername: url.hostname,
      timeout: 0,
      headers: {
        Host: url.hostname,
        Authorization: `Bearer ${token}`,
        'X-API-Version': '1',
        'Content-Type': 'text/csv',
        'Content-Encoding': 'gzip',
        Connection: 'keep-alive',
      },
      agent: new https.Agent({ keepAlive: true, maxSockets: 1 }),
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          elapsed_ms: Date.now() - startedAt,
          body: parseJsonSafe(body),
        });
      });
    });

    req.on('error', reject);

    const gzipStream = fs.createReadStream(CSV_PATH).pipe(zlib.createGzip());
    gzipStream.on('error', reject);
    gzipStream.pipe(req);
  });
}

(async () => {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Saved CSV not found: ${CSV_PATH}`);
  }

  const stats = fs.statSync(CSV_PATH);
  const admin = {
    id: '019dd451-3773-7cbe-bdca-e6fe31eeae15',
    github_id: '64896726',
    username: 'Summiedev',
    role: 'admin',
  };

  const token = createAccessToken(admin, {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtIssuer: process.env.JWT_ISSUER || 'insighta-labs-api',
  });

  console.log(JSON.stringify({
    csv_path: CSV_PATH,
    csv_size_bytes: stats.size,
    csv_size_mb: Number((stats.size / 1024 / 1024).toFixed(2)),
  }, null, 2));

  const result = await uploadSavedCsv(token);
  console.log(JSON.stringify({ upload: result }, null, 2));
})().catch((err) => {
  console.error(JSON.stringify({ error: err.message, stack: err.stack }, null, 2));
  process.exit(1);
});
