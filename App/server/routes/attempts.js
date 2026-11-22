const express = require('express');
const pool = require('../db');
const { verifyToken, requireRole, requireActiveStudent } = require('../middleware/auth');
const { json } = require('../importer/importService');
const { ASSIGNED_SQL, moduleProgress } = require('../utils/progress');
const { correctIds, scoreTask, trialState } = require('../utils/trialRules');

// A student working through a task (R33–R35, NFR20, Design §5.3–5.4).
// Every tap is written as it happens, so an interrupted session loses
// nothing; the server judges each tap again and alone sets the score.
const router = express.Router();

// Mounted on /api: guard only this router's own paths.
router.use(['/attempts', '/responses'], verifyToken, requireRole('STUDENT'), requireActiveStudent);

const isId = (value) => Number.isInteger(value) && value > 0;

// The student's own attempt, with what the rules need about its task.
async function ownAttempt(attemptId, studentId) {
  const [rows] = await pool.query(
    `SELECT a.id, a.status, a.task_id, a.score, a.first_try_score, a.mistakes,
            a.needs_remediation, t.config, v.module_id,
            COALESCE(c.attempts_per_trial, 2) AS max_attempts,
            COALESCE(c.mistake_threshold, 3) AS threshold
       FROM attempts a
       JOIN tasks t ON t.id = a.task_id
       JOIN content_versions v ON v.id = t.content_version_id
       LEFT JOIN task_type_config c ON c.format = t.format
      WHERE a.id = ? AND a.student_id = ?`,
    [attemptId, studentId]
  );
  return rows[0] || null;
}

async function tapsOf(attemptId) {
  const [rows] = await pool.query(
    'SELECT trial_id, option_id FROM responses WHERE attempt_id = ? ORDER BY id',
    [attemptId]
  );
  return rows.map((row) => ({ trialId: row.trial_id, optionId: row.option_id }));
}

function byTrial(taps) {
  const map = new Map();
  for (const tap of taps) map.set(tap.trialId, [...(map.get(tap.trialId) || []), tap]);
  return map;
}

// R35: start a task, or pick up the unfinished attempt at it with the taps
// recorded so far, so the player can continue where the child stopped.
router.post('/attempts', async (req, res, next) => {
  try {
    const { taskId } = req.body || {};
    if (!isId(taskId)) return res.status(400).json({ error: 'A task is required.' });

    const [tasks] = await pool.query(
      `SELECT t.id FROM tasks t
         JOIN modules m ON m.published_version_id = t.content_version_id
        WHERE t.id = ? AND t.playable = 1 AND ${ASSIGNED_SQL}`,
      [taskId, req.user.classId, req.user.sub]
    );
    if (tasks.length === 0) return res.status(404).json({ error: 'Task not found.' });

    const [open] = await pool.query(
      `SELECT id FROM attempts
        WHERE student_id = ? AND task_id = ? AND status = 'in_progress'
        ORDER BY id DESC LIMIT 1`,
      [req.user.sub, taskId]
    );
    if (open.length > 0) {
      return res.json({ attempt: { id: open[0].id, taskId }, responses: await tapsOf(open[0].id) });
    }
    const [result] = await pool.query('INSERT INTO attempts (student_id, task_id) VALUES (?, ?)', [
      req.user.sub,
      taskId,
    ]);
    res.status(201).json({ attempt: { id: result.insertId, taskId }, responses: [] });
  } catch (err) {
    next(err);
  }
});

