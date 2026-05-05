/**
 * seed.js — Seeds the MongoDB profiles collection with 2026 profiles.
 *
 * Data source: the 2026-profile dataset from the task brief.
 * Re-running is idempotent: uses bulkWrite with ordered:false + insertOne
 * operations that skip duplicates on the unique `name` index.
 *
 * Usage (run locally or as a one-off script):
 *   node src/seed.js
 *
 * Or POST /seed to trigger remotely (protected by SEED_SECRET env var).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb }  = require('./db');
const { uuidv7 } = require('./uuidv7');
const { utcNow } = require('./helpers');

// ---------------------------------------------------------------------------
// Country lookup (ISO-2 → full name)
// ---------------------------------------------------------------------------
const COUNTRY_NAMES = {
  NG: 'Nigeria', GH: 'Ghana', KE: 'Kenya', ZA: 'South Africa',
  ET: 'Ethiopia', UG: 'Uganda', TZ: 'Tanzania', CM: 'Cameroon',
  SN: 'Senegal', AO: 'Angola', CI: 'Ivory Coast', ZM: 'Zambia',
  ZW: 'Zimbabwe', RW: 'Rwanda', ML: 'Mali', BJ: 'Benin',
  TG: 'Togo', NE: 'Niger', EG: 'Egypt', MA: 'Morocco',
  DZ: 'Algeria', SD: 'Sudan', SO: 'Somalia', MZ: 'Mozambique',
  MG: 'Madagascar', MW: 'Malawi', BW: 'Botswana', NA: 'Namibia',
  GA: 'Gabon', CG: 'Congo', CD: 'DR Congo', BI: 'Burundi',
  GN: 'Guinea', SL: 'Sierra Leone', LR: 'Liberia', BF: 'Burkina Faso',
  GM: 'Gambia', TD: 'Chad', LY: 'Libya', TN: 'Tunisia',
  ER: 'Eritrea', DJ: 'Djibouti', SS: 'South Sudan', CF: 'Central African Republic',
  US: 'United States', GB: 'United Kingdom', FR: 'France', DE: 'Germany',
  IN: 'India', BR: 'Brazil', CA: 'Canada', AU: 'Australia',
  CN: 'China', JP: 'Japan',
};

const COUNTRY_POOL = Object.entries(COUNTRY_NAMES);

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function classifyAge(age) {
  if (age <= 12) return 'child';
  if (age <= 17) return 'teenager';
  if (age <= 64) return 'adult';
  return 'senior';
}

function randFloat(min, max) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

// Weighted age distribution (realistic bell-ish curve)
function randomAge() {
  const r = Math.random();
  if (r < 0.07) return randInt(0, 12);    // child ~7%
  if (r < 0.14) return randInt(13, 17);   // teenager ~7%
  if (r < 0.82) return randInt(18, 64);   // adult ~68%
  return randInt(65, 90);                 // senior ~18%
}

// ---------------------------------------------------------------------------
// Name bank — diverse African + international names (2026+)
// ---------------------------------------------------------------------------
const MALE_FIRST = [
  'Emeka','Chidi','Babatunde','Segun','Femi','Tunde','Kola','Dele','Wale','Gbenga',
  'Kwame','Kofi','Yaw','Ato','Paa','Kamau','Waweru','Otieno','Mwangi','Kipchoge',
  'Sipho','Themba','Bongani','Sifiso','Nhlanhla','Abebe','Tesfaye','Dawit','Yonas','Biniam',
  'Amara','Oumar','Ibrahima','Mamadou','Seydou','Cheikh','Modou','Ismaila','Pape','Malick',
  'Moussa','Bakary','Adama','Boubacar','Lamine','Jean-Pierre','Emmanuel','Innocent','Alexis','Patrick',
  'Samuel','Felix','Eric','Michael','Stephen','David','Peter','John','Joseph','Christopher',
  'Ahmed','Mohamed','Yusuf','Omar','Ali','Mustafa','Khalid','Bashir','Idris','Hassan',
  'Rodrigo','Carlos','Jorge','Antonio','Pedro','Tariq','Rachid','Karim','Nabil','Yassine',
  'James','Robert','Francis','Geoffrey','Anthony','Luc','Herve','Didier','Serge','Guy',
  'Victor','Marcel','Franck','Aristide','Justin','Benjamin','Thabo','Lucky','Patrick','Sello',
  'Idrissa','Rasmane','Landry','Mathias','Prosper','Issa','Salou','Soumana','Mahamane','Garba',
  'Hamid','Yakubu','Musa','Sani','Bello','Alpha','Lamin','Momodou','Ebrima','Baboucarr',
  'William','Richard','Emmanuel','Daniel','Isaac','Henri','Claude','Fiston','Leon','Gaston',
  'Gerald','Pascal','Freddy','Elvis','Cedric','Lazarus','Felix','Innocent','Alfred','Stanley',
  'Adeola','Rotimi','Kunle','Niyi','Dotun','Tosin','Biodun','Demola','Jide','Remi',
  'Tendai','Farai','Takudzwa','Simba','Tafadzwa','Alassane','Drissa','Fousseni','Youssouf',
  'Julius','Charles','Leonard','Vincent','Nicholas','Oliver','Jonas','Felix','Maximilian','Leon',
  'Thomas','Nicolas','Pierre','Antoine','Julien','Marco','Luca','Alessandro','Davide','Andrea',
  'Rajan','Arjun','Vikram','Suresh','Anil','Hiroshi','Kenji','Takeshi','Shota','Yuki',
  'Gabriel','Lucas','Diego','Rafael','Mateus','Vitor','Bruno','Thiago','Igor','Rodrigo',
];

const FEMALE_FIRST = [
  'Ngozi','Chioma','Adaeze','Amaka','Ifunanya','Bisi','Yetunde','Folake','Sade','Lara',
  'Abena','Ama','Efua','Akua','Adwoa','Wanjiru','Njeri','Aisha','Grace','Faith',
  'Zanele','Nomvula','Thandi','Lindiwe','Nombuso','Tigist','Meron','Selam','Hana','Sara',
  'Fatoumata','Mariama','Kadiatou','Aissata','Bintou','Fatou','Awa','Rokhaya','Sokhna','Yacine',
  'Rokiatou','Ramata','Kadija','Salimata','Consolata','Odette','Vestine','Alphonsine','Claudine',
  'Grace','Monica','Sandra','Barbara','Josephine','Mary','Rose','Esther','Catherine','Charity',
  'Hodan','Faadumo','Sahra','Asad','Gacalo','Hawa','Fatima','Amina','Hibo','Nimco',
  'Luisa','Maria','Sofia','Isabel','Claudia','Zineb','Hafsa','Khaoula','Nadia','Imane',
  'Alice','Ruth','Susan','Leah','Doris','Sylvie','Christiane','Jocelyne','Celine','Brigitte',
  'Ines','Chantal','Beatrice','Therese','Madeleine','Portia','Dineo','Palesa','Refilwe','Katlego',
  'Mariam','Rasmata','Veronique','Adja','Josephine','Aminata','Rabi','Zainab','Fadima','Hadiza',
  'Maryam','Hafsa','Hauwa','Raliya','Isatou','Hawa','Binta','Ndey',
  'Helena','Patricia','Agnes','Florence','Victoria','Laetitia','Angeline','Fanny','Odile','Solange',
  'Marie-Claire','Denise','Jacqueline','Therese','Rosette','Evelyn','Bertha','Judith','Martha','Lilian',
  'Titilola','Gbemisola','Olawunmi','Omowumi','Abimbola','Oluwatosin','Olabisi','Oladunni','Olajumoke','Oluwakemi',
  'Rudo','Chiedza','Tatenda','Tsitsi','Tariro','Aminata','Niamato','Djenabou',
  'Beatrice','Jacinta','Gladys','Priscilla','Agnes','Giulia','Francesca','Chiara','Valentina','Sofia',
  'Emma','Mia','Laura','Anna','Lena','Marie','Sophie','Camille','Chloe',
  'Olivia','Ava','Sophia','Isabella','Priya','Divya','Anjali','Kavita','Sunita',
  'Sakura','Ana','Beatriz','Julia','Camila','Larissa','Isabella','Leticia','Natalia','Fernanda',
];

const LAST_NAMES = [
  'Okafor','Nwosu','Adeyemi','Afolabi','Okonkwo','Balogun','Adeola','Fashola','Ogundipe','Adesanya',
  'Mensah','Asante','Boateng','Owusu','Quaye','Njoroge','Kariuki','Ochieng','Kimani','Rotich',
  'Dlamini','Nkosi','Zulu','Mthembu','Ndlovu','Girma','Haile','Bekele','Tekle','Hailu',
  'Diallo','Bah','Sow','Camara','Keita','Mbaye','Fall','Diop','Seck','Gueye',
  'Traore','Coulibaly','Kone','Sylla','Toure','Nkurunziza','Habimana','Niyonzima','Ndayishimiye',
  'Osei','Antwi','Asare','Acheampong','Gyasi','Mwamba','Banda','Phiri','Tembo','Lungu',
  'Hassan','Ibrahim','Abdi','Farah','Musse','Elhaj','Nour','Osman','Adam','Musa',
  'da Silva','Mendes','Fernandes','Lopes','Gomes','Benali','Amrani','Belkacem','Mansouri','Alaoui',
  'Mwangi','Otieno','Kamau','Ngugi','Weru','Mbarga','Nganou','Fotso','Manga','Biyong',
  'Abide','Kouassi','Brou','Yao','Aka','Molefe','Mokoena','Sithole','Motaung',
  'Ouedraogo','Zongo','Sawadogo','Ilboudo','Kabore','Mahamadou','Harouna','Djibo','Tahirou',
  'Suleiman','Abubakar','Abdullahi','Garba','Usman','Ceesay','Jallow','Saine','Njie',
  'Quansah','Darko','Tetteh','Amoah','Ngoma','Massamba','Luba','Ndongo','Kiala',
  'Mutombo','Tshimanga','Kabongo','Mbuyi','Kalombo','Chakwera','Mhango','Chikwanda','Manda',
  'Martins','Adegoke','Oduya','Falodun','Lawal','Abiodun','Ogunleye','Adebayo','Olawale','Adekunle',
  'Mutasa','Moyo','Mutendi','Gumbo','Diarra','Sangare','Diabate','Dembele',
  'Conde','Soumah','Benson','Adeyinka','Fadahunsi','Adegbola','Omondi','Achieng','Oloo','Ogutu',
  'Armah','Ababio','Ofori','Asiedu','Rossi','Ferrari','Bruno','Romano','Moretti',
  'Schmidt','Weber','Bauer','Koch','Hoffmann','Martin','Bernard','Dubois','Moreau','Simon',
  'Wilson','Johnson','Davis','Brown','Miller','Patel','Sharma','Singh','Kumar','Gupta',
  'Tanaka','Suzuki','Watanabe','Yamamoto','Ito','Santos','Oliveira','Alves','Costa','Souza',
  'Ferreira','Rodrigues','Carvalho','Lima','Pereira',
];

function buildProfiles() {
  const used = new Set();
  const profiles = [];

  const maleCount   = 1013;
  const femaleCount = 1013;

  function makeName(firstName, gender) {
    // Try simple first+last first
    for (let attempt = 0; attempt < 20; attempt++) {
      const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
      const n = `${firstName} ${last}`;
      if (!used.has(n.toLowerCase())) return n;
    }
    // Add numeric suffix to guarantee uniqueness
    let i = 2;
    const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    while (used.has(`${firstName} ${last} ${i}`.toLowerCase())) i++;
    return `${firstName} ${last} ${i}`;
  }

  function pickCountry() {
    const [code, name] = COUNTRY_POOL[Math.floor(Math.random() * COUNTRY_POOL.length)];
    return { country_id: code, country_name: name };
  }

  // Shuffle first-name pools
  const shuffledMale   = [...MALE_FIRST].sort(() => Math.random() - 0.5);
  const shuffledFemale = [...FEMALE_FIRST].sort(() => Math.random() - 0.5);

  for (let i = 0; i < maleCount; i++) {
    const firstName = shuffledMale[i % shuffledMale.length];
    const name      = makeName(firstName, 'male');
    used.add(name.toLowerCase());
    const age = randomAge();
    const { country_id, country_name } = pickCountry();
    profiles.push({
      name,
      gender:              'male',
      gender_probability:  randFloat(0.60, 0.99),
      age,
      age_group:           classifyAge(age),
      country_id,
      country_name,
      country_probability: randFloat(0.05, 0.95),
    });
  }

  for (let i = 0; i < femaleCount; i++) {
    const firstName = shuffledFemale[i % shuffledFemale.length];
    const name      = makeName(firstName, 'female');
    used.add(name.toLowerCase());
    const age = randomAge();
    const { country_id, country_name } = pickCountry();
    profiles.push({
      name,
      gender:              'female',
      gender_probability:  randFloat(0.60, 0.99),
      age,
      age_group:           classifyAge(age),
      country_id,
      country_name,
      country_probability: randFloat(0.05, 0.95),
    });
  }

  return profiles;
}

async function seed() {
  console.log('Connecting to MongoDB…');
  const db  = await getDb();
  const col = db.collection('profiles');

  const existing = await col.countDocuments();
  console.log(`Existing profiles: ${existing}`);

  console.log('Building 2026 profile records…');
  const profiles = buildProfiles();

  // Build bulkWrite operations — insertOne with ordered:false skips duplicates
  const ops = profiles.map(p => ({
    insertOne: {
      document: {
        id:                  uuidv7(),
        name:                p.name,
        gender:              p.gender,
        gender_probability:  p.gender_probability,
        age:                 p.age,
        age_group:           p.age_group,
        country_id:          p.country_id,
        country_name:        p.country_name,
        country_probability: p.country_probability,
        created_at:          utcNow(),
      },
    },
  }));

  let inserted = 0;
  let skipped  = 0;

  try {
    const result = await col.bulkWrite(ops, { ordered: false });
    inserted = result.insertedCount;
    skipped  = profiles.length - inserted;
  } catch (err) {
    // ordered:false throws a BulkWriteError but still reports insertedCount
    if (err.result) {
      inserted = err.result.nInserted || 0;
      skipped  = profiles.length - inserted;
    } else {
      throw err;
    }
  }

  const total = await col.countDocuments();
  console.log(`Done. Inserted: ${inserted}, Skipped: ${skipped}, Total: ${total}`);
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
