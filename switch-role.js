require('dotenv').config();
const { MongoClient } = require('mongodb');

const role = process.argv[2] || 'admin';

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'profileapi');
    
    const result = await db.collection('users').updateOne(
      { username: 'Summiedev' },
      { $set: { role } }
    );
    
    const user = await db.collection('users').findOne({ username: 'Summiedev' });
    console.log(`✅ Role switched to: ${user.role}`);
  } finally {
    await client.close();
  }
})();
