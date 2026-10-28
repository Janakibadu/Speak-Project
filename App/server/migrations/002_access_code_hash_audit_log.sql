-- D-07, NFR10, Design §6.2: store only a keyed HMAC of each access code; the
-- code itself is shown to the teacher once, at generation or regeneration.
-- Existing plain-text codes can't be converted here (the key lives in the
-- app, not the database), so they are dropped: those students have no code
-- until their teacher regenerates one.
ALTER TABLE students DROP CONSTRAINT chk_access_code_numeric;
ALTER TABLE students DROP COLUMN access_code;
ALTER TABLE students ADD COLUMN access_code_hash CHAR(64) NULL AFTER display_name;
ALTER TABLE students ADD CONSTRAINT uq_students_access_code_hash UNIQUE (access_code_hash);

-- NFR05: who created or deleted which account, and when. IDs only, no names,
-- so a deleted student leaves no personal data behind (NFR02, NFR03).
CREATE TABLE audit_log (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_teacher_id INT NULL,
  action           VARCHAR(40) NOT NULL,
  target_type      VARCHAR(20) NOT NULL,
  target_id        INT NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_actor (actor_teacher_id, created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
