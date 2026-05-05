/**
 * nlParser.js — Rule-based natural language query parser.
 * No AI / LLMs used. Pure regex + lookup tables.
 *
 * Returns a filters object compatible with buildMongoQuery().
 * Throws Error('Unable to interpret query') if nothing can be extracted.
 */

// ---------------------------------------------------------------------------
// Country name → ISO-2 lookup (African-focused + common world countries)
// ---------------------------------------------------------------------------
const COUNTRY_MAP = {
  'nigeria': 'NG',       'nigerian': 'NG',
  'ghana': 'GH',         'ghanaian': 'GH',
  'kenya': 'KE',         'kenyan': 'KE',
  'south africa': 'ZA',  'south african': 'ZA',
  'ethiopia': 'ET',      'ethiopian': 'ET',
  'uganda': 'UG',        'ugandan': 'UG',
  'tanzania': 'TZ',      'tanzanian': 'TZ',
  'cameroon': 'CM',      'cameroonian': 'CM',
  'senegal': 'SN',       'senegalese': 'SN',
  'angola': 'AO',        'angolan': 'AO',
  "ivory coast": 'CI',   'ivorian': 'CI',
  "cote d'ivoire": 'CI', "côte d'ivoire": 'CI',
  'zambia': 'ZM',        'zambian': 'ZM',
  'zimbabwe': 'ZW',      'zimbabwean': 'ZW',
  'rwanda': 'RW',        'rwandan': 'RW',
  'mali': 'ML',          'malian': 'ML',
  'benin': 'BJ',         'beninese': 'BJ',
  'togo': 'TG',          'togolese': 'TG',
  'niger': 'NE',         'nigerien': 'NE',
  'chad': 'TD',          'chadian': 'TD',
  'sudan': 'SD',         'sudanese': 'SD',
  'egypt': 'EG',         'egyptian': 'EG',
  'morocco': 'MA',       'moroccan': 'MA',
  'algeria': 'DZ',       'algerian': 'DZ',
  'libya': 'LY',         'libyan': 'LY',
  'tunisia': 'TN',       'tunisian': 'TN',
  'somalia': 'SO',       'somali': 'SO',
  'eritrea': 'ER',       'eritrean': 'ER',
  'djibouti': 'DJ',      'djiboutian': 'DJ',
  'madagascar': 'MG',    'malagasy': 'MG',
  'malawi': 'MW',        'malawian': 'MW',
  'botswana': 'BW',      'batswana': 'BW',
  'namibia': 'NA',       'namibian': 'NA',
  'lesotho': 'LS',       'basotho': 'LS',
  'eswatini': 'SZ',      'swazi': 'SZ',
  'gabon': 'GA',         'gabonese': 'GA',
  'congo': 'CG',         'congolese': 'CG',
  'dr congo': 'CD',      'drc': 'CD',
  'democratic republic of congo': 'CD',
  'burundi': 'BI',       'burundian': 'BI',
  'guinea': 'GN',        'guinean': 'GN',
  'sierra leone': 'SL',
  'liberia': 'LR',       'liberian': 'LR',
  'burkina faso': 'BF',  'burkinabe': 'BF',
  'gambia': 'GM',        'gambian': 'GM',
  'mauritania': 'MR',    'mauritanian': 'MR',
  'mauritius': 'MU',     'mauritian': 'MU',
  'mozambique': 'MZ',    'mozambican': 'MZ',
  'south sudan': 'SS',
  'central african republic': 'CF',
  'cape verde': 'CV',    'cabo verde': 'CV',
  'equatorial guinea': 'GQ',
  'guinea-bissau': 'GW',
  'comoros': 'KM',
  'seychelles': 'SC',
  'sao tome': 'ST',
  'us': 'US', 'usa': 'US', 'united states': 'US', 'american': 'US',
  'uk': 'GB', 'united kingdom': 'GB', 'british': 'GB',
  'france': 'FR',        'french': 'FR',
  'germany': 'DE',       'german': 'DE',
  'canada': 'CA',        'canadian': 'CA',
  'australia': 'AU',     'australian': 'AU',
  'india': 'IN',         'indian': 'IN',
  'china': 'CN',         'chinese': 'CN',
  'japan': 'JP',         'japanese': 'JP',
  'brazil': 'BR',        'brazilian': 'BR',
};

// Age-keyword → min/max age overrides
// "young" maps to 16–24 for parsing only (not a stored age_group)
const AGE_KEYWORDS = {
  young:   { min_age: 16, max_age: 24 },
  elderly: { min_age: 65 },
  old:     { min_age: 65 },
};

