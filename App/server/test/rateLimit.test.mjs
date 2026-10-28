import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import {
  PASSWORD,
  buildApp,
  createClass,
  createStudent,
  createTeacher,
  resetDb,
} from './helpers.mjs';

const require = createRequire(import.meta.url);
const { LIMITS, TEACHER_MESSAGE, STUDENT_MESSAGE } = require('../middleware/rateLimit.js');

// NFR11: rate limiting and lockout on both logins.
describe('teacher login rate limit', () => {
  let app, teacher;

  beforeEach(async () => {
    await resetDb();
    app = buildApp();
    teacher = await createTeacher('teacher@example.org');
  });

  const login = (email, password) =>
    request(app).post('/api/teacher/login').send({ email, password });

  it('locks an account after too many wrong passwords, even for the right one', async () => {
    for (let i = 0; i < LIMITS.teacherLoginPerEmail; i++) {
      expect((await login(teacher.email, 'wrong-password')).status).toBe(401);
    }
    const res = await login(teacher.email, PASSWORD);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: TEACHER_MESSAGE });
  });

  it('treats email case and spacing as the same account', async () => {
    for (let i = 0; i < LIMITS.teacherLoginPerEmail; i++) {
      await login(` TEACHER@example.org${i % 2 ? ' ' : ''}`, 'wrong-password');
    }
    expect((await login(teacher.email, PASSWORD)).status).toBe(429);
  });

  it('does not count successful logins', async () => {
    for (let i = 0; i < LIMITS.teacherLoginPerEmail + 3; i++) {
      expect((await login(teacher.email, PASSWORD)).status).toBe(200);
    }
  });

  it('blocks one IP that tries many different accounts', async () => {
    for (let i = 0; i < LIMITS.teacherLoginPerIp; i++) {
      await login(`nobody${i}@example.org`, 'wrong-password');
    }
    expect((await login(teacher.email, PASSWORD)).status).toBe(429);
  });
});

describe('student login rate limit', () => {
  let app, student;

  beforeEach(async () => {
    await resetDb();
    app = buildApp();
    const teacher = await createTeacher();
    const klass = await createClass(teacher.id);
    student = await createStudent(klass.id, '424242');
  });

  const login = (code) => request(app).post('/api/student/login').send({ code });

  it('blocks an IP after too many wrong codes', async () => {
    for (let i = 0; i < LIMITS.studentLoginPerIp; i++) {
      expect((await login('000000')).status).toBe(401);
    }
    const res = await login(student.accessCode);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: STUDENT_MESSAGE });
  });

  it('lets a whole class log in from one IP', async () => {
    for (let i = 0; i < LIMITS.studentLoginPerIp + 5; i++) {
      expect((await login(student.accessCode)).status).toBe(200);
    }
  });
});
