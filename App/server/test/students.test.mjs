import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { buildApp, createClass, createStudent, createTeacher, pool, resetDb } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { hashAccessCode, randomNumericCode } = require('../utils/accessCode.js');

// R05, R06, NFR03, NFR05, NFR10, D-07.
describe('student management', () => {
  let app, teacher, klass;

  beforeEach(async () => {
    await resetDb();
    app = buildApp();
    teacher = await createTeacher();
    klass = await createClass(teacher.id);
  });

  const auth = () => ({ Authorization: `Bearer ${teacher.token}` });
  const studentLogin = (code) => request(app).post('/api/student/login').send({ code });
  const auditRows = async () => {
    const [rows] = await pool.query(
      'SELECT actor_teacher_id, action, target_type, target_id FROM audit_log ORDER BY id'
    );
    return rows;
  };

  it('shows a new code once and stores only its hash', async () => {
    const res = await request(app)
      .post(`/api/classes/${klass.id}/students`)
      .set(auth())
      .send({ displayName: '  Lio ' });
    expect(res.status).toBe(201);
    const { student } = res.body;
    expect(student.displayName).toBe('Lio');
    expect(student.accessCode).toMatch(/^\d{6}$/);
    expect(student.qrSvg).toMatch(/^<svg/);

    const [rows] = await pool.query('SELECT * FROM students WHERE id = ?', [student.id]);
    expect(rows[0].access_code_hash).toBe(hashAccessCode(student.accessCode));
    expect(JSON.stringify(rows[0])).not.toContain(student.accessCode);

    const list = await request(app).get(`/api/classes/${klass.id}/students`).set(auth());
    expect(list.body.students[0]).toMatchObject({ id: student.id, hasCode: true });
    expect(list.body.students[0].accessCode).toBeUndefined();
    expect(list.body.students[0].qrSvg).toBeUndefined();

    expect((await studentLogin(student.accessCode)).status).toBe(200);
    expect(await auditRows()).toEqual([
      {
        actor_teacher_id: teacher.id,
        action: 'student.created',
        target_type: 'student',
        target_id: student.id,
      },
    ]);
  });

  it('regenerating a code invalidates the old one', async () => {
    const student = await createStudent(klass.id, '111111');
    const res = await request(app).post(`/api/students/${student.id}/regenerate-code`).set(auth());
    expect(res.status).toBe(200);
    const newCode = res.body.student.accessCode;
    expect(newCode).toMatch(/^\d{6}$/);

    expect((await studentLogin('111111')).status).toBe(401);
    expect((await studentLogin(newCode)).status).toBe(200);
  });

  it('renames a student', async () => {
    const student = await createStudent(klass.id);
    const res = await request(app)
      .patch(`/api/students/${student.id}`)
      .set(auth())
      .send({ displayName: 'Emma' });
    expect(res.status).toBe(200);
    expect(res.body.student).toMatchObject({ displayName: 'Emma', status: 'active' });
  });

  it('a deactivated student cannot log in until reactivated', async () => {
    const student = await createStudent(klass.id, '222222');
    const off = await request(app)
      .patch(`/api/students/${student.id}`)
      .set(auth())
      .send({ status: 'deactivated' });
    expect(off.body.student.status).toBe('deactivated');
    expect((await studentLogin('222222')).status).toBe(403);

    await request(app).patch(`/api/students/${student.id}`).set(auth()).send({ status: 'active' });
    expect((await studentLogin('222222')).status).toBe(200);
  });

  it('rejects invalid edits', async () => {
    const student = await createStudent(klass.id);
    const patch = (body) =>
      request(app).patch(`/api/students/${student.id}`).set(auth()).send(body);
    expect((await patch({ displayName: '   ' })).status).toBe(400);
    expect((await patch({ status: 'deleted' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
  });

  it('deletes a student permanently and audits it', async () => {
    const student = await createStudent(klass.id, '333333');
    const res = await request(app).delete(`/api/students/${student.id}`).set(auth());
    expect(res.status).toBe(204);

    const [rows] = await pool.query('SELECT id FROM students WHERE id = ?', [student.id]);
    expect(rows).toEqual([]);
    expect((await studentLogin('333333')).status).toBe(401);
    expect(await auditRows()).toEqual([
      {
        actor_teacher_id: teacher.id,
        action: 'student.deleted',
        target_type: 'student',
        target_id: student.id,
      },
    ]);
  });

  it('returns 404 when deleting a student that does not exist', async () => {
    const res = await request(app).delete('/api/students/999999').set(auth());
    expect(res.status).toBe(404);
  });

  it('audits teacher registration', async () => {
    const res = await request(app).post('/api/teacher/register').send({
      fullName: 'Neue Lehrkraft',
      email: 'new@example.org',
      password: 'long-enough-1',
      confirmPassword: 'long-enough-1',
    });
    expect(res.status).toBe(201);
    expect(await auditRows()).toEqual([
      {
        actor_teacher_id: res.body.teacher.id,
        action: 'teacher.registered',
        target_type: 'teacher',
        target_id: res.body.teacher.id,
      },
    ]);
  });
});

describe('access codes', () => {
  it('are six digits, zero-padded', () => {
    for (let i = 0; i < 200; i++) expect(randomNumericCode()).toMatch(/^\d{6}$/);
  });

  it('hash with the configured key', () => {
    expect(hashAccessCode('123456')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAccessCode('123456')).not.toBe(hashAccessCode('123457'));
  });
});
