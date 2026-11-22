// Where a student stands in a module (R32, R34, R35). Shared by the student's
// module path and by the complete endpoint, which uses it to tell the player
// where to go next (Design §7.4: the server directs the remediation).

// A module the student may play: assigned to the student's class or to the
// student directly (R19). Parameters: classId, studentId.
const ASSIGNED_SQL = `EXISTS (SELECT 1 FROM assignments a
  WHERE a.module_id = m.id AND (a.class_id = ? OR a.student_id = ?))`;

async function isAssigned(db, user, moduleId) {
  const [rows] = await db.query(`SELECT 1 FROM modules m WHERE m.id = ? AND ${ASSIGNED_SQL}`, [
    moduleId,
    user.classId,
    user.sub,
  ]);
  return rows.length > 0;
}

// The playable tasks of the module's published version, each with a status:
//   done     – a completed attempt exists;
//   todo     – not completed yet;
//   pending  – an adaption task the preceding task's mistakes call for (R32);
//   skipped  – an adaption task that is not needed.
// `current` is the first todo or pending task (null when the module is done).
// Attempts are matched by block code, so work done before a republish of the
// same module still counts. Reset attempts (R43) are ignored.
async function moduleProgress(db, studentId, moduleId) {
  const [tasks] = await db.query(
    `SELECT t.id, t.position, t.block_code, t.format, t.is_adaption
       FROM modules m JOIN tasks t ON t.content_version_id = m.published_version_id
      WHERE m.id = ? AND t.playable = 1
      ORDER BY t.position`,
    [moduleId]
  );
  const [attempts] = await db.query(
    `SELECT a.id, a.status, a.score, a.needs_remediation, t.block_code
       FROM attempts a
       JOIN tasks t ON t.id = a.task_id
       JOIN content_versions v ON v.id = t.content_version_id
      WHERE a.student_id = ? AND v.module_id = ? AND a.status <> 'reset'
      ORDER BY a.id`,
    [studentId, moduleId]
  );
  const completed = new Map(); // block → latest completed attempt
  const started = new Set(); // blocks with an unfinished attempt
  for (const attempt of attempts) {
    if (attempt.status === 'completed') completed.set(attempt.block_code, attempt);
    else started.add(attempt.block_code);
  }

  let trigger = null; // latest completed attempt of the task before, if it needs remediation
  const out = tasks.map((task) => {
    const done = completed.get(task.block_code);
    let status;
    if (!task.is_adaption) {
      status = done ? 'done' : 'todo';
      trigger = done && done.needs_remediation ? done : null;
    } else if (trigger) {
      status = done && done.id > trigger.id ? 'done' : 'pending';
    } else {
      status = done ? 'done' : 'skipped';
    }
    return {
      id: task.id,
      position: task.position,
      format: task.format,
      isAdaption: Boolean(task.is_adaption),
      status,
      score: done ? done.score : null,
      started: started.has(task.block_code),
    };
  });
  const current = out.find((task) => task.status === 'todo' || task.status === 'pending');
  return { tasks: out, current: current ? current.id : null };
}

module.exports = { ASSIGNED_SQL, isAssigned, moduleProgress };
