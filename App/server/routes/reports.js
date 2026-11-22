const express = require('express');
const pool = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');
const { json } = require('../importer/importService');
const {
  averageCompletion,
  completionPairs,
  percent,
  responseRows,
  taskResults,
  toCsv,
} = require('../utils/reports');

// The teacher's view of their classes' progress (R36, R37, R40, R41, R45,
// R48, Design §7.5). Only the teacher's own classes and students (NFR04).
const router = express.Router();
router.use(['/progress', '/results'], verifyToken, requireRole('TEACHER'));

const AREAS = ['vocabulary', 'grammar'];
const id = (value) => (/^[1-9][0-9]*$/.test(value) ? Number(value) : NaN);

// ?week=&area=&classId=&studentId= (R41). Returns null on a bad value.
function readFilters(query) {
  const filters = {};
  for (const key of ['week', 'classId', 'studentId']) {
    if (query[key] === undefined || query[key] === '') continue;
    filters[key] = id(query[key]);
    if (Number.isNaN(filters[key])) return null;
  }
  if (query.area !== undefined && query.area !== '') {
    if (!AREAS.includes(query.area)) return null;
    filters.area = query.area;
  }
  return filters;
}

// R36, R40: counts, completion per class and per module, recent activity.
router.get('/progress', async (req, res, next) => {
  try {
    const teacherId = req.user.sub;
    const [classes] = await pool.query(
      `SELECT c.id, c.name,
              (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = 'active')
                AS students
         FROM classes c WHERE c.teacher_id = ? ORDER BY c.created_at, c.id`,
      [teacherId]
    );
    const pairs = await completionPairs(pool, teacherId);
    const [recent] = await pool.query(
      `SELECT a.id, a.status, a.score, a.needs_remediation,
              COALESCE(a.completed_at, a.started_at) AS at,
              s.display_name, c.name AS class_name, m.week, m.area, t.format, t.is_adaption
         FROM attempts a
         JOIN students s ON s.id = a.student_id
         JOIN classes c ON c.id = s.class_id
         JOIN tasks t ON t.id = a.task_id
         JOIN content_versions v ON v.id = t.content_version_id
         JOIN modules m ON m.id = v.module_id
        WHERE c.teacher_id = ? AND a.status <> 'reset'
        ORDER BY at DESC, a.id DESC LIMIT 8`,
      [teacherId]
    );

    const modules = new Map();
    for (const pair of pairs) {
      if (!modules.has(pair.moduleId)) {
        modules.set(pair.moduleId, { moduleId: pair.moduleId, week: pair.week, area: pair.area });
      }
    }
    const of = (list, test) => list.filter(test);

    res.json({
      stats: {
        classes: classes.length,
        students: classes.reduce((sum, c) => sum + Number(c.students), 0),
        assignedModules: modules.size,
        avgCompletion: averageCompletion(pairs),
      },
      classes: classes.map((c) => {
        const own = of(pairs, (p) => p.classId === c.id);
        return {
          id: c.id,
          name: c.name,
          students: Number(c.students),
          completion: own.length ? averageCompletion(own) : null,
          modules: [...modules.values()]
            .map((m) => {
              const cell = of(own, (p) => p.moduleId === m.moduleId);
              return cell.length
                ? { moduleId: m.moduleId, completion: averageCompletion(cell) }
                : null;
            })
            .filter(Boolean),
        };
      }),
      modules: [...modules.values()].map((m) => ({
        ...m,
        completion: averageCompletion(of(pairs, (p) => p.moduleId === m.moduleId)),
      })),
      recent: recent.map((row) => ({
        attemptId: row.id,
        studentName: row.display_name,
        className: row.class_name,
        week: row.week,
        area: row.area,
        format: row.format,
        isAdaption: Boolean(row.is_adaption),
        status: row.status,
        score: row.score,
        needsRemediation: Boolean(row.needs_remediation),
        at: row.at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// R37, R41, R45: one row per started task (latest attempt), and the module
// completion of every assigned student, both filtered.
router.get('/results', async (req, res, next) => {
  try {
    const filters = readFilters(req.query);
    if (!filters) return res.status(400).json({ error: 'Invalid filter.' });
    const [rows, pairs] = await Promise.all([
      taskResults(pool, req.user.sub, filters),
      completionPairs(pool, req.user.sub, filters),
    ]);
    res.json({
      rows,
      summary: pairs.map((p) => ({ ...p, completion: percent(p.done, p.total) })),
    });
  } catch (err) {
    next(err);
  }
});

// R45, R48: the filtered results as CSV. level=tasks (default): one line per
// started task; level=responses: one line per recorded answer.
router.get('/results/export.csv', async (req, res, next) => {
  try {
    const filters = readFilters(req.query);
    if (!filters) return res.status(400).json({ error: 'Invalid filter.' });
    const level = req.query.level === 'responses' ? 'responses' : 'tasks';
    const iso = (date) => (date ? new Date(date).toISOString() : '');

    let csv;
    if (level === 'responses') {
      const rows = await responseRows(pool, req.user.sub, filters);
      csv = toCsv(
        [
          'class',
          'student',
          'week',
          'area',
          'block',
          'format',
          'trial',
          'option',
          'correct',
          'try',
          'answered_at',
          'attempt',
          'attempt_status',
        ],
        rows.map((r) => [
          r.class_name,
          r.display_name,
          r.week,
          r.area,
          r.block_code,
          r.format,
          r.trial,
          r.option_id,
          r.is_correct ? 1 : 0,
          r.attempt_number,
          iso(r.answered_at),
          r.attempt_id,
          r.status,
        ])
      );
    } else {
      const rows = await taskResults(pool, req.user.sub, filters);
      csv = toCsv(
        [
          'class',
          'student',
          'week',
          'area',
          'block',
          'format',
          'adaption',
          'status',
          'score_percent',
          'first_try_percent',
          'mistakes',
          'needs_remediation',
          'attempts',
          'completed_at',
        ],
        rows.map((r) => [
          r.className,
          r.studentName,
          r.week,
          r.area,
          r.blockCode,
          r.format,
          r.isAdaption ? 1 : 0,
          r.status,
          r.score,
          r.firstTryScore,
          r.mistakes,
          r.needsRemediation ? 1 : 0,
          r.attempts,
          iso(r.completedAt),
        ])
      );
    }
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="speak-${level}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// R37: one task of one student, question by question, with every tap.
router.get('/results/attempts/:id', async (req, res, next) => {
  try {
    const [attempts] = await pool.query(
      `SELECT a.id, a.task_id, a.status, a.score, a.first_try_score, a.mistakes,
              a.needs_remediation, a.started_at, a.completed_at,
              s.display_name, c.name AS class_name, m.week, m.area,
              t.format, t.block_code, t.is_adaption, t.content_version_id
         FROM attempts a
         JOIN students s ON s.id = a.student_id
         JOIN classes c ON c.id = s.class_id
         JOIN tasks t ON t.id = a.task_id
         JOIN content_versions v ON v.id = t.content_version_id
         JOIN modules m ON m.id = v.module_id
        WHERE a.id = ? AND c.teacher_id = ?`,
      [req.params.id, req.user.sub]
    );
    if (attempts.length === 0) return res.status(404).json({ error: 'Result not found.' });
    const attempt = attempts[0];

    const [trials] = await pool.query(
      `SELECT id, position, options FROM trials
        WHERE task_id = ? AND kind = 'question' ORDER BY position`,
      [attempt.task_id]
    );
    const [taps] = await pool.query(
      `SELECT trial_id, option_id, is_correct, attempt_number, answered_at
         FROM responses WHERE attempt_id = ? ORDER BY id`,
      [attempt.id]
    );
    const [media] = await pool.query(
      `SELECT cm.file_name, cm.media_asset_id FROM content_media cm
        WHERE cm.content_version_id = ?`,
      [attempt.content_version_id]
    );
    const mediaId = new Map(media.map((m) => [m.file_name, m.media_asset_id]));

    res.json({
      attempt: {
        id: attempt.id,
        status: attempt.status,
        score: attempt.score,
        firstTryScore: attempt.first_try_score,
        mistakes: attempt.mistakes,
        needsRemediation: Boolean(attempt.needs_remediation),
        startedAt: attempt.started_at,
        completedAt: attempt.completed_at,
        studentName: attempt.display_name,
        className: attempt.class_name,
        week: attempt.week,
        area: attempt.area,
        format: attempt.format,
        blockCode: attempt.block_code,
        isAdaption: Boolean(attempt.is_adaption),
      },
      trials: trials.map((trial) => ({
        id: trial.id,
        position: trial.position,
        // Pictures by media id, so the page can show them via /api/media.
        options: json(trial.options).map((option) => ({
          id: option.id,
          text: option.text || null,
          imageId: (option.image && mediaId.get(option.image)) || null,
          correct: Boolean(option.correct),
        })),
        responses: taps
          .filter((tap) => tap.trial_id === trial.id)
          .map((tap) => ({
            optionId: tap.option_id,
            correct: Boolean(tap.is_correct),
            attemptNumber: tap.attempt_number,
            answeredAt: tap.answered_at,
          })),
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
