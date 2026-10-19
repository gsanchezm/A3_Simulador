const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { hashPassword, cleanEmail, validEmail, validPassword } = require('./security');

function createPool() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('Falta DATABASE_URL o POSTGRES_URL');
  return new Pool({ connectionString, max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
}

async function initializeDatabase(db, adminEmail, adminPassword) {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await db.query(schema);
  const email = cleanEmail(adminEmail);
  if (!validEmail(email) || !validPassword(adminPassword)) {
    throw new Error('Configura ADMIN_EMAIL válido y ADMIN_PASSWORD de al menos 12 caracteres');
  }
  const exists = await db.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
  if (!exists.rows.length) {
    await db.query('INSERT INTO users (id, name, email, password_hash, role, approved) VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT (email) DO NOTHING',
      [randomUUID(), 'Administrador', email, await hashPassword(adminPassword), 'admin']);
  }
}

async function transaction(db, callback) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { createPool, initializeDatabase, transaction };
