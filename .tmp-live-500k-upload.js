const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const https = require('https');
const zlib = require('zlib');
const { createAccessToken } = require('./src/auth');
const { utcNow } = require('./src/helpers');

const base = 'https://insighta-backend-mauve.vercel.app';
const versionHeaders = { 'X-API-Version': '1' };
const csvPath = path.join(__dirname, '.tmp-live-500k-upload.csv');
const backendIp = '216.198.79.195';

function httpRequest(method, pathName, token, bodyStream, contentType, extraHeaders = {}) {
  const headers = { ...versionHeaders, ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (contentType) headers['Content-Type'] = contentType;
  headers['Connection'] = 'keep-alive';

  const url = new URL(`${base}${pathName}`);
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const req = https.request({
      method,
      hostname: backendIp,
      path: `${url.pathname}${url.search}`,
      headers: { ...headers, Host: url.hostname },
      timeout: 0,
      servername: url.hostname,
      agent: new https.Agent({ keepAlive: true, maxSockets: 1 }),
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - start, text }));
    });

    req.on('error', reject);
    if (bodyStream) {
      bodyStream.on('error', reject);
      bodyStream.pipe(req);
    } else {
      req.end();
    }
  });
}

function parseJsonSafe(text) {
  try { return JSON.parse(text); } catch (_err) { return text; }
}

async function generateCsv(filePath, rowCount, stamp) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    stream.on('error', reject);
    // Include optional probability columns to match the server's expected fields
    // Order: name,gender,gender_probability,age,age_group,country_id,country_name,country_probability
    stream.write('name,gender,gender_probability,age,age_group,country_id,country_name,country_probability\n');

    const genders = ['male', 'female'];
    const countries = [
      ['NG', 'Nigeria'],
      ['GH', 'Ghana'],
      ['KE', 'Kenya'],
      ['ZA', 'South Africa'],
      ['UG', 'Uganda'],
      ['TZ', 'Tanzania'],
      ['SN', 'Senegal'],
      ['CM', 'Cameroon'],
    ];

    let i = 0;
    const batchSize = 20000;

    function writeBatch() {
      let ok = true;
      while (ok && i < rowCount) {
        const idx = i % countries.length;
        const gender = genders[i % 2];
        const age = 18 + (i % 53);
        const [countryId, countryName] = countries[idx];
        const rowName = `Stage4B500k-${stamp}-${i + 1}`;
        // provide synthetic probabilities so parser treats columns consistently
        const genderProb = ((i % 100) + 1) / 100; // 0.01..1.00
        const countryProb = (((i + 37) % 100) + 1) / 100;
        ok = stream.write(`${rowName},${gender},${genderProb.toFixed(2)},${age},adult,${countryId},${countryName},${countryProb.toFixed(2)}\n`);
        i += 1;
        if (i % batchSize === 0) {
          process.stdout.write(`\rGenerated ${i.toLocaleString()}/${rowCount.toLocaleString()} rows`);
        }
      }
      if (i < rowCount) {
        stream.once('drain', writeBatch);
      } else {
        stream.end(() => resolve());
      }
    }

    writeBatch();
  });
}

(async () => {
  const admin = {
    id: '019dd451-3773-7cbe-bdca-e6fe31eeae15',
    github_id: '64896726',
    username: 'Summiedev',
    role: 'admin',
  };

  const config = { jwtAccessSecret: process.env.JWT_ACCESS_SECRET, jwtIssuer: process.env.JWT_ISSUER || 'insighta-labs-api' };
  const adminToken = createAccessToken(admin, config);

  const stamp = utcNow().replace(/[:.]/g, '-');
  const rowCount = Number(process.env.ROW_COUNT || process.argv[2] || 500000);
  const DRY_RUN = String(process.env.DRY_RUN || process.argv[3] || '0') === '1';
  const NO_GZIP = String(process.env.NO_GZIP || process.argv[4] || '0') === '1';
  console.log(`Generating ${rowCount.toLocaleString()} row CSV...`);
  const fileStart = Date.now();
  await generateCsv(csvPath, rowCount, stamp);
  const fileStats = fs.statSync(csvPath);
  console.log(`\nCSV ready: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB in ${Date.now() - fileStart} ms`);

  const uploadStart = Date.now();
  if (DRY_RUN) {
    console.log('DRY_RUN set — skipping upload');
  } else {
    let upload;
    if (NO_GZIP) {
      upload = await httpRequest('POST', '/api/profiles?bulk=1', adminToken, fs.createReadStream(csvPath), 'text/csv');
    } else {
      const gzipStream = fs.createReadStream(csvPath).pipe(zlib.createGzip());
      upload = await httpRequest('POST', '/api/profiles?bulk=1', adminToken, gzipStream, 'text/csv', { 'Content-Encoding': 'gzip' });
    }

    const uploadElapsed = Date.now() - uploadStart;

    const result = {
      upload: {
        status: upload.status,
        ms: upload.ms,
        elapsed_ms: uploadElapsed,
        body: parseJsonSafe(upload.text),
      },
    };

    console.log(JSON.stringify(result, null, 2));
  }

  try {
    if (!DRY_RUN) fs.unlinkSync(csvPath);
  } catch (_err) {}

  // Cleanup only the names from this run if upload succeeded enough to insert them.
  // Best-effort cleanup is not attempted here because the endpoint may partially fail.
})().catch((err) => {
  console.error(JSON.stringify({ error: err.message, stack: err.stack }, null, 2));
  try { if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath); } catch (_err) {}
  process.exit(1);
});
