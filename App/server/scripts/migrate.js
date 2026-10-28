// Applies the numbered SQL files in migrations/ in order (NNN_description.sql).
// Safe to run twice: applied files are recorded in schema_migrations and
// skipped. Run with `npm run migrate` (locally or via Plesk "Node.js-Befehle").
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dbConfig = require('../dbConfig');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const FILE_RE = /^(\d{3})_[a-z0-9_]+\.sql$/;
const LOCK_NAME = 'speak_migrate';

function listMigrations(dir = MIGRATIONS_DIR) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => FILE_RE.test(f))
    .sort();
  const seen = new Set();
  for (const file of files) {
    const number = file.match(FILE_RE)[1];
    if (seen.has(number)) throw new Error(`Two migrations share the number ${number}.`);
    seen.add(number);
  }
  return files;
}

// `connection` must be opened with multipleStatements: true.
async function migrate(connection, { dir = MIGRATIONS_DIR, log = console.log } = {}) {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       VARCHAR(190) PRIMARY KEY,
       applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  // Guards against two runs at once (e.g. a double click in the Plesk panel).
  const [[{ locked }]] = await connection.query('SELECT GET_LOCK(?, 30) AS locked', [LOCK_NAME]);
  if (locked !== 1) throw new Error('Another migration run is in progress.');

  try {
    const [rows] = await connection.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const pending = listMigrations(dir).filter((f) => !applied.has(f));

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      try {
        await connection.query(sql);
      } catch (err) {
        // MySQL DDL is not transactional: a failed file may be half applied.
        err.message = `Migration ${file} failed: ${err.message}`;
        throw err;
      }
      await connection.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      log(`Applied ${file}`);
    }

    if (pending.length === 0) log('Database is up to date.');
    return pending;
  } finally {
    await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
  }
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
  const connection = await mysql.createConnection({ ...dbConfig(), multipleStatements: true });
  try {
    await migrate(connection);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // Code and message only: no stack, no connection settings (NFR14).
    console.error(`[migrate] ${err.code || 'ERROR'}: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { migrate, listMigrations };
