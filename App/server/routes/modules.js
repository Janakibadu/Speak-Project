const express = require('express');
const pool = require('../db');
const { verifyToken, requireRole, requireActiveStudent } = require('../middleware/auth');
const { json } = require('../importer/importService');
const { ASSIGNED_SQL, isAssigned, moduleProgress } = require('../utils/progress');

// Content delivery (R17, R18, NFR19). Content is global, so teachers see
// every published module; students only those assigned to them or their
// class (R19). Only published versions and playable tasks are delivered.
const router = express.Router();
router.use(verifyToken, requireRole('TEACHER', 'STUDENT'), requireActiveStudent);

const isStudent = (req) => req.user.role === 'STUDENT';

// The path tasks a student has completed, out of all path tasks; adaption
// tasks are extra practice and don't count (R35).
function pathCount(progress) {
  const path = progress.tasks.filter((task) => !task.isAdaption);
  return { done: path.filter((task) => task.status === 'done').length, total: path.length };
}

router.get('/', async (req, res, next) => {
  try {
    const student = isStudent(req);
    const [rows] = await pool.query(
      `SELECT m.id, m.week, m.area, v.id AS version_id, v.published_at,
              (SELECT COUNT(*) FROM tasks t WHERE t.content_version_id = v.id AND t.playable = 1)
                AS task_count
         FROM modules m
         JOIN content_versions v ON v.id = m.published_version_id
        ${student ? `WHERE ${ASSIGNED_SQL}` : ''}
        ORDER BY m.week, m.area`,
      student ? [req.user.classId, req.user.sub] : []
    );
    const modules = [];
    for (const row of rows) {
      const module = {
        id: row.id,
        week: row.week,
        area: row.area,
        versionId: row.version_id,
        publishedAt: row.published_at,
        taskCount: Number(row.task_count),
      };
      if (student) module.progress = pathCount(await moduleProgress(pool, req.user.sub, row.id));
      modules.push(module);
    }
    res.json({ modules });
  } catch (err) {
    next(err);
  }
});

// R35: the student's place in the module, for the task path and resume.
router.get('/:id/progress', requireRole('STUDENT'), async (req, res, next) => {
  try {
    if (!(await isAssigned(pool, req.user, req.params.id))) {
      return res.status(404).json({ error: 'Module not found.' });
    }
    const progress = await moduleProgress(pool, req.user.sub, req.params.id);
    res.json({ ...progress, ...pathCount(progress) });
  } catch (err) {
    next(err);
  }
});

// The published version's playable tasks with their trials, plus `media`:
// file name → asset for this version. Trials keep file names; the client
// resolves them through `media` and loads each from GET /api/media/:id.
// Options carry `correct` so the child gets feedback without a round trip;
// the server re-scores every response it records (R32, R34; D-20).
router.get('/:id/tasks', async (req, res, next) => {
  try {
    const [modules] = await pool.query(
      `SELECT m.id, m.week, m.area, m.published_version_id AS version_id
         FROM modules m WHERE m.id = ? AND m.published_version_id IS NOT NULL`,
      [req.params.id]
    );
    if (modules.length === 0) return res.status(404).json({ error: 'Module not found.' });
    if (isStudent(req) && !(await isAssigned(pool, req.user, req.params.id))) {
      return res.status(404).json({ error: 'Module not found.' });
    }
    const module = modules[0];

    const [tasks] = await pool.query(
      `SELECT t.id, t.position, t.block_code, t.format, t.is_adaption, t.config,
              c.attempts_per_trial
         FROM tasks t LEFT JOIN task_type_config c ON c.format = t.format
        WHERE t.content_version_id = ? AND t.playable = 1 ORDER BY t.position`,
      [module.version_id]
    );
    const [trials] = await pool.query(
      `SELECT tr.task_id, tr.id, tr.position, tr.kind, tr.stimulus, tr.options, tr.feedback, tr.data
         FROM trials tr JOIN tasks t ON t.id = tr.task_id
        WHERE t.content_version_id = ? AND t.playable = 1
        ORDER BY tr.task_id, tr.position`,
      [module.version_id]
    );
    const [media] = await pool.query(
      `SELECT cm.file_name, ma.id, ma.kind
         FROM content_media cm JOIN media_assets ma ON ma.id = cm.media_asset_id
        WHERE cm.content_version_id = ?`,
      [module.version_id]
    );

    const trialsByTask = new Map(tasks.map((task) => [task.id, []]));
    for (const trial of trials) {
      const data = json(trial.data);
      delete data._source;
      trialsByTask.get(trial.task_id).push({
        id: trial.id,
        position: trial.position,
        kind: trial.kind,
        stimulus: json(trial.stimulus),
        options: json(trial.options),
        feedback: json(trial.feedback),
        data,
      });
    }

    res.json({
      module: { id: module.id, week: module.week, area: module.area, versionId: module.version_id },
      tasks: tasks.map((task) => {
        const { scored, ...config } = json(task.config);
        return {
          id: task.id,
          position: task.position,
          blockCode: task.block_code,
          format: task.format,
          isAdaption: Boolean(task.is_adaption),
          scored: Boolean(scored),
          // R31: tries per question before the answer is shown.
          attemptsPerTrial: task.attempts_per_trial ?? 2,
          config,
          trials: trialsByTask.get(task.id),
        };
      }),
      media: Object.fromEntries(media.map((m) => [m.file_name, { id: m.id, kind: m.kind }])),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
