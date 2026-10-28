import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { fixtureZip } from './fixtures.mjs';

const require = createRequire(import.meta.url);
const { fromDirectory } = require('../importer/bundle.js');
const { importBundle, publishVersion, json } = require('../importer/importService.js');
const { filePath } = require('../importer/mediaStore.js');

// R09, R42, TR07, NFR22: import, versioning, publishing.
describe('content import API', () => {
  let app, teacher;

  beforeEach(async () => {
    await resetDb();
    await resetContent();
    app = buildApp();
    teacher = await createTeacher();
  });

  const auth = (token = teacher.token) => ({ Authorization: `Bearer ${token}` });
  const upload = (buffer, token) =>
    request(app)
      .post('/api/content/import')
      .set(auth(token))
      .attach('bundle', buffer, 'week99.zip');

  it('rejects requests without a teacher session', async () => {
    expect((await request(app).get('/api/content/versions')).status).toBe(401);
    const klass = await createClass(teacher.id);
    const student = await createStudent(klass.id);
    const res = await upload(fixtureZip(), studentToken(student.id, klass.id));
    expect(res.status).toBe(403);
  });

  it('imports a valid zip as a draft, stores media outside public/, then publishes it', async () => {
    const res = await upload(fixtureZip());
    expect(res.status).toBe(201);
    expect(res.body.report.errors).toEqual([]);
    const { versionId } = res.body;

    const [[version]] = await pool.query('SELECT status FROM content_versions WHERE id = ?', [
      versionId,
    ]);
    expect(version.status).toBe('draft');

    const [tasks] = await pool.query(
      'SELECT format, is_adaption, position FROM tasks WHERE content_version_id = ? ORDER BY position',
      [versionId]
    );
    expect(tasks).toEqual([
      { format: 'B', is_adaption: 0, position: 1 },
      { format: 'C', is_adaption: 1, position: 2 },
    ]);
    const [[trial]] = await pool.query(
      `SELECT tr.options, tr.correct_option FROM trials tr JOIN tasks t ON t.id = tr.task_id
        WHERE t.content_version_id = ? AND t.position = 1 AND tr.position = 1`,
      [versionId]
    );
    expect(trial.correct_option).toBe('o1');
    expect(json(trial.options)).toHaveLength(4);

    const [media] = await pool.query(
      `SELECT cm.file_name, ma.storage_key FROM content_media cm
         JOIN media_assets ma ON ma.id = cm.media_asset_id WHERE cm.content_version_id = ?`,
      [versionId]
    );
    expect(media.length).toBe(13);
    for (const m of media) {
      expect(fs.existsSync(filePath(m.storage_key))).toBe(true);
      expect(filePath(m.storage_key)).not.toMatch(/[\\/]public[\\/]/);
    }

    const pub = await request(app).post(`/api/content/${versionId}/publish`).set(auth());
    expect(pub.status).toBe(200);
    const [[mod]] = await pool.query('SELECT published_version_id FROM modules WHERE week = 99');
    expect(mod.published_version_id).toBe(versionId);

    const again = await request(app).post(`/api/content/${versionId}/publish`).set(auth());
    expect(again.status).toBe(409);
  });

  it('a new version archives the old one and reuses identical media', async () => {
    const first = (await upload(fixtureZip())).body.versionId;
    await request(app).post(`/api/content/${first}/publish`).set(auth());
    const second = (await upload(fixtureZip())).body.versionId;
    await request(app).post(`/api/content/${second}/publish`).set(auth());

    const [rows] = await pool.query('SELECT id, status FROM content_versions ORDER BY id');
    expect(rows).toEqual([
      { id: first, status: 'archived' },
      { id: second, status: 'published' },
    ]);
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM media_assets');
    expect(n).toBe(13);

    const list = await request(app).get('/api/content/versions').set(auth());
    expect(list.body.versions.map((v) => v.status)).toEqual(['published', 'archived']);
    expect(list.body.versions[0]).toMatchObject({ week: 99, area: 'vocabulary' });
  });

  it('rejects a bundle with errors and writes nothing', async () => {
    const res = await upload(fixtureZip({ 'Stimuli/i_4.jpg': null }));
    expect(res.status).toBe(422);
    expect(res.body.report.errors.map((e) => e.code)).toEqual(['MISSING_MEDIA']);
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM content_versions');
    expect(n).toBe(0);
  });

  it('rejects a file that is not a zip', async () => {
    const res = await upload(Buffer.from('not a zip'));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'The file is not a valid .zip archive.' });
  });

  it('returns 404 when publishing an unknown version', async () => {
    const res = await request(app).post('/api/content/999999/publish').set(auth());
    expect(res.status).toBe(404);
  });
});

const CONTENT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'Speak Programming'
);

describe.skipIf(!fs.existsSync(CONTENT))('real content import', () => {
  it('imports and publishes Vocabulary week 12 completely', async () => {
    await resetContent();
    const result = await importBundle(fromDirectory(path.join(CONTENT, 'Vocabulary week 12')));
    expect(result.status).toBe('draft');
    expect(result.report.corrections).toHaveLength(1);
    await publishVersion(result.versionId);

    const [[counts]] = await pool.query(
      `SELECT COUNT(DISTINCT t.id) AS tasks, COUNT(tr.id) AS trials
         FROM tasks t JOIN trials tr ON tr.task_id = t.id WHERE t.content_version_id = ?`,
      [result.versionId]
    );
    expect(counts).toEqual({ tasks: 9, trials: 75 });
    const [adaptions] = await pool.query(
      'SELECT block_code FROM tasks WHERE content_version_id = ? AND is_adaption = 1 ORDER BY position',
      [result.versionId]
    );
    expect(adaptions.map((r) => r.block_code)).toEqual(['W12_V3', 'W12_V5', 'W12_V7', 'W12_V9']);
  });
});
