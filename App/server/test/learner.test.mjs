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
const { scoreTask, trialState } = require('../utils/trialRules.js');

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('trial rules (R31, R32, R34)', () => {
  const one = { id: 1, correct_option: 'o1' };
  const three = { id: 2, correct_option: 'o1,o2,o3' };
  const tap = (optionId) => ({ optionId });

  it('a question is solved by the correct option, failed after two wrong taps', () => {
    expect(trialState(one, [tap('o1')])).toMatchObject({ solved: true, finished: true });
    expect(trialState(one, [tap('o2')])).toMatchObject({ finished: false, wrongTaps: 1 });
    expect(trialState(one, [tap('o2'), tap('o3')])).toMatchObject({ solved: false, failed: true });
    expect(trialState(one, [tap('o2'), tap('o3')], 3).finished).toBe(false);
  });

  it('a question with several correct options needs all of them (U)', () => {
    expect(trialState(three, [tap('o1'), tap('o3')]).finished).toBe(false);
    expect(trialState(three, [tap('o1'), tap('o4'), tap('o3'), tap('o2')]).solved).toBe(true);
  });

  it('scores the share solved, the share solved first time, and every wrong tap', () => {
    const taps = new Map([
      [1, [tap('o2'), tap('o1')]],
      [2, [tap('o1'), tap('o2'), tap('o3')]],
    ]);
    expect(scoreTask([one, three], taps)).toEqual({ score: 100, firstTryScore: 50, mistakes: 1 });
    expect(scoreTask([], new Map())).toEqual({ score: null, firstTryScore: null, mistakes: 0 });
  });
});

