const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from ' + url)); }
      });
    }).on('error', reject);
  });
}

async function fetchExternalApis(name) {
  const encoded = encodeURIComponent(name);
  const [genderData, agifyData, nationalizeData] = await Promise.all([
    httpsGet(`https://api.genderize.io/?name=${encoded}`),
    httpsGet(`https://api.agify.io/?name=${encoded}`),
    httpsGet(`https://api.nationalize.io/?name=${encoded}`),
  ]);
  return { genderData, agifyData, nationalizeData };
}

function classifyAge(age) {
  if (age >= 0  && age <= 12) return 'child';
  if (age >= 13 && age <= 19) return 'teenager';
  if (age >= 20 && age <= 59) return 'adult';
  return 'senior';
}

// is_confident: true when external APIs return high-confidence data.
// Nonsense / very rare names typically return null age, null gender, or empty
// country lists — those are caught before this and return 422.
// For names that DO pass validation, confidence is based on sample size
// and probability thresholds.
function computeIsConfident(genderData, agifyData, nationalizeData) {
  const genderConfident   = (genderData.probability  ?? 0) >= 0.80
                         && (genderData.count         ?? 0) >= 100;
  const agifyConfident    = (agifyData.count          ?? 0) >= 100;
  const topCountryProb    = nationalizeData.country?.[0]?.probability ?? 0;
  const nationalConfident = topCountryProb >= 0.10;
  return genderConfident && agifyConfident && nationalConfident;
}

function aggregateResponses(genderData, agifyData, nationalizeData) {
  // Validate Genderize
  if (!genderData.gender || genderData.gender === null) {
    throw { status: 422, message: 'Genderize returned no gender data for this name' };
  }
  if (!genderData.count || genderData.count === 0) {
    throw { status: 422, message: 'Genderize returned zero sample count for this name' };
  }

  // Validate Agify
  if (agifyData.age === null || agifyData.age === undefined) {
    throw { status: 422, message: 'Agify returned no age data for this name' };
  }

  // Validate Nationalize
  if (!nationalizeData.country || nationalizeData.country.length === 0) {
    throw { status: 422, message: 'Nationalize returned no country data for this name' };
  }

  const topCountry   = nationalizeData.country.reduce((best, c) =>
    c.probability > best.probability ? c : best
  );
  const is_confident = computeIsConfident(genderData, agifyData, nationalizeData);

  return {
    gender:              genderData.gender,
    gender_probability:  genderData.probability,
    sample_size:         genderData.count,
    age:                 agifyData.age,
    age_group:           classifyAge(agifyData.age),
    country_id:          topCountry.country_id,
    country_probability: topCountry.probability,
    is_confident,
  };
}

module.exports = { fetchExternalApis, aggregateResponses };
