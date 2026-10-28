import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { buildApp, createTeacher, resetDb } from './helpers.mjs';

// NFR09: teacher sessions expire after inactivity, renewed while in use.
describe('teacher session', () => {
  let app, teacher;
  const now = () => Math.floor(Date.now() / 1000);
  const sign = (payload, expiresIn = '30m') =>
    jwt.sign({ sub: teacher.id, role: 'TEACHER', ...payload }, process.env.JWT_SECRET, {
      expiresIn,
    });
  const getClasses = (token) =>
    request(app).get('/api/classes').set('Authorization', `Bearer ${token}`);

  beforeEach(async () => {
    await resetDb();
    app = buildApp();
    teacher = await createTeacher();
  });

  it('logs in with a short-lived token', async () => {
    const res = await request(app)
      .post('/api/teacher/login')
      .send({ email: teacher.email, password: 'correct-horse-1' });
    const payload = jwt.decode(res.body.token);
    expect(payload.exp - payload.iat).toBe(30 * 60);
    expect(payload.auth_time).toBe(payload.iat);
  });

  it('renews an active session but keeps the original login time', async () => {
    const authTime = now() - 3600;
    const res = await getClasses(sign({ auth_time: authTime, iat: now() - 120 }));
    expect(res.status).toBe(200);
    const renewed = jwt.decode(res.headers['x-session-token']);
    expect(renewed.auth_time).toBe(authTime);
    expect(renewed.exp).toBeGreaterThan(now() + 29 * 60);
  });

  it('does not renew a token issued moments ago', async () => {
    const res = await getClasses(sign({ auth_time: now() }));
    expect(res.headers['x-session-token']).toBeUndefined();
  });

  it('stops renewing after the maximum session length', async () => {
    const res = await getClasses(sign({ auth_time: now() - 13 * 3600, iat: now() - 120 }));
    expect(res.status).toBe(200);
    expect(res.headers['x-session-token']).toBeUndefined();
  });

  it('rejects an expired token after inactivity', async () => {
    const res = await getClasses(sign({ iat: now() - 31 * 60 }, '30m'));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid or expired token.' });
  });
});