const AGE_GROUP_WORDS = {
  child: 'child', children: 'child',
  teen: 'teenager', teens: 'teenager', teenager: 'teenager', teenagers: 'teenager',
  adult: 'adult', adults: 'adult',
  senior: 'senior', seniors: 'senior',
};

// ---------------------------------------------------------------------------

function parseNL(q) {
  if (!q || !q.trim()) throw new Error('Unable to interpret query');

  const s = q.toLowerCase().trim();
  const filters = {};
  let hits = 0;

  // ── Gender ──────────────────────────────────────────────────────────────
  const hasMale   = /\bmales?\b|\bmen\b|\bman\b|\bboys?\b/.test(s);
  const hasFemale = /\bfemales?\b|\bwomen\b|\bwoman\b|\bgirls?\b/.test(s);
  const hasBoth   = /\b(male and female|female and male|both genders?|people|persons?|men and women|women and men)\b/.test(s);

  if (hasMale && !hasFemale && !hasBoth) {
    filters.gender = 'male';  hits++;
  } else if (hasFemale && !hasMale && !hasBoth) {
    filters.gender = 'female'; hits++;
  } else if (hasBoth || (hasMale && hasFemale)) {
    // no gender restriction — intentional match
    hits++;
  }

  // ── Age keywords (young / elderly / old) ────────────────────────────────
  for (const [kw, ages] of Object.entries(AGE_KEYWORDS)) {
    if (new RegExp(`\\b${kw}\\b`).test(s)) {
      Object.assign(filters, ages);
      hits++;
    }
  }

  // ── Age groups (child / teenager / adult / senior) ──────────────────────
  for (const [kw, grp] of Object.entries(AGE_GROUP_WORDS)) {
    if (new RegExp(`\\b${kw}\\b`).test(s)) {
      filters.age_group = grp;
      hits++;
    }
  }

  // ── Explicit age constraints ─────────────────────────────────────────────
  // "above N" / "over N" / "older than N" / "more than N"
  let m = s.match(/\b(?:above|over|older than|more than)\s+(\d+)\b/);
  if (m) { filters.min_age = parseInt(m[1], 10); hits++; }

  // "below N" / "under N" / "younger than N" / "less than N"
  m = s.match(/\b(?:below|under|younger than|less than)\s+(\d+)\b/);
  if (m) { filters.max_age = parseInt(m[1], 10); hits++; }

  // "between N and M"
  m = s.match(/\bbetween\s+(?:ages?\s+)?(\d+)\s+and\s+(\d+)\b/);
  if (m) { filters.min_age = parseInt(m[1], 10); filters.max_age = parseInt(m[2], 10); hits++; }

  // "aged 20-45" / "age 20 to 45" / "ages 20 and 45"
  m = s.match(/\b(?:aged|ages|age)\s+(\d+)\s*(?:-|to|and)\s*(\d+)\b/);
  if (m) {
    filters.min_age = parseInt(m[1], 10);
    filters.max_age = parseInt(m[2], 10);
    hits++;
  }

  // "aged N"
  m = s.match(/\baged?\s+(\d+)\b(?!\s*(?:-|to|and)\s*\d+)/);
  if (m) { filters.min_age = filters.max_age = parseInt(m[1], 10); hits++; }

  // ── Country ──────────────────────────────────────────────────────────────
  // Try "from/in/of <country>" preposition capture first
  const prepMatch = s.match(
    /\b(?:from|in|of)\s+([a-z][a-z\s'\-]{1,40}?)(?:\s+(?:who|that|with|aged?|above|below|between|males?|females?|and)|$)/
  );
  let countryCode = null;
  if (prepMatch) {
    const candidate = prepMatch[1].trim();
    // Try longest-first sub-phrases
    const words = candidate.split(/\s+/);
    for (let len = words.length; len >= 1; len--) {
      const phrase = words.slice(0, len).join(' ');
      if (COUNTRY_MAP[phrase]) { countryCode = COUNTRY_MAP[phrase]; break; }
    }
  }
  // Fallback: scan entire string for any country keyword (longest match first)
  if (!countryCode) {
    const sorted = Object.keys(COUNTRY_MAP).sort((a, b) => b.length - a.length);
    for (const key of sorted) {
      if (new RegExp(`\\b${key.replace(/[-']/g, '.')}s?\\b`).test(s)) {
        countryCode = COUNTRY_MAP[key];
        break;
      }
    }
  }
  if (countryCode) { filters.country_id = countryCode; hits++; }

  // ── Require at least one meaningful signal ────────────────────────────────
  if (hits === 0 || Object.keys(filters).length === 0) {
    throw new Error('Unable to interpret query');
  }

  return filters;
}

module.exports = { parseNL };
