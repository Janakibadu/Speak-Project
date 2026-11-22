// Aggregations for the teacher's dashboard and results (R36, R37, R40, R41,
// R45, R48). Every query is limited to the teacher's own classes (NFR04).
// Completion counts the path tasks (not the adaption tasks) of a module's
// published version that a student has completed, matched by block code as
// in utils/progress.js; reset attempts (R43) are left out.

// Optional filters, applied in SQL. `alias` maps each filter to its column.
function filterSql(filters, alias) {
  const clauses = [];
  const params = [];
  for (const [key, column] of Object.entries(alias)) {
    if (filters[key] !== undefined && filters[key] !== null) {
      clauses.push(`${column} = ?`);
      params.push(filters[key]);
    }
  }
  return { sql: clauses.map((c) => ` AND ${c}`).join(''), params };
}

// Every (active student, assigned published module) pair of the teacher,
// with the student's completed path tasks out of the module's path tasks.
async function completionPairs(db, teacherId, filters = {}) {
  const where = filterSql(filters, {
    classId: 'c.id',
    studentId: 's.id',
    week: 'm.week',
    area: 'm.area',
  });
  const [pairs] = await db.query(
    `SELECT DISTINCT s.id AS student_id, s.display_name, c.id AS class_id, c.name AS class_name,
            m.id AS module_id, m.week, m.area
       FROM students s
       JOIN classes c ON c.id = s.class_id
       JOIN assignments a ON a.class_id = c.id OR a.student_id = s.id
       JOIN modules m ON m.id = a.module_id AND m.published_version_id IS NOT NULL
      WHERE c.teacher_id = ? AND s.status = 'active'${where.sql}
      ORDER BY c.name, s.display_name, m.week, m.area`,
    [teacherId, ...where.params]
  );
  const [paths] = await db.query(
    `SELECT m.id AS module_id, t.block_code
       FROM modules m JOIN tasks t ON t.content_version_id = m.published_version_id
      WHERE t.playable = 1 AND t.is_adaption = 0`
  );
  const [done] = await db.query(
    `SELECT DISTINCT a.student_id, v.module_id, t.block_code
       FROM attempts a
       JOIN tasks t ON t.id = a.task_id
       JOIN content_versions v ON v.id = t.content_version_id
       JOIN students s ON s.id = a.student_id
       JOIN classes c ON c.id = s.class_id
      WHERE c.teacher_id = ? AND a.status = 'completed'`,
    [teacherId]
  );

  const pathOf = new Map();
  for (const row of paths) {
    if (!pathOf.has(row.module_id)) pathOf.set(row.module_id, new Set());
    pathOf.get(row.module_id).add(row.block_code);
  }
  const doneOf = new Set(done.map((row) => `${row.student_id}:${row.module_id}:${row.block_code}`));

  return pairs.map((pair) => {
    const path = [...(pathOf.get(pair.module_id) || [])];
    const doneCount = path.filter((block) =>
      doneOf.has(`${pair.student_id}:${pair.module_id}:${block}`)
    ).length;
    return {
      studentId: pair.student_id,
      studentName: pair.display_name,
      classId: pair.class_id,
      className: pair.class_name,
      moduleId: pair.module_id,
      week: pair.week,
      area: pair.area,
      done: doneCount,
      total: path.length,
    };
  });
}

const percent = (done, total) => (total ? Math.round((100 * done) / total) : 0);

// Average completion of a list of pairs, in percent (each pair weighs the same).
function averageCompletion(pairs) {
  if (pairs.length === 0) return 0;
  return Math.round(pairs.reduce((sum, p) => sum + percent(p.done, p.total), 0) / pairs.length);
}

