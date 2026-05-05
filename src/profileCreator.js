const { getDb } = require('./db');
const { fetchExternalApis, aggregateResponses } = require('./profileService');
const { formatProfile, utcNow } = require('./helpers');
const { uuidv7 } = require('./uuidv7');

async function createProfileFromName(name) {
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    throw { status: 400, message: 'Invalid query parameters' };
  }

  const db = await getDb();
  const profiles = db.collection('profiles');

  const existing = await profiles.findOne({ name: cleanName });
  if (existing) {
    throw { status: 409, message: 'Profile already exists' };
  }

  const { genderData, agifyData, nationalizeData } = await fetchExternalApis(cleanName);
  const derived = aggregateResponses(genderData, agifyData, nationalizeData);

  const countryNameMap = {
    NG: 'Nigeria', GH: 'Ghana', KE: 'Kenya', ZA: 'South Africa', ET: 'Ethiopia', UG: 'Uganda', TZ: 'Tanzania', CM: 'Cameroon', SN: 'Senegal', AO: 'Angola', CI: 'Ivory Coast', ZM: 'Zambia', ZW: 'Zimbabwe', RW: 'Rwanda', ML: 'Mali', BJ: 'Benin', TG: 'Togo', NE: 'Niger', EG: 'Egypt', MA: 'Morocco', DZ: 'Algeria', SD: 'Sudan', SO: 'Somalia', MZ: 'Mozambique', MG: 'Madagascar', MW: 'Malawi', BW: 'Botswana', NA: 'Namibia', GA: 'Gabon', CG: 'Congo', CD: 'DR Congo', BI: 'Burundi', GN: 'Guinea', SL: 'Sierra Leone', LR: 'Liberia', BF: 'Burkina Faso', GM: 'Gambia', TD: 'Chad', LY: 'Libya', TN: 'Tunisia', ER: 'Eritrea', DJ: 'Djibouti', SS: 'South Sudan', CF: 'Central African Republic', US: 'United States', GB: 'United Kingdom', FR: 'France', DE: 'Germany', IN: 'India', BR: 'Brazil', CA: 'Canada', AU: 'Australia', CN: 'China', JP: 'Japan',
  };

  const document = {
    id: uuidv7(),
    name: cleanName,
    gender: derived.gender,
    gender_probability: derived.gender_probability,
    age: derived.age,
    age_group: derived.age_group,
    country_id: derived.country_id,
    country_name: countryNameMap[derived.country_id] || derived.country_id,
    country_probability: derived.country_probability,
    created_at: utcNow(),
  };

  await profiles.insertOne(document);
  return formatProfile(document);
}

module.exports = { createProfileFromName };