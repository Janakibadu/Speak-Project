const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const isProduction = process.env.NODE_ENV === 'production';

// Fail fast on missing secrets; name the variable, never print its value (NFR14).
// Locally the DB_* settings fall back to dev defaults (see dbConfig.js).
const required = ['JWT_SECRET', 'ACCESS_CODE_SECRET'];
if (isProduction) required.push('DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME');
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`[config] Missing required environment variable(s): ${missing.join(', ')}`);
  process.exit(1);
}

const buildApp = require('./buildApp');
const { runMigrations } = require('./scripts/migrate');

async function start() {
  // On Plesk the panel's variables reach the running app but not npm scripts
  // started from "Node.js-Befehle ausführen", so production migrates here.
  // Safe on every restart: applied files are skipped.
  if (isProduction) await runMigrations();

  const app = buildApp();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`SPEAK API listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  // Code and message only: no stack, no connection settings (NFR14).
  console.error(`[startup] ${err.code || 'ERROR'}: ${err.message}`);
  process.exit(1);
});
