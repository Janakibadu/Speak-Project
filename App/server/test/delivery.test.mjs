import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
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

const auth = (token) => ({ Authorization: `Bearer ${token}` });

// R17, R18, NFR13, NFR19, TR08: content delivery and the media controller.
describe('content delivery and media', () => {
  let app, teacher, klass, student, kidToken;

  beforeEach(async () => {
    await resetDb();
    await resetContent();
    app = buildApp();
    teacher = await createTeacher();
    klass = await createClass(teacher.id);
    student = await createStudent(klass.id);
    kidToken = studentToken(student.id, klass.id);
  });

  async function importFixture({ publish = true } = {}) {
    const { versionId } = await importBundle(fixtureBundle());
    if (publish) await publishVersion(versionId);
    const [[mod]] = await pool.query('SELECT id FROM modules WHERE week = 99');
    return { versionId, moduleId: mod.id };
  }

  async function assetId(versionId, fileName) {
    const [[row]] = await pool.query(
      'SELECT media_asset_id FROM content_media WHERE content_version_id = ? AND file_name = ?',
      [versionId, fileName]
    );
    return row.media_asset_id;
  }

  describe('GET /api/modules', () => {
    it('needs a session', async () => {
      expect((await request(app).get('/api/modules')).status).toBe(401);
    });

    it('lists published modules only, for students and teachers', async () => {
      await importFixture({ publish: false });
      let res = await request(app).get('/api/modules').set(auth(kidToken));
      expect(res.status).toBe(200);
      expect(res.body.modules).toEqual([]);

      const { moduleId, versionId } = await importFixture();
      res = await request(app).get('/api/modules').set(auth(kidToken));
      expect(res.body.modules).toEqual([
        expect.objectContaining({
          id: moduleId,
          week: 99,
          area: 'vocabulary',
          versionId,
          taskCount: 2,
        }),
      ]);
      res = await request(app).get('/api/modules').set(auth(teacher.token));
      expect(res.body.modules).toHaveLength(1);
    });

    it('rejects a deactivated or deleted student', async () => {
      await pool.query("UPDATE students SET status = 'deactivated' WHERE id = ?", [student.id]);
      const res = await request(app).get('/api/modules').set(auth(kidToken));
      expect(res.status).toBe(401);
      await pool.query('DELETE FROM students WHERE id = ?', [student.id]);
      expect((await request(app).get('/api/modules').set(auth(kidToken))).status).toBe(401);
    });

    it('rejects a token whose class does not match the student', async () => {
      const other = await createClass(teacher.id, 'Klasse 1b');
      const res = await request(app)
        .get('/api/modules')
        .set(auth(studentToken(student.id, other.id)));
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/modules/:id/tasks', () => {
    it('delivers tasks, trials and the media map of the published version', async () => {
      const { moduleId, versionId } = await importFixture();
      const res = await request(app).get(`/api/modules/${moduleId}/tasks`).set(auth(kidToken));
      expect(res.status).toBe(200);
      expect(res.body.module).toEqual({ id: moduleId, week: 99, area: 'vocabulary', versionId });
      expect(res.body.tasks.map((t) => [t.position, t.format, t.isAdaption, t.scored])).toEqual([
        [1, 'B', false, true],
        [2, 'C', true, false],
      ]);

      const [task] = res.body.tasks;
      expect(task.config.explanation_audio).toBe('ai_1.mp3');
      expect(task.config).not.toHaveProperty('scored');
      expect(task.trials).toHaveLength(2);
      expect(task.trials[0]).toMatchObject({
        position: 1,
        kind: 'question',
        stimulus: { audio: 'at_1.mp3' },
        feedback: {
          correct: 'stars.mp3',
          incorrectFirst: 'at_9.mp3',
          incorrectSecond: 'at_10.mp3',
        },
      });
      expect(task.trials[0].options[0]).toEqual({ id: 'o1', image: 'i_1.jpg', correct: true });
      expect(task.trials[0].data).not.toHaveProperty('_source');

      expect(Object.keys(res.body.media)).toHaveLength(13);
      expect(res.body.media['i_1.jpg']).toEqual({
        id: await assetId(versionId, 'i_1.jpg'),
        kind: 'image',
      });
    });

    it('leaves out tasks that are not playable', async () => {
      const { moduleId, versionId } = await importFixture();
      await pool.query(
        'UPDATE tasks SET playable = 0 WHERE content_version_id = ? AND position = 2',
        [versionId]
      );
      const res = await request(app).get(`/api/modules/${moduleId}/tasks`).set(auth(kidToken));
      expect(res.body.tasks.map((t) => t.format)).toEqual(['B']);
    });

    it('returns 404 for an unknown or unpublished module', async () => {
      expect((await request(app).get('/api/modules/999999/tasks').set(auth(kidToken))).status).toBe(
        404
      );
      const { moduleId } = await importFixture({ publish: false });
      const res = await request(app).get(`/api/modules/${moduleId}/tasks`).set(auth(kidToken));
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/media/:assetId', () => {
    it('needs a session', async () => {
      const { versionId } = await importFixture();
      const id = await assetId(versionId, 'i_1.jpg');
      expect((await request(app).get(`/api/media/${id}`)).status).toBe(401);
    });

    it('serves published media with its type, caching and range support', async () => {
      const { versionId } = await importFixture();
      const id = await assetId(versionId, 'at_1.mp3');
      const res = await request(app).get(`/api/media/${id}`).set(auth(kidToken)).buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^audio\/mpeg/);
      expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.body.toString()).toBe('fake media at_1.mp3');

      const part = await request(app)
        .get(`/api/media/${id}`)
        .set({ ...auth(kidToken), Range: 'bytes=0-3' })
        .buffer(true);
      expect(part.status).toBe(206);
      expect(part.body.toString()).toBe('fake');

      const cached = await request(app)
        .get(`/api/media/${id}`)
        .set({ ...auth(kidToken), 'If-None-Match': res.headers.etag });
      expect(cached.status).toBe(304);
    });

    it('serves draft media to teachers only', async () => {
      const { versionId } = await importFixture({ publish: false });
      const id = await assetId(versionId, 'i_1.jpg');
      expect((await request(app).get(`/api/media/${id}`).set(auth(kidToken))).status).toBe(404);
      expect((await request(app).get(`/api/media/${id}`).set(auth(teacher.token))).status).toBe(
        200
      );
    });

    it('does not serve media of archived versions only', async () => {
      const { versionId } = await importFixture();
      const id = await assetId(versionId, 'i_1.jpg');
      await pool.query("UPDATE content_versions SET status = 'archived' WHERE id = ?", [versionId]);
      expect((await request(app).get(`/api/media/${id}`).set(auth(kidToken))).status).toBe(404);
    });

    it('returns 404 for unknown or malformed ids without internals', async () => {
      for (const id of ['999999', 'abc', '1;DROP']) {
        const res = await request(app).get(`/api/media/${id}`).set(auth(kidToken));
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: 'Media not found.' });
      }
    });

    it('rejects a deactivated student', async () => {
      const { versionId } = await importFixture();
      const id = await assetId(versionId, 'i_1.jpg');
      await pool.query("UPDATE students SET status = 'deactivated' WHERE id = ?", [student.id]);
      expect((await request(app).get(`/api/media/${id}`).set(auth(kidToken))).status).toBe(401);
    });
  });
});

// NFR14: unknown API paths answer with JSON 404, not 401 or HTML.
describe('unknown API paths', () => {
  beforeEach(resetDb);

  it('return a JSON 404 with or without a session', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found.' });
    const teacher = await createTeacher('other@example.org');
    const withToken = await request(app).post('/api/nope').set(auth(teacher.token));
    expect(withToken.status).toBe(404);
  });

  it('still protect the student routes mounted on /api', async () => {
    const app = buildApp();
    expect((await request(app).get('/api/classes/1/students')).status).toBe(401);
    expect((await request(app).patch('/api/students/1')).status).toBe(401);
  });
});
