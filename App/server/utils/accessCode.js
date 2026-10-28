const crypto = require('crypto');
const pool = require('../db');

const CODE_LENGTH = 6;

// Child-friendly 6-digit code (D-07), from a cryptographic RNG (NFR10).
function randomNumericCode() {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

// Keyed HMAC: deterministic, so login and uniqueness checks can look a code up,
// but a database dump alone does not reveal any code (Design §6.2).
function hashAccessCode(code) {
  const secret = process.env.ACCESS_CODE_SECRET;
  if (!secret) throw new Error('ACCESS_CODE_SECRET is not set.');
  return crypto.createHmac('sha256', secret).update(String(code)).digest('hex');
}

// Returns a code that no other student currently holds, plus its hash.
async function generateUniqueAccessCode(db = pool) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomNumericCode();
    const hash = hashAccessCode(code);
    const [rows] = await db.query('SELECT id FROM students WHERE access_code_hash = ?', [hash]);
    if (rows.length === 0) return { code, hash };
  }
  throw new Error('Could not generate a unique access code, please retry.');
}

module.exports = { generateUniqueAccessCode, hashAccessCode, randomNumericCode, CODE_LENGTH };
