import { createRequire } from 'node:module';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// The server is CommonJS. Load it through require so tests share one module
// instance (and one DB pool) with the app under test.
const require = createRequire(import.meta.url);
export const pool = require('../db.js');
export const buildApp = require('../buildApp.js');
const { hashAccessCode } = require('../utils/accessCode.js');
const { issueTeacherToken } = require('../utils/session.js');

export const PASSWORD = 'correct-horse-1';

export async function resetDb() {
  // Classes and students cascade from teachers.
  await pool.query('DELETE FROM teachers');
  await pool.query('DELETE FROM audit_log');
}

export async function resetContent() {
  // Learner data points at content (attempts → tasks, assignments → modules).
  await pool.query('DELETE FROM attempts'); // responses cascade
  await pool.query('DELETE FROM assignments');
  await pool.query('UPDATE modules SET published_version_id = NULL');
  await pool.query('DELETE FROM content_versions'); // tasks, trials, content_media cascade
  await pool.query('DELETE FROM modules');
  await pool.query('DELETE FROM media_assets');
}

export async function createTeacher(email = 'teacher@example.org') {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const [result] = await pool.query(
    'INSERT INTO teachers (full_name, email, password_hash) VALUES (?, ?, ?)',
    ['Test Teacher', email, hash]
  );
  return { id: result.insertId, email, token: teacherToken(result.insertId) };
}

export async function createClass(teacherId, name = 'Klasse 1a') {
  const [result] = await pool.query('INSERT INTO classes (teacher_id, name) VALUES (?, ?)', [
    teacherId,
    name,
  ]);
  return { id: result.insertId };
}

export async function createStudent(classId, accessCode = '123456') {
  const [result] = await pool.query(
    'INSERT INTO students (class_id, display_name, access_code_hash) VALUES (?, ?, ?)',
    [classId, 'Mia', hashAccessCode(accessCode)]
  );
  return { id: result.insertId, accessCode };
}

export function teacherToken(id) {
  return issueTeacherToken(id);
}

export function studentToken(id, classId) {
  return jwt.sign({ sub: id, classId, role: 'STUDENT' }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
}

export async function assignModule(moduleId, { classId = null, studentId = null }) {
  await pool.query('INSERT INTO assignments (module_id, class_id, student_id) VALUES (?, ?, ?)', [
    moduleId,
    classId,
    studentId,
  ]);
}
