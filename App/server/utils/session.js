const jwt = require('jsonwebtoken');

// NFR09: a teacher session ends after a period of inactivity. Tokens are
// short-lived and renewed on each authenticated request (sent back in the
// X-Session-Token header), up to an absolute maximum session length.
const SESSION_HEADER = 'X-Session-Token';
const RENEW_AFTER_SECONDS = 60;

function idleMinutes() {
  return Number(process.env.TEACHER_IDLE_MINUTES) || 30;
}

function maxSessionHours() {
  return Number(process.env.TEACHER_MAX_SESSION_HOURS) || 12;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function issueTeacherToken(teacherId, authTime = nowSeconds()) {
  return jwt.sign(
    { sub: teacherId, role: 'TEACHER', auth_time: authTime },
    process.env.JWT_SECRET,
    { expiresIn: `${idleMinutes()}m` }
  );
}

// A fresh token for a verified teacher payload, or null when none is due:
// recently issued, or the absolute session limit has been reached.
function renewTeacherToken(payload) {
  const now = nowSeconds();
  if (now - payload.iat < RENEW_AFTER_SECONDS) return null;
  const authTime = payload.auth_time || payload.iat;
  if (now - authTime >= maxSessionHours() * 3600) return null;
  return issueTeacherToken(payload.sub, authTime);
}

module.exports = { SESSION_HEADER, issueTeacherToken, renewTeacherToken };