describe('assignments, attempts and responses', () => {
  let app, teacher, klass, student, kidToken, moduleId, taskB, taskC, trials;

  beforeEach(async () => {
    await resetDb();
    await resetContent();
    app = buildApp();
    teacher = await createTeacher();
    klass = await createClass(teacher.id);
    student = await createStudent(klass.id);
    kidToken = studentToken(student.id, klass.id);

    // Fixture: V1 = B with two questions (o1 correct), V2 = C (adaption).
    const { versionId } = await importBundle(fixtureBundle());
    await publishVersion(versionId);
    const [[mod]] = await pool.query('SELECT id FROM modules WHERE week = 99');
    moduleId = mod.id;
    const [tasks] = await pool.query(
      'SELECT id, format FROM tasks WHERE content_version_id = ? ORDER BY position',
      [versionId]
    );
    [taskB, taskC] = tasks.map((t) => t.id);
    [trials] = await pool.query('SELECT id FROM trials WHERE task_id = ? ORDER BY position', [
      taskB,
    ]);
  });

  const kid = () => request(app);
  const start = (taskId, token = kidToken) =>
    kid().post('/api/attempts').set(auth(token)).send({ taskId });
  const answer = (attemptId, trialId, optionId) =>
    kid().post('/api/responses').set(auth(kidToken)).send({ attemptId, trialId, optionId });
  const complete = (attemptId) =>
    kid().patch(`/api/attempts/${attemptId}/complete`).set(auth(kidToken));

  describe('POST/GET/DELETE /api/assignments (R19)', () => {
    it('assigns a module to an own class or student, once', async () => {
      const post = (body) =>
        request(app).post('/api/assignments').set(auth(teacher.token)).send(body);
      expect((await post({ moduleId, classId: klass.id })).status).toBe(201);
      expect((await post({ moduleId, classId: klass.id })).status).toBe(409);
      expect((await post({ moduleId, studentId: student.id })).status).toBe(201);
      expect((await post({ moduleId })).status).toBe(400);
      expect((await post({ moduleId, classId: klass.id, studentId: student.id })).status).toBe(400);

      const res = await request(app).get('/api/assignments').set(auth(teacher.token));
      expect(res.body.assignments).toEqual([
        expect.objectContaining({ moduleId, studentId: student.id, studentName: 'Mia' }),
        expect.objectContaining({ moduleId, classId: klass.id, className: 'Klasse 1a' }),
      ]);
    });

    it("refuses another teacher's class and hides their assignments", async () => {
      const other = await createTeacher('other@example.org');
      let res = await request(app)
        .post('/api/assignments')
        .set(auth(other.token))
        .send({ moduleId, classId: klass.id });
      expect(res.status).toBe(403);

      await assignModule(moduleId, { classId: klass.id });
      res = await request(app).get('/api/assignments').set(auth(other.token));
      expect(res.body.assignments).toEqual([]);
      const [[{ id }]] = await pool.query('SELECT id FROM assignments');
      expect(
        (await request(app).delete(`/api/assignments/${id}`).set(auth(other.token))).status
      ).toBe(404);
      expect(
        (await request(app).delete(`/api/assignments/${id}`).set(auth(teacher.token))).status
      ).toBe(204);
    });

    it('is for teachers only', async () => {
      expect((await request(app).get('/api/assignments').set(auth(kidToken))).status).toBe(403);
    });
  });

  describe('attempts (R33–R35)', () => {
    beforeEach(() => assignModule(moduleId, { classId: klass.id }));

    it('starts a task once and resumes it with the recorded taps', async () => {
      let res = await start(taskB);
      expect(res.status).toBe(201);
      const attemptId = res.body.attempt.id;
      expect((await answer(attemptId, trials[0].id, 'o2')).status).toBe(201);

      res = await start(taskB);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        attempt: { id: attemptId, taskId: taskB },
        responses: [{ trialId: trials[0].id, optionId: 'o2' }],
      });
    });

    it('only for assigned modules and for students', async () => {
      await pool.query('DELETE FROM assignments');
      expect((await start(taskB)).status).toBe(404);
      expect((await start(taskB, teacher.token)).status).toBe(403);
    });

    it('judges every tap on the server and records the try number (R31, R33)', async () => {
      const attemptId = (await start(taskB)).body.attempt.id;
      const q = trials[0].id;
      expect((await answer(attemptId, q, 'o2')).body).toEqual({ correct: false, attemptNumber: 1 });
      // A retried POST of the same tap returns the stored result.
      const again = await answer(attemptId, q, 'o2');
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ correct: false, attemptNumber: 1 });
      expect((await answer(attemptId, q, 'o3')).body).toEqual({ correct: false, attemptNumber: 2 });
      // Two wrong taps end the question.
      expect((await answer(attemptId, q, 'o1')).status).toBe(409);
      expect((await answer(attemptId, q, 'o9')).status).toBe(400);

      const [rows] = await pool.query(
        'SELECT option_id, is_correct, attempt_number, answered_at FROM responses ORDER BY id'
      );
      expect(rows.map((r) => [r.option_id, r.is_correct, r.attempt_number])).toEqual([
        ['o2', 0, 1],
        ['o3', 0, 2],
      ]);
      expect(rows[0].answered_at).toBeInstanceOf(Date);
    });

    it("refuses another student's attempt", async () => {
      const attemptId = (await start(taskB)).body.attempt.id;
      const other = await createStudent(klass.id, '654321');
      const res = await request(app)
        .post('/api/responses')
        .set(auth(studentToken(other.id, klass.id)))
        .send({ attemptId, trialId: trials[0].id, optionId: 'o1' });
      expect(res.status).toBe(404);
    });

    it('completes only when every question is answered, and scores it (R34)', async () => {
      const attemptId = (await start(taskB)).body.attempt.id;
      await answer(attemptId, trials[0].id, 'o2');
      await answer(attemptId, trials[0].id, 'o1');
      expect((await complete(attemptId)).status).toBe(409);

      await answer(attemptId, trials[1].id, 'o3');
      await answer(attemptId, trials[1].id, 'o4');
      const res = await complete(attemptId);
      expect(res.status).toBe(200);
      // Q1 right on the 2nd try, Q2 failed: 50 %, none first time, 3 wrong taps.
      expect(res.body).toMatchObject({ score: 50, firstTryScore: 0, mistakes: 3 });
      // Completing again returns the same result.
      expect((await complete(attemptId)).body).toMatchObject({ score: 50, mistakes: 3 });
    });

    it('sends the child to the adaption task at the mistake threshold (R32)', async () => {
      let attemptId = (await start(taskB)).body.attempt.id;
      await answer(attemptId, trials[0].id, 'o2');
      await answer(attemptId, trials[0].id, 'o3');
      await answer(attemptId, trials[1].id, 'o3');
      await answer(attemptId, trials[1].id, 'o2');
      let res = await complete(attemptId);
      expect(res.body).toMatchObject({ mistakes: 4, needsRemediation: true, next: taskC });

      let progress = await kid().get(`/api/modules/${moduleId}/progress`).set(auth(kidToken));
      expect(progress.body.tasks.map((t) => t.status)).toEqual(['done', 'pending']);
      expect(progress.body).toMatchObject({ current: taskC, done: 1, total: 1 });

      // The adaption task has no questions: complete it straight away.
      attemptId = (await start(taskC)).body.attempt.id;
      res = await complete(attemptId);
      expect(res.body).toMatchObject({ score: null, needsRemediation: false, next: null });
      progress = await kid().get(`/api/modules/${moduleId}/progress`).set(auth(kidToken));
      expect(progress.body.tasks.map((t) => t.status)).toEqual(['done', 'done']);
      expect(progress.body.current).toBeNull();
    });

    it('after a task, goes to the next open task behind it, not the first open one', async () => {
      // Module: V3 = C (plain screen task), V1 = B, V2 = C (adaption after B).
      await resetContent();
      const { versionId } = await importBundle(
        fixtureBundle({
          'manifest.csv': 'block;format;adaption;note\nV3;C;no;\nV1;B;no;\nV2;C;yes;\n',
          'K2_W99_V3_task.csv': 'audio;image\nat_3.mp3;i_1.jpg\n',
        })
      );
      await publishVersion(versionId);
      const [[mod]] = await pool.query('SELECT id FROM modules WHERE week = 99');
      await assignModule(mod.id, { classId: klass.id });
      const [tasks] = await pool.query(
        'SELECT id FROM tasks WHERE content_version_id = ? ORDER BY position',
        [versionId]
      );
      const [first, b, adaption] = tasks.map((t) => t.id);
      const [qs] = await pool.query('SELECT id FROM trials WHERE task_id = ? ORDER BY position', [
        b,
      ]);

      // The child plays B before the first task; B needs remediation.
      const attemptId = (await start(b)).body.attempt.id;
      for (const q of qs) {
        await answer(attemptId, q.id, 'o2');
        await answer(attemptId, q.id, 'o3');
      }
      expect((await complete(attemptId)).body.next).toBe(adaption);
      // After the adaption task, back to the task still open before it.
      const adaptionAttempt = (await start(adaption)).body.attempt.id;
      expect((await complete(adaptionAttempt)).body.next).toBe(first);
    });

    it('below the threshold the adaption task is skipped', async () => {
      const attemptId = (await start(taskB)).body.attempt.id;
      await answer(attemptId, trials[0].id, 'o1');
      await answer(attemptId, trials[1].id, 'o2');
      await answer(attemptId, trials[1].id, 'o1');
      const res = await complete(attemptId);
      expect(res.body).toMatchObject({
        score: 100,
        mistakes: 1,
        needsRemediation: false,
        next: null,
      });
      const progress = await kid().get(`/api/modules/${moduleId}/progress`).set(auth(kidToken));
      expect(progress.body.tasks.map((t) => t.status)).toEqual(['done', 'skipped']);
    });

    it('the threshold comes from task_type_config', async () => {
      await pool.query("UPDATE task_type_config SET mistake_threshold = 1 WHERE format = 'B'");
      try {
        const attemptId = (await start(taskB)).body.attempt.id;
        await answer(attemptId, trials[0].id, 'o2');
        await answer(attemptId, trials[0].id, 'o1');
        await answer(attemptId, trials[1].id, 'o1');
        expect((await complete(attemptId)).body).toMatchObject({ mistakes: 1, next: taskC });
      } finally {
        await pool.query("UPDATE task_type_config SET mistake_threshold = 3 WHERE format = 'B'");
      }
    });

    it('deleting the student deletes their attempts and responses (NFR03)', async () => {
      const attemptId = (await start(taskB)).body.attempt.id;
      await answer(attemptId, trials[0].id, 'o1');
      await pool.query('DELETE FROM students WHERE id = ?', [student.id]);
      const [[{ n }]] = await pool.query(
        'SELECT (SELECT COUNT(*) FROM attempts) + (SELECT COUNT(*) FROM responses) AS n'
      );
      expect(Number(n)).toBe(0);
    });
  });
});
