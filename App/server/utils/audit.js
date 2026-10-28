const pool = require('../db');

// NFR05: record account creation and deletion. Pass the transaction's
// connection so the audit row commits or rolls back with the change itself.
async function audit(db, { actorTeacherId, action, targetType, targetId }) {
  await (db || pool).query(
    'INSERT INTO audit_log (actor_teacher_id, action, target_type, target_id) VALUES (?, ?, ?, ?)',
    [actorTeacherId, action, targetType, targetId]
  );
}

module.exports = { audit };
