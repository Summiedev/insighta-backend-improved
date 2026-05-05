const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const readline = require('readline');

require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createAccessToken } = require('./src/auth');
const { utcNow } = require('./src/helpers');

const BASE_URL = 'https://insighta-backend-mauve.vercel.app';
const BACKEND_IP = '216.198.79.195';
const CSV_PATH = path.join(__dirname, '.tmp-live-500k-upload.csv');

const ROW_COUNT = Number(process.env.ROW_COUNT || process.argv[2] || 500000);
const CHUNK_ROWS = Number(process.env.CHUNK_ROWS || process.argv[3] || 20000);
const GENERATE_ONLY = String(process.env.GENERATE_ONLY || process.argv[4] || '0') === '1';
const USE_GZIP = String(process.env.USE_GZIP || process.argv[5] || '0') === '1';
const USE_SAVED_CSV = String(process.env.USE_SAVED_CSV || process.argv[6] || '0') === '1';

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return text;
  }
}

function getAdminToken() {
  const admin = {
    id: '019dd451-3773-7cbe-bdca-e6fe31eeae15',
    github_id: '64896726',
    username: 'Summiedev',
    role: 'admin',
  };

  return createAccessToken(admin, {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtIssuer: process.env.JWT_ISSUER || 'insighta-labs-api',
  });
}

async function generateCsv(filePath, rowCount, stamp) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    stream.on('error', reject);

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
    const progressEvery = 20000;

    function writeBatch() {
      let ok = true;
      while (ok && i < rowCount) {
        const idx = i % countries.length;
        const gender = genders[i % 2];
        const age = 18 + (i % 53);
        const [countryId, countryName] = countries[idx];
        const name = `Stage4B500k-${stamp}-${i + 1}`;
        const genderProb = ((i % 100) + 1) / 100;
        const countryProb = (((i + 37) % 100) + 1) / 100;

        ok = stream.write(`${name},${gender},${genderProb.toFixed(2)},${age},adult,${countryId},${countryName},${countryProb.toFixed(2)}\n`);
        i += 1;

        if (i % progressEvery === 0) {
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

function uploadChunk(token, chunkCsv, chunkIndex) {
  const url = new URL('/api/profiles?bulk=1', BASE_URL);
  const startedAt = Date.now();
  const raw = Buffer.from(chunkCsv, 'utf8');
  const payload = USE_GZIP ? zlib.gzipSync(raw) : raw;

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
        ...(USE_GZIP ? { 'Content-Encoding': 'gzip' } : {}),
        'Content-Length': payload.length,
        Connection: 'keep-alive',
      },
      agent: new https.Agent({ keepAlive: true, maxSockets: 1 }),
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          chunk_index: chunkIndex,
          status: res.statusCode,
          elapsed_ms: Date.now() - startedAt,
          body: parseJsonSafe(body),
        });
      });
    });

    req.on('error', reject);
    req.end(payload);
  });
}

async function uploadCsvInChunks(filePath, chunkRows, tokenFactory) {
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let header = null;
  let lines = [];
  let chunkIndex = 0;

  const aggregate = {
    status: 'success',
    chunks: 0,
    total_rows: 0,
    inserted: 0,
    skipped: 0,
    reasons: {
      duplicate_name: 0,
      invalid_age: 0,
      missing_fields: 0,
      malformed: 0,
    },
  };

  async function flushChunk() {
    if (!lines.length) return;

    chunkIndex += 1;
    const payload = `${header}\n${lines.join('\n')}\n`;
    // Create a fresh token per chunk to avoid long-run expiry mid-upload.
    const result = await uploadChunk(tokenFactory(), payload, chunkIndex);

    if (result.status !== 200 || !result.body || typeof result.body !== 'object') {
      throw new Error(`Chunk ${chunkIndex} failed with status ${result.status}: ${JSON.stringify(result.body)} (elapsed_ms=${result.elapsed_ms})`);
    }

    aggregate.chunks += 1;
    aggregate.total_rows += Number(result.body.total_rows || 0);
    aggregate.inserted += Number(result.body.inserted || 0);
    aggregate.skipped += Number(result.body.skipped || 0);

    const reasons = result.body.reasons || {};
    aggregate.reasons.duplicate_name += Number(reasons.duplicate_name || 0);
    aggregate.reasons.invalid_age += Number(reasons.invalid_age || 0);
    aggregate.reasons.missing_fields += Number(reasons.missing_fields || 0);
    aggregate.reasons.malformed += Number(reasons.malformed || 0);

    process.stdout.write(`\rUploaded chunk ${chunkIndex} (${lines.length.toLocaleString()} rows)`);
    lines = [];
  }

  for await (const raw of rl) {
    const line = String(raw || '');
    if (!header) {
      header = line;
      continue;
    }

    if (!line.trim()) continue;
    lines.push(line);

    if (lines.length >= chunkRows) {
      await flushChunk();
    }
  }

  if (!header) {
    throw new Error('CSV file is empty or missing header');
  }

  if (lines.length) {
    await flushChunk();
  }

  return aggregate;
}

(async () => {
  if (!USE_SAVED_CSV) {
    const stamp = utcNow().replace(/[:.]/g, '-');
    console.log(`Generating ${ROW_COUNT.toLocaleString()} rows to ${CSV_PATH}`);
    const genStart = Date.now();
    await generateCsv(CSV_PATH, ROW_COUNT, stamp);
    const stats = fs.statSync(CSV_PATH);
    console.log(`\nCSV generated: ${(stats.size / 1024 / 1024).toFixed(2)} MB in ${Date.now() - genStart} ms`);
  } else {
    if (!fs.existsSync(CSV_PATH)) {
      throw new Error(`Saved CSV not found: ${CSV_PATH}`);
    }
    const stats = fs.statSync(CSV_PATH);
    console.log(`Using saved CSV: ${CSV_PATH} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  }

  if (GENERATE_ONLY) {
    console.log('GENERATE_ONLY set — upload skipped');
    return;
  }

  const uploadStart = Date.now();
  const aggregate = await uploadCsvInChunks(CSV_PATH, CHUNK_ROWS, getAdminToken);
  const elapsed = Date.now() - uploadStart;

  console.log('\n' + JSON.stringify({
    csv_path: CSV_PATH,
    chunk_rows: CHUNK_ROWS,
    use_gzip: USE_GZIP,
    use_saved_csv: USE_SAVED_CSV,
    upload_elapsed_ms: elapsed,
    summary: aggregate,
  }, null, 2));
})().catch((err) => {
  console.error('\n' + JSON.stringify({ error: err.message, stack: err.stack }, null, 2));
  process.exit(1);
});
