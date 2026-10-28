const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Fail fast on missing secrets; name the variable, never print its value (NFR14).
const missing = ['JWT_SECRET', 'ACCESS_CODE_SECRET'].filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`[config] Missing required environment variable(s): ${missing.join(', ')}`);
  process.exit(1);
}

const buildApp = require('./buildApp');

const app = buildApp();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SPEAK API listening on http://localhost:${PORT}`);
});
