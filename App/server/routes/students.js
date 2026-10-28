const express = require('express');
const pool = require('../db');
const { verifyToken, requireRole, requireOwnership } = require('../middleware/auth');
const { generateUniqueAccessCode } = require('../utils/accessCode');
const { audit } = require('../utils/audit');
const { codeToQrSvg } = require('../utils/qr');

const router = express.Router();

// Mounted on /api, so scope the guards to this router's own paths: other
// /api requests must fall through to their routers or the JSON 404.
router.use(['/classes/:classId/students', '/students'], verifyToken, requireRole('TEACHER'));

const STATUSES = ['active', 'deactivated'];

// Access codes are stored only as a hash, so `accessCode` and `qrSvg` are
// included only in the response that generated them (Design §6.2).
async function publicStudent(row, accessCode) {
  const student = {
    id: row.id,
    displayName: row.display_name,
    hasCode: Boolean(row.access_code_hash),
    status: row.status,
    lastActiveAt: row.last_active_at,
  };
  if (accessCode) {
    student.accessCode = accessCode;
    student.qrSvg = await codeToQrSvg(accessCode);
  }
  return student;
}

async function inTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

router.get('/classes/:classId/students', requireOwnership, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM students WHERE class_id = ? ORDER BY created_at ASC, id ASC',
      [req.classId]
    );
    res.json({ students: await Promise.all(rows.map((row) => publicStudent(row))) });
  } catch (err) {
    next(err);
  }
});

router.post('/classes/:classId/students', requireOwnership, async (req, res, next) => {
  try {
    const { displayName } = req.body || {};
    if (typeof displayName !== 'string' || !displayName.trim()) {
      return res.status(400).json({ error: 'Student name is required.' });
    }

    const { code, hash } = await generateUniqueAccessCode();
    const studentId = await inTransaction(async (db) => {
      const [result] = await db.query(
        'INSERT INTO students (class_id, display_name, access_code_hash) VALUES (?, ?, ?)',
        [req.classId, displayName.trim(), hash]
      );
      await audit(db, {
        actorTeacherId: req.user.sub,
        action: 'student.created',
        targetType: 'student',
        targetId: result.insertId,
      });
      return result.insertId;
    });

    const [rows] = await pool.query('SELECT * FROM students WHERE id = ?', [studentId]);
    res.status(201).json({ student: await publicStudent(rows[0], code) });
  } catch (err) {
    next(err);
  }
});

// R05: rename, deactivate or reactivate.
router.patch('/students/:id', requireOwnership, async (req, res, next) => {
  try {
    const { displayName, status } = req.body || {};
    const updates = [];
    const values = [];

    if (displayName !== undefined) {
      if (typeof displayName !== 'string' || !displayName.trim()) {
        return res.status(400).json({ error: 'Student name is required.' });
      }
      updates.push('display_name = ?');
      values.push(displayName.trim());
    }
    if (status !== undefined) {
      if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status.' });
      updates.push('status = ?');
      values.push(status);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

    await pool.query(`UPDATE students SET ${updates.join(', ')} WHERE id = ?`, [
      ...values,
      req.params.id,
    ]);
    const [rows] = await pool.query('SELECT * FROM students WHERE id = ?', [req.params.id]);
    res.json({ student: await publicStudent(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// NFR03: permanent deletion. Learner data (attempts, responses) cascades from
// the student row, so one transaction removes everything plus writes the audit row.
router.delete('/students/:id', requireOwnership, async (req, res, next) => {
  try {
    await inTransaction(async (db) => {
      await db.query('DELETE FROM students WHERE id = ?', [req.params.id]);
      await audit(db, {
        actorTeacherId: req.user.sub,
        action: 'student.deleted',
        targetType: 'student',
        targetId: Number(req.params.id),
      });
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post('/students/:id/regenerate-code', requireOwnership, async (req, res, next) => {
  try {
    const { code, hash } = await generateUniqueAccessCode();
    await pool.query('UPDATE students SET access_code_hash = ? WHERE id = ?', [
      hash,
      req.params.id,
    ]);

    const [rows] = await pool.query('SELECT * FROM students WHERE id = ?', [req.params.id]);
    res.json({ student: await publicStudent(rows[0], code) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
