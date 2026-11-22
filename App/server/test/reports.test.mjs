import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  assignModule,
  buildApp,
  createClass,
  createStudent,
  createTeacher,
  pool,
  resetContent,
  resetDb,
  studentToken,
} from './helpers.mjs';
import { fixtureBundle } from './fixtures.mjs';

const require = createRequire(import.meta.url);
const { importBundle, publishVersion } = require('../importer/importService.js');
const { toCsv } = require('../utils/reports.js');

const auth = (token) => ({ Authorization: `Bearer ${token}` });

// R36, R37, R40, R41, R43, R45, R48: the teacher's view of progress.
describe('progress, results, export and reset', () => {
  let app, teacher, klass, mia, ben, moduleId, taskB, attemptId;

  beforeEach(async () => {
    await resetDb();
    await resetContent();
    app = buildApp();
    teacher = await createTeacher();
    klass = await createClass(teacher.id);
    mia = await createStudent(klass.id, '111111');
    ben = await createStudent(klass.id, '222222');
    await pool.query("UPDATE students SET display_name = 'Ben' WHERE id = ?", [ben.id]);

    const { versionId } = await importBundle(fixtureBundle());
    await publishVersion(versionId);
    const [[mod]] = await pool.query('SELECT id FROM modules WHERE week = 99');
    moduleId = mod.id;
    await assignModule(moduleId, { classId: klass.id });
    const [[task]] = await pool.query(
      "SELECT id FROM tasks WHERE content_version_id = ? AND format = 'B'",
      [versionId]
    );
    taskB = task.id;

    // Mia finishes B: question 1 right first time, question 2 on the 2nd try.
    const kid = auth(studentToken(mia.id, klass.id));
    attemptId = (await request(app).post('/api/attempts').set(kid).send({ taskId: taskB })).body
      .attempt.id;
    const [trials] = await pool.query('SELECT id FROM trials WHERE task_id = ? ORDER BY position', [
      taskB,
    ]);
    for (const [trialId, optionId] of [
      [trials[0].id, 'o1'],
      [trials[1].id, 'o3'],
      [trials[1].id, 'o1'],
    ]) {
      await request(app).post('/api/responses').set(kid).send({ attemptId, trialId, optionId });
    }
    await request(app).patch(`/api/attempts/${attemptId}/complete`).set(kid);
  });

  const get = (path, token = teacher.token) => request(app).get(path).set(auth(token));

  describe('GET /api/progress (R36, R40)', () => {
    it('summarises classes, students, modules and completion', async () => {
      const res = await get('/api/progress');
      expect(res.status).toBe(200);
      // Mia 1 of 1 path task, Ben 0 of 1: 50 % on average.
      expect(res.body.stats).toEqual({
        classes: 1,
        students: 2,
        assignedModules: 1,
        avgCompletion: 50,
      });
      expect(res.body.classes).toEqual([
        {
          id: klass.id,
          name: 'Klasse 1a',
          students: 2,
          completion: 50,
          modules: [{ moduleId, completion: 50 }],
        },
      ]);
      expect(res.body.modules).toEqual([
        { moduleId, week: 99, area: 'vocabulary', completion: 50 },
      ]);
      expect(res.body.recent).toEqual([
        expect.objectContaining({
          studentName: 'Mia',
          format: 'B',
          status: 'completed',
          score: 100,
        }),
      ]);
    });

    it('shows another teacher nothing of this class', async () => {
      const other = await createTeacher('other@example.org');
      const res = await get('/api/progress', other.token);
      expect(res.body.stats).toEqual({
        classes: 0,
        students: 0,
        assignedModules: 0,
        avgCompletion: 0,
      });
      expect(res.body.recent).toEqual([]);
    });

    it('is for teachers only', async () => {
      expect((await get('/api/progress', studentToken(mia.id, klass.id))).status).toBe(403);
    });
  });

  describe('GET /api/results (R37, R41)', () => {
    it('lists started tasks and the completion of every assigned student', async () => {
      const res = await get('/api/results');
      expect(res.body.rows).toEqual([
        expect.objectContaining({
          attemptId,
          studentName: 'Mia',
          format: 'B',
          status: 'completed',
          score: 100,
          firstTryScore: 50,
          mistakes: 1,
          attempts: 1,
        }),
      ]);
      expect(res.body.summary.map((p) => [p.studentName, p.done, p.total, p.completion])).toEqual([
        ['Ben', 0, 1, 0],
        ['Mia', 1, 1, 100],
      ]);
    });

    it('filters by week, area, class and student', async () => {
      expect((await get(`/api/results?studentId=${ben.id}`)).body.rows).toEqual([]);
      expect((await get('/api/results?area=grammar')).body.summary).toEqual([]);
      expect((await get('/api/results?week=99&area=vocabulary')).body.rows).toHaveLength(1);
      expect((await get(`/api/results?classId=${klass.id}`)).body.summary).toHaveLength(2);
      expect((await get('/api/results?area=music')).status).toBe(400);
      expect((await get('/api/results?week=x')).status).toBe(400);
    });

    it('shows one task question by question with every tap', async () => {
      const res = await get(`/api/results/attempts/${attemptId}`);
      expect(res.body.attempt).toMatchObject({ studentName: 'Mia', format: 'B', score: 100 });
      expect(res.body.trials).toHaveLength(2);
      expect(
        res.body.trials[1].responses.map((r) => [r.optionId, r.correct, r.attemptNumber])
      ).toEqual([
        ['o3', false, 1],
        ['o1', true, 2],
      ]);
      expect(res.body.trials[0].options[0]).toMatchObject({ id: 'o1', correct: true });
      expect(res.body.trials[0].options[0].imageId).toEqual(expect.any(Number));

      const other = await createTeacher('other@example.org');
      expect((await get(`/api/results/attempts/${attemptId}`, other.token)).status).toBe(404);
    });
  });

  describe('GET /api/results/export.csv (R45, R48)', () => {
    it('exports one line per task, or one per answer', async () => {
      let res = await get('/api/results/export.csv');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      let lines = res.text
        .replace(/^\uFEFF/, '')
        .trim()
        .split('\r\n');
      expect(lines[0]).toBe(
        'class;student;week;area;block;format;adaption;status;score_percent;first_try_percent;mistakes;needs_remediation;attempts;completed_at'
      );
      expect(lines[1]).toMatch(
        /^Klasse 1a;Mia;99;vocabulary;W99_V1;B;0;completed;100;50;1;0;1;\d{4}-/
      );

      res = await get('/api/results/export.csv?level=responses');
      lines = res.text
        .replace(/^\uFEFF/, '')
        .trim()
        .split('\r\n');
      expect(lines).toHaveLength(4); // header + 3 taps
      expect(lines[2]).toMatch(/^Klasse 1a;Mia;99;vocabulary;W99_V1;B;2;o3;0;1;/);
    });

    it('quotes separators and defuses formulas', () => {
      expect(toCsv(['a', 'b'], [['x;y', '=SUM(A1)']])).toBe('\uFEFFa;b\r\n"x;y";\'=SUM(A1)\r\n');
    });
  });

  describe('POST /api/students/:id/modules/:moduleId/reset (R43)', () => {
    it('takes the module back to the start for that student, keeping the history', async () => {
      const res = await request(app)
        .post(`/api/students/${mia.id}/modules/${moduleId}/reset`)
        .set(auth(teacher.token));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reset: 1 });

      expect((await get('/api/results')).body.rows).toEqual([]);
      expect((await get('/api/progress')).body.stats.avgCompletion).toBe(0);
      const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM responses');
      expect(Number(n)).toBe(3); // responses are never deleted by a reset
      const [audit] = await pool.query(
        "SELECT target_id FROM audit_log WHERE action = 'student.module_reset'"
      );
      expect(audit).toEqual([{ target_id: mia.id }]);

      // The child starts the task afresh.
      const kid = auth(studentToken(mia.id, klass.id));
      const progress = await request(app).get(`/api/modules/${moduleId}/progress`).set(kid);
      expect(progress.body.current).toBe(taskB);
    });

    it("refuses another teacher's student", async () => {
      const other = await createTeacher('other@example.org');
      const res = await request(app)
        .post(`/api/students/${mia.id}/modules/${moduleId}/reset`)
        .set(auth(other.token));
      expect(res.status).toBe(403);
    });
  });

  describe('input validation (R46)', () => {
    it('class names are unique per teacher', async () => {
      const post = (name, token = teacher.token) =>
        request(app).post('/api/classes').set(auth(token)).send({ name });
      expect((await post(' klasse 1A ')).status).toBe(400);
      expect((await post('x'.repeat(81))).status).toBe(400);
      expect((await post('Klasse 1b')).status).toBe(201);
      const other = await createTeacher('other@example.org');
      expect((await post('Klasse 1a', other.token)).status).toBe(201);
    });

    it('student names are unique per class', async () => {
      const post = (displayName) =>
        request(app)
          .post(`/api/classes/${klass.id}/students`)
          .set(auth(teacher.token))
          .send({ displayName });
      expect((await post('MIA')).body.error).toBe(
        'A student with this name is already in the class.'
      );
      expect((await post('Lea')).status).toBe(201);
      const patch = (id, displayName) =>
        request(app).patch(`/api/students/${id}`).set(auth(teacher.token)).send({ displayName });
      expect((await patch(ben.id, 'mia')).status).toBe(400);
      expect((await patch(mia.id, 'Mia')).status).toBe(200); // its own name is fine
    });
  });
});
