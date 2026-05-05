/**
 * POST /seed  — triggers database seeding (idempotent).
 *
 * Protected by the SEED_SECRET environment variable.
 * Call with: POST /seed  and header  x-seed-secret: <your-secret>
 *
 * This endpoint exists so you can seed the database without SSH/console access.
 */

const { getDb } = require('../src/db');
const { uuidv7 } = require('../src/uuidv7');
const { utcNow, setCors } = require('../src/helpers');
const { protect } = require('../src/middleware/auth');
const { applyObservability, RATE_LIMIT_POLICIES } = require('../src/middleware/observability');

// Inlined build logic (mirrors src/seed.js but returns data instead of writing)
const COUNTRY_POOL = [
  ['NG','Nigeria'],['GH','Ghana'],['KE','Kenya'],['ZA','South Africa'],
  ['ET','Ethiopia'],['UG','Uganda'],['TZ','Tanzania'],['CM','Cameroon'],
  ['SN','Senegal'],['AO','Angola'],['CI','Ivory Coast'],['ZM','Zambia'],
  ['ZW','Zimbabwe'],['RW','Rwanda'],['ML','Mali'],['BJ','Benin'],
  ['TG','Togo'],['NE','Niger'],['EG','Egypt'],['MA','Morocco'],
  ['DZ','Algeria'],['SD','Sudan'],['SO','Somalia'],['MZ','Mozambique'],
  ['MG','Madagascar'],['MW','Malawi'],['BW','Botswana'],['NA','Namibia'],
  ['GA','Gabon'],['CG','Congo'],['CD','DR Congo'],['BI','Burundi'],
  ['GN','Guinea'],['SL','Sierra Leone'],['LR','Liberia'],['BF','Burkina Faso'],
  ['GM','Gambia'],['TD','Chad'],['LY','Libya'],['TN','Tunisia'],
  ['ER','Eritrea'],['DJ','Djibouti'],['SS','South Sudan'],['CF','Central African Republic'],
  ['US','United States'],['GB','United Kingdom'],['FR','France'],['DE','Germany'],
  ['IN','India'],['BR','Brazil'],['CA','Canada'],['AU','Australia'],
];

const MALE_FIRST = ['Emeka','Chidi','Babatunde','Segun','Femi','Tunde','Kola','Dele','Wale','Gbenga','Kwame','Kofi','Yaw','Ato','Kamau','Waweru','Otieno','Mwangi','Sipho','Themba','Bongani','Nhlanhla','Abebe','Tesfaye','Dawit','Amara','Oumar','Ibrahima','Mamadou','Seydou','Cheikh','Modou','Ismaila','Moussa','Bakary','Adama','Boubacar','Jean-Pierre','Emmanuel','Innocent','Samuel','Felix','Eric','Michael','David','Peter','John','Joseph','Ahmed','Mohamed','Yusuf','Omar','Ali','Mustafa','Khalid','Idris','Hassan','Rodrigo','Carlos','Jorge','Antonio','Pedro','Tariq','Rachid','Karim','Nabil','James','Robert','Francis','Geoffrey','Anthony','Luc','Herve','Didier','Serge','Victor','Marcel','Franck','Benjamin','Thabo','Lucky','Sello','Idrissa','Rasmane','Landry','Mathias','Issa','Salou','Soumana','Garba','Hamid','Yakubu','Musa','Sani','Bello','Alpha','Lamin','Momodou','Ebrima','William','Richard','Daniel','Isaac','Henri','Claude','Gerald','Pascal','Freddy','Elvis','Lazarus','Alfred','Stanley','Adeola','Rotimi','Kunle','Niyi','Dotun','Tosin','Biodun','Demola','Jide','Remi','Tendai','Farai','Simba','Alassane','Drissa','Fousseni','Julius','Charles','Leonard','Vincent','Nicholas','Oliver','Jonas','Thomas','Nicolas','Pierre','Antoine','Marco','Luca','Alessandro','Davide','Rajan','Arjun','Vikram','Suresh','Anil','Hiroshi','Kenji','Takeshi','Gabriel','Lucas','Diego','Rafael','Mateus','Vitor','Bruno','Thiago','Igor'];
const FEMALE_FIRST = ['Ngozi','Chioma','Adaeze','Amaka','Ifunanya','Bisi','Yetunde','Folake','Sade','Lara','Abena','Ama','Efua','Akua','Adwoa','Wanjiru','Njeri','Aisha','Grace','Faith','Zanele','Nomvula','Thandi','Lindiwe','Nombuso','Tigist','Meron','Selam','Hana','Sara','Fatoumata','Mariama','Kadiatou','Aissata','Bintou','Fatou','Awa','Rokhaya','Sokhna','Yacine','Rokiatou','Ramata','Kadija','Salimata','Consolata','Odette','Vestine','Monica','Sandra','Barbara','Josephine','Mary','Rose','Esther','Catherine','Charity','Hodan','Faadumo','Sahra','Hawa','Fatima','Amina','Luisa','Maria','Sofia','Isabel','Claudia','Zineb','Hafsa','Nadia','Imane','Alice','Ruth','Susan','Leah','Doris','Sylvie','Christiane','Jocelyne','Celine','Brigitte','Ines','Chantal','Beatrice','Therese','Madeleine','Portia','Dineo','Palesa','Refilwe','Mariam','Rasmata','Veronique','Aminata','Rabi','Zainab','Hadiza','Maryam','Hauwa','Isatou','Binta','Helena','Patricia','Agnes','Florence','Victoria','Laetitia','Angeline','Fanny','Odile','Marie-Claire','Denise','Jacqueline','Evelyn','Bertha','Judith','Martha','Lilian','Titilola','Gbemisola','Olawunmi','Omowumi','Abimbola','Oluwatosin','Olabisi','Oladunni','Olajumoke','Oluwakemi','Rudo','Chiedza','Tatenda','Tsitsi','Tariro','Niamato','Djenabou','Giulia','Francesca','Chiara','Valentina','Emma','Mia','Laura','Anna','Lena','Marie','Sophie','Camille','Chloe','Olivia','Ava','Sophia','Isabella','Priya','Divya','Anjali','Kavita','Sakura','Ana','Beatriz','Julia','Camila','Larissa','Leticia','Natalia','Fernanda'];
const LAST_NAMES = ['Okafor','Nwosu','Adeyemi','Afolabi','Okonkwo','Balogun','Adeola','Fashola','Ogundipe','Mensah','Asante','Boateng','Owusu','Njoroge','Kariuki','Ochieng','Kimani','Dlamini','Nkosi','Zulu','Mthembu','Ndlovu','Girma','Haile','Bekele','Tekle','Diallo','Bah','Sow','Camara','Keita','Mbaye','Fall','Diop','Seck','Traore','Coulibaly','Kone','Sylla','Toure','Habimana','Niyonzima','Ndayishimiye','Osei','Antwi','Asare','Acheampong','Mwamba','Banda','Phiri','Tembo','Hassan','Ibrahim','Abdi','Farah','Elhaj','Nour','Osman','Silva','Mendes','Fernandes','Lopes','Benali','Amrani','Belkacem','Mansouri','Mwangi','Otieno','Kamau','Ngugi','Mbarga','Nganou','Fotso','Manga','Kouassi','Brou','Yao','Molefe','Mokoena','Sithole','Ouedraogo','Zongo','Sawadogo','Kabore','Mahamadou','Harouna','Djibo','Suleiman','Abubakar','Abdullahi','Garba','Ceesay','Jallow','Saine','Quansah','Darko','Tetteh','Amoah','Ngoma','Massamba','Luba','Ndongo','Mutombo','Kabongo','Chakwera','Mhango','Manda','Martins','Adegoke','Oduya','Falodun','Lawal','Ogunleye','Adebayo','Olawale','Mutasa','Moyo','Gumbo','Diarra','Sangare','Diabate','Dembele','Conde','Soumah','Benson','Adeyinka','Adegbola','Omondi','Achieng','Oloo','Armah','Ababio','Ofori','Rossi','Ferrari','Schmidt','Weber','Martin','Bernard','Dubois','Simon','Wilson','Johnson','Davis','Brown','Miller','Patel','Sharma','Singh','Kumar','Tanaka','Suzuki','Watanabe','Santos','Oliveira','Alves','Costa','Ferreira','Lima','Pereira'];

