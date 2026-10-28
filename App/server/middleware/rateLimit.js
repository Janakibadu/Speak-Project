const { rateLimit } = require('express-rate-limit');

// Login rate limits (NFR11). Only failed attempts count (status >= 400), so a
// whole class logging in from one school IP is never blocked by successes.
// Counters live in process memory: they reset on restart and are per process.
const WINDOW_MS = 15 * 60 * 1000;

const LIMITS = {
  teacherLoginPerIp: 20,
  teacherLoginPerEmail: 5,
  // Children mistype codes and usually share one school IP, so this is looser.
  studentLoginPerIp: 30,
};

const TEACHER_MESSAGE = 'Too many login attempts. Please try again in 15 minutes.';
const STUDENT_MESSAGE = 'Too many tries. Please ask your teacher for help.';

function emailKey(req) {
  const email = req.body && req.body.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function failedAttemptLimiter(limit, message, extra = {}) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: message },
    ...extra,
  });
}

function createLoginLimiters() {
  return {
    teacherLoginByIp: failedAttemptLimiter(LIMITS.teacherLoginPerIp, TEACHER_MESSAGE),
    // Per-account lockout: stops slow guessing spread across many IPs.
    teacherLoginByEmail: failedAttemptLimiter(LIMITS.teacherLoginPerEmail, TEACHER_MESSAGE, {
      keyGenerator: (req) => `email:${emailKey(req)}`,
      skip: (req) => !emailKey(req),
    }),
    studentLoginByIp: failedAttemptLimiter(LIMITS.studentLoginPerIp, STUDENT_MESSAGE),
  };
}

module.exports = { createLoginLimiters, LIMITS, TEACHER_MESSAGE, STUDENT_MESSAGE };