// R33: one tap on an answer option. The server decides whether it is
// correct and which try it is; a repeated POST of the same tap is answered
// with the stored result.
router.post('/responses', async (req, res, next) => {
  try {
    const { attemptId, trialId, optionId } = req.body || {};
    if (!isId(attemptId) || !isId(trialId) || typeof optionId !== 'string') {
      return res.status(400).json({ error: 'Attempt, trial and option are required.' });
    }
    const attempt = await ownAttempt(attemptId, req.user.sub);
    if (!attempt) return res.status(404).json({ error: 'Attempt not found.' });
    if (attempt.status !== 'in_progress') {
      return res.status(409).json({ error: 'This task is already finished.' });
    }

    const [trials] = await pool.query(
      "SELECT id, options, correct_option FROM trials WHERE id = ? AND task_id = ? AND kind = 'question'",
      [trialId, attempt.task_id]
    );
    if (trials.length === 0) return res.status(404).json({ error: 'Question not found.' });
    const trial = trials[0];
    if (!json(trial.options).some((option) => option.id === optionId)) {
      return res.status(400).json({ error: 'Unknown answer option.' });
    }

    const [existing] = await pool.query(
      'SELECT is_correct, attempt_number FROM responses WHERE attempt_id = ? AND trial_id = ? AND option_id = ?',
      [attemptId, trialId, optionId]
    );
    if (existing.length > 0) {
      return res.json({
        correct: Boolean(existing[0].is_correct),
        attemptNumber: existing[0].attempt_number,
      });
    }

    const taps = (await tapsOf(attemptId)).filter((tap) => tap.trialId === trialId);
    const state = trialState(trial, taps, attempt.max_attempts);
    if (state.finished) {
      return res.status(409).json({ error: 'This question is already answered.' });
    }
    const correct = correctIds(trial).includes(optionId);
    const attemptNumber = state.wrongTaps + 1;
    await pool.query(
      `INSERT INTO responses (attempt_id, trial_id, option_id, is_correct, attempt_number)
       VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`,
      [attemptId, trialId, optionId, correct, attemptNumber]
    );
    await pool.query('UPDATE students SET last_active_at = NOW() WHERE id = ?', [req.user.sub]);
    res.status(201).json({ correct, attemptNumber });
  } catch (err) {
    next(err);
  }
});

// Where the child goes after this task: the first open task after it (so
// the adaption task right behind it, when due), else the earliest open one.
function nextAfter(progress, taskId) {
  const done = progress.tasks.find((task) => task.id === taskId);
  const open = (task) => task.status === 'todo' || task.status === 'pending';
  const after = done && progress.tasks.find((task) => task.position > done.position && open(task));
  return after ? after.id : progress.current;
}

function result(attempt, next) {
  return {
    score: attempt.score,
    firstTryScore: attempt.first_try_score,
    mistakes: attempt.mistakes,
    needsRemediation: Boolean(attempt.needs_remediation),
    next,
  };
}

// R34, R32: finish a task once every question is answered. The server
// scores it from the recorded taps, decides whether the adaption task after
// it is needed, and returns the task the child should play next (null when
// the module is done).
router.patch('/attempts/:id/complete', async (req, res, next) => {
  try {
    const attempt = await ownAttempt(req.params.id, req.user.sub);
    if (!attempt) return res.status(404).json({ error: 'Attempt not found.' });
    if (attempt.status === 'reset') {
      return res.status(409).json({ error: 'This task was reset by the teacher.' });
    }
    if (attempt.status === 'completed') {
      const progress = await moduleProgress(pool, req.user.sub, attempt.module_id);
      return res.json(result(attempt, nextAfter(progress, attempt.task_id)));
    }

    const [questions] = await pool.query(
      "SELECT id, correct_option FROM trials WHERE task_id = ? AND kind = 'question'",
      [attempt.task_id]
    );
    const taps = byTrial(await tapsOf(attempt.id));
    const open = questions.filter(
      (trial) => !trialState(trial, taps.get(trial.id) || [], attempt.max_attempts).finished
    );
    if (open.length > 0) {
      return res.status(409).json({ error: 'Some questions are not answered yet.' });
    }

    const scores = scoreTask(questions, taps, attempt.max_attempts);
    const needsRemediation =
      Boolean(json(attempt.config).scored) && scores.mistakes >= attempt.threshold;
    await pool.query(
      `UPDATE attempts
          SET status = 'completed', score = ?, first_try_score = ?, mistakes = ?,
              needs_remediation = ?, completed_at = NOW()
        WHERE id = ? AND status = 'in_progress'`,
      [scores.score, scores.firstTryScore, scores.mistakes, needsRemediation, attempt.id]
    );
    await pool.query('UPDATE students SET last_active_at = NOW() WHERE id = ?', [req.user.sub]);

    const progress = await moduleProgress(pool, req.user.sub, attempt.module_id);
    res.json(
      result(
        {
          score: scores.score,
          first_try_score: scores.firstTryScore,
          mistakes: scores.mistakes,
          needs_remediation: needsRemediation,
        },
        nextAfter(progress, attempt.task_id)
      )
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