function randInt(a,b){return Math.floor(Math.random()*(b-a+1))+a;}
function randFloat(a,b){return Math.round((Math.random()*(b-a)+a)*100)/100;}
function classifyAge(age){if(age<=12)return'child';if(age<=17)return'teenager';if(age<=64)return'adult';return'senior';}
function randomAge(){const r=Math.random();if(r<0.07)return randInt(0,12);if(r<0.14)return randInt(13,17);if(r<0.82)return randInt(18,64);return randInt(65,90);}

function buildProfiles() {
  const used=new Set();
  const profiles=[];
  function makeName(f){
    for(let i=0;i<20;i++){const l=LAST_NAMES[Math.floor(Math.random()*LAST_NAMES.length)];const n=`${f} ${l}`;if(!used.has(n.toLowerCase()))return n;}
    let i=2;const l=LAST_NAMES[Math.floor(Math.random()*LAST_NAMES.length)];while(used.has(`${f} ${l} ${i}`.toLowerCase()))i++;return`${f} ${l} ${i}`;
  }
  function pickCountry(){const[c,n]=COUNTRY_POOL[Math.floor(Math.random()*COUNTRY_POOL.length)];return{country_id:c,country_name:n};}
  const sm=[...MALE_FIRST].sort(()=>Math.random()-0.5);
  const sf=[...FEMALE_FIRST].sort(()=>Math.random()-0.5);
  for(let i=0;i<1013;i++){const fn=sm[i%sm.length];const name=makeName(fn);used.add(name.toLowerCase());const age=randomAge();const{country_id,country_name}=pickCountry();profiles.push({name,gender:'male',gender_probability:randFloat(0.60,0.99),age,age_group:classifyAge(age),country_id,country_name,country_probability:randFloat(0.05,0.95)});}
  for(let i=0;i<1013;i++){const fn=sf[i%sf.length];const name=makeName(fn);used.add(name.toLowerCase());const age=randomAge();const{country_id,country_name}=pickCountry();profiles.push({name,gender:'female',gender_probability:randFloat(0.60,0.99),age,age_group:classifyAge(age),country_id,country_name,country_probability:randFloat(0.05,0.95)});}
  return profiles;
}

async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  try {
    const db  = await getDb();
    const col = db.collection('profiles');

    const profiles = buildProfiles();
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
      if (err.result) {
        inserted = err.result.nInserted || 0;
        skipped  = profiles.length - inserted;
      } else throw err;
    }

    const total = await col.countDocuments();
    return res.status(200).json({ status: 'success', inserted, skipped, total });
  } catch (err) {
    console.error('POST /seed error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

module.exports = protect(
  applyObservability(handler, {
    routeId: 'POST /seed',
    policy: RATE_LIMIT_POLICIES.authStrict,
  }),
  ['admin']
);
