import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  buildApp,
  createClass,
  createStudent,
  createTeacher,
  pool,
  resetDb,
  studentToken,
} from './helpers.mjs';

// verifyToken → requireRole → requireOwnership (R14, R15, NFR04, NFR15).
describe('protected teacher routes', () => {
  let app, owner, other, klass, student;

  beforeEach(async () => {
    await resetDb();
    app = buildApp();
    owner = await createTeacher('owner@example.org');
    other = await createTeacher('other@example.org');
    klass = await createClass(owner.id);
    student = await createStudent(klass.id);
  });

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  it('rejects a request without a token', async () => {
    const res = await request(app).get(`/api/classes/${klass.id}/students`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing auth token.' });
  });

  it('rejects an invalid token', async () => {
    const res = await request(app).get(`/api/classes/${klass.id}/students`).set(auth('not-a-jwt'));
    expect(res.status).toBe(401);
  });

  it('rejects a student token on a teacher route', async () => {
    const res = await request(app)
      .get(`/api/classes/${klass.id}/students`)
      .set(auth(studentToken(student.id, klass.id)));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Not allowed for this account type.' });
  });

  it("rejects another teacher's class without leaking its data", async () => {
    const res = await request(app).get(`/api/classes/${klass.id}/students`).set(auth(other.token));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'You do not own this class.' });
  });

  it("rejects regenerating another teacher's student code", async () => {
    const res = await request(app)
      .post(`/api/students/${student.id}/regenerate-code`)
      .set(auth(other.token));
    expect(res.status).toBe(403);
    expect(res.body.student).toBeUndefined();

    // The old code still works, so nothing was changed.
    const login = await request(app).post('/api/student/login').send({ code: student.accessCode });
    expect(login.status).toBe(200);
  });

  it("rejects editing or deleting another teacher's student", async () => {
    const patch = await request(app)
      .patch(`/api/students/${student.id}`)
      .set(auth(other.token))
      .send({ displayName: 'Hacked' });
    expect(patch.status).toBe(403);
    const del = await request(app).delete(`/api/students/${student.id}`).set(auth(other.token));
    expect(del.status).toBe(403);

    const [rows] = await pool.query('SELECT display_name FROM students WHERE id = ?', [student.id]);
    expect(rows).toEqual([{ display_name: 'Mia' }]);
  });

  it('rejects a student token on student management routes', async () => {
    const res = await request(app)
      .delete(`/api/students/${student.id}`)
      .set(auth(studentToken(student.id, klass.id)));
    expect(res.status).toBe(403);
  });

  it('returns 404 for a class that does not exist', async () => {
    const res = await request(app).get('/api/classes/999999/students').set(auth(owner.token));
    expect(res.status).toBe(404);
  });

  it('lets the owner list students', async () => {
    const res = await request(app).get(`/api/classes/${klass.id}/students`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.students).toHaveLength(1);
    expect(res.body.students[0]).toMatchObject({ id: student.id, displayName: 'Mia' });
  });

  it("lists only the caller's own classes", async () => {
    await createClass(other.id, 'Fremde Klasse');
    const res = await request(app).get('/api/classes').set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.classes.map((c) => c.id)).toEqual([klass.id]);
  });
});
