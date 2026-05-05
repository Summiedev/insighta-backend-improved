const fetch = require('node-fetch');

const GENDERIZE_URL = 'https://api.genderize.io';
const AGIFY_URL = 'https://api.agify.io';
const NATIONALIZE_URL = 'https://api.nationalize.io';

/**
 * Call all three external APIs in parallel
 */
async function fetchExternalApis(name) {
  const [genderRes, agifyRes, nationalizeRes] = await Promise.all([
    fetch(`${GENDERIZE_URL}?name=${encodeURIComponent(name)}`),
    fetch(`${AGIFY_URL}?name=${encodeURIComponent(name)}`),
    fetch(`${NATIONALIZE_URL}?name=${encodeURIComponent(name)}`),
  ]);

  if (!genderRes.ok) throw { status: 502, message: 'Genderize API error' };
  if (!agifyRes.ok) throw { status: 502, message: 'Agify API error' };
  if (!nationalizeRes.ok) throw { status: 502, message: 'Nationalize API error' };

  const [genderData, agifyData, nationalizeData] = await Promise.all([
    genderRes.json(),
    agifyRes.json(),
    nationalizeRes.json(),
  ]);

  return { genderData, agifyData, nationalizeData };
}

/**
 * Classify age into groups
 */
function classifyAge(age) {
  if (age >= 0 && age <= 12) return 'child';
  if (age >= 13 && age <= 19) return 'teenager';
  if (age >= 20 && age <= 59) return 'adult';
  if (age >= 60) return 'senior';
  return null;
}

/**
 * Aggregate and validate external API responses
 * Returns processed profile data or throws an error object
 */
function aggregateResponses(genderData, agifyData, nationalizeData) {
  // Genderize validation
  if (!genderData.gender || genderData.gender === null) {
    throw { status: 422, message: 'Genderize returned no gender data for this name' };
  }
  if (!genderData.count || genderData.count === 0) {
    throw { status: 422, message: 'Genderize returned zero sample count for this name' };
  }

  // Agify validation
  if (agifyData.age === null || agifyData.age === undefined) {
    throw { status: 422, message: 'Agify returned no age data for this name' };
  }

  // Nationalize validation
  if (!nationalizeData.country || nationalizeData.country.length === 0) {
    throw { status: 422, message: 'Nationalize returned no country data for this name' };
  }

  // Pick highest-probability country
  const topCountry = nationalizeData.country.reduce((best, c) =>
    c.probability > best.probability ? c : best
  );

  const age = agifyData.age;
  const age_group = classifyAge(age);

  return {
    gender: genderData.gender,
    gender_probability: genderData.probability,
    sample_size: genderData.count,
    age,
    age_group,
    country_id: topCountry.country_id,
    country_probability: topCountry.probability,
  };
}

module.exports = { fetchExternalApis, aggregateResponses };
