const { MongoClient } = require('mongodb');

let client = null;
let db     = null;

async function getDb() {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI environment variable is not set');

  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS:         5000,
  });

  await client.connect();
  db = client.db(process.env.MONGODB_DB || 'profileapi');

  const col = db.collection('profiles');
  const usersCol = db.collection('users');
  const refreshTokensCol = db.collection('refresh_tokens');
  const authStatesCol = db.collection('auth_states');

  // Idempotency + performance indexes
  await col.createIndex({ name: 1 },               { unique: true });
  await col.createIndex({ gender: 1 });
  await col.createIndex({ age_group: 1 });
  await col.createIndex({ country_id: 1 });
  await col.createIndex({ age: 1 });
  await col.createIndex({ gender_probability: 1 });
  await col.createIndex({ country_probability: 1 });
  await col.createIndex({ created_at: 1 });
  await col.createIndex({ gender: 1, country_id: 1, age: 1, created_at: -1 });
  await col.createIndex({ country_id: 1, age: 1, created_at: -1 });
  await col.createIndex({ gender: 1, age_group: 1, created_at: -1 });
  await col.createIndex({ gender: 1, created_at: -1 });

  // Stage 3 auth indexes
  await usersCol.createIndex({ id: 1 }, { unique: true });
  await usersCol.createIndex({ github_id: 1 }, { unique: true });
  await usersCol.createIndex({ username: 1 }, { unique: true });
  await usersCol.createIndex({ email: 1 }, { sparse: true });
  await usersCol.createIndex({ created_at: 1 });

  await refreshTokensCol.createIndex({ id: 1 }, { unique: true });
  await refreshTokensCol.createIndex({ hashed_refresh_token: 1 }, { unique: true });
  await refreshTokensCol.createIndex({ user_id: 1, revoked: 1 });
  await refreshTokensCol.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
  await refreshTokensCol.createIndex({ created_at: 1 });

  await authStatesCol.createIndex({ id: 1 }, { unique: true });
  await authStatesCol.createIndex({ state_hash: 1 }, { unique: true });
  await authStatesCol.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
  await authStatesCol.createIndex({ created_at: 1 });

  return db;
}

module.exports = { getDb };