// One row per (student, task) the student has started: their latest attempt
// that was not reset, plus how many attempts they made (R37, R41).
async function taskResults(db, teacherId, filters = {}) {
  const where = filterSql(filters, {
    classId: 'c.id',
    studentId: 's.id',
    week: 'm.week',
    area: 'm.area',
  });
  const [rows] = await db.query(
    `SELECT a.id AS attempt_id, a.status, a.score, a.first_try_score, a.mistakes,
            a.needs_remediation, a.started_at, a.completed_at,
            s.id AS student_id, s.display_name, c.id AS class_id, c.name AS class_name,
            m.id AS module_id, m.week, m.area,
            t.block_code, t.format, t.position, t.is_adaption,
            (SELECT COUNT(*) FROM attempts a2
               JOIN tasks t2 ON t2.id = a2.task_id
               JOIN content_versions v2 ON v2.id = t2.content_version_id
              WHERE a2.student_id = a.student_id AND v2.module_id = m.id
                AND t2.block_code = t.block_code AND a2.status <> 'reset') AS attempt_count
       FROM attempts a
       JOIN tasks t ON t.id = a.task_id
       JOIN content_versions v ON v.id = t.content_version_id
       JOIN modules m ON m.id = v.module_id
       JOIN students s ON s.id = a.student_id
       JOIN classes c ON c.id = s.class_id
      WHERE c.teacher_id = ? AND a.status <> 'reset'${where.sql}
        AND a.id = (SELECT MAX(a3.id) FROM attempts a3
                      JOIN tasks t3 ON t3.id = a3.task_id
                      JOIN content_versions v3 ON v3.id = t3.content_version_id
                     WHERE a3.student_id = a.student_id AND v3.module_id = m.id
                       AND t3.block_code = t.block_code AND a3.status <> 'reset')
      ORDER BY c.name, s.display_name, m.week, m.area, t.position`,
    [teacherId, ...where.params]
  );
  return rows.map((row) => ({
    attemptId: row.attempt_id,
    studentId: row.student_id,
    studentName: row.display_name,
    classId: row.class_id,
    className: row.class_name,
    moduleId: row.module_id,
    week: row.week,
    area: row.area,
    blockCode: row.block_code,
    format: row.format,
    position: row.position,
    isAdaption: Boolean(row.is_adaption),
    status: row.status,
    score: row.score,
    firstTryScore: row.first_try_score,
    mistakes: row.mistakes,
    needsRemediation: Boolean(row.needs_remediation),
    attempts: Number(row.attempt_count),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }));
}

// Every recorded response (R48), for the CSV export.
async function responseRows(db, teacherId, filters = {}) {
  const where = filterSql(filters, {
    classId: 'c.id',
    studentId: 's.id',
    week: 'm.week',
    area: 'm.area',
  });
  const [rows] = await db.query(
    `SELECT c.name AS class_name, s.display_name, m.week, m.area, t.block_code, t.format,
            tr.position AS trial, r.option_id, r.is_correct, r.attempt_number, r.answered_at,
            a.id AS attempt_id, a.status
       FROM responses r
       JOIN attempts a ON a.id = r.attempt_id
       JOIN trials tr ON tr.id = r.trial_id
       JOIN tasks t ON t.id = a.task_id
       JOIN content_versions v ON v.id = t.content_version_id
       JOIN modules m ON m.id = v.module_id
       JOIN students s ON s.id = a.student_id
       JOIN classes c ON c.id = s.class_id
      WHERE c.teacher_id = ?${where.sql}
      ORDER BY c.name, s.display_name, m.week, m.area, a.id, r.id`,
    [teacherId, ...where.params]
  );
  return rows;
}

// RFC 4180 CSV with ";" (what German Excel expects) and a BOM, so umlauts
// in names survive. Cells that start like a formula are prefixed with "'"
// (CSV injection).
function toCsv(header, rows) {
  const cell = (value) => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [header, ...rows].map((row) => row.map(cell).join(';'));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

module.exports = {
  completionPairs,
  averageCompletion,
  percent,
  taskResults,
  responseRows,
  toCsv,
};
