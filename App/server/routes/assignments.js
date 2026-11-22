const express = require('express');
const pool = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');

// R19: a teacher assigns a published module to one of their classes or to
// one of their students. Only own classes and students (R15, NFR04).
const router = express.Router();
router.use(verifyToken, requireRole('TEACHER'));

const isId = (value) => Number.isInteger(value) && value > 0;

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.module_id, m.week, m.area, a.class_id, a.student_id, a.assigned_at,
              COALESCE(c.name, sc.name) AS class_name, s.display_name AS student_name
         FROM assignments a
         JOIN modules m ON m.id = a.module_id
         LEFT JOIN classes c ON c.id = a.class_id
         LEFT JOIN students s ON s.id = a.student_id
         LEFT JOIN classes sc ON sc.id = s.class_id
        WHERE COALESCE(c.teacher_id, sc.teacher_id) = ?
        ORDER BY a.assigned_at DESC, a.id DESC`,
      [req.user.sub]
    );
    res.json({
      assignments: rows.map((row) => ({
        id: row.id,
        moduleId: row.module_id,
        week: row.week,
        area: row.area,
        classId: row.class_id,
        studentId: row.student_id,
        className: row.class_name,
        studentName: row.student_name,
        assignedAt: row.assigned_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { moduleId, classId = null, studentId = null } = req.body || {};
    if (!isId(moduleId) || (classId === null) === (studentId === null)) {
      return res.status(400).json({ error: 'Choose a module and either a class or a student.' });
    }
    if ((classId !== null && !isId(classId)) || (studentId !== null && !isId(studentId))) {
      return res.status(400).json({ error: 'Choose a module and either a class or a student.' });
    }

    const [modules] = await pool.query(
      'SELECT id FROM modules WHERE id = ? AND published_version_id IS NOT NULL',
      [moduleId]
    );
    if (modules.length === 0) return res.status(404).json({ error: 'Module not found.' });

    const [owner] = classId
      ? await pool.query('SELECT teacher_id FROM classes WHERE id = ?', [classId])
      : await pool.query(
          `SELECT c.teacher_id FROM students s JOIN classes c ON c.id = s.class_id
            WHERE s.id = ? AND s.status = 'active'`,
          [studentId]
        );
    if (owner.length === 0) {
      return res.status(404).json({ error: classId ? 'Class not found.' : 'Student not found.' });
    }
    if (owner[0].teacher_id !== req.user.sub) {
      return res.status(403).json({ error: 'You do not own this class.' });
    }

    try {
      const [result] = await pool.query(
        'INSERT INTO assignments (module_id, class_id, student_id, assigned_by) VALUES (?, ?, ?, ?)',
        [moduleId, classId, studentId, req.user.sub]
      );
      res.status(201).json({ assignment: { id: result.insertId, moduleId, classId, studentId } });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'This module is already assigned there.' });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.id FROM assignments a
         LEFT JOIN classes c ON c.id = a.class_id
         LEFT JOIN students s ON s.id = a.student_id
         LEFT JOIN classes sc ON sc.id = s.class_id
        WHERE a.id = ? AND COALESCE(c.teacher_id, sc.teacher_id) = ?`,
      [req.params.id, req.user.sub]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Assignment not found.' });
    await pool.query('DELETE FROM assignments WHERE id = ?', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
