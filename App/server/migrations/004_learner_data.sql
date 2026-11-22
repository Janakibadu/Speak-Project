-- Learner data (R19, R32–R35, NFR20, NFR22). It points at the content store
-- but never shares its lifecycle: content versions are archived, not deleted,
-- so an attempt keeps pointing at the task (and so the version) the child
-- actually played. Deleting a student cascades to all of it (NFR03).

-- R19: a module for a whole class or for one student. Exactly one of
-- class_id / student_id is set; the route checks it, because MySQL does not
-- allow a CHECK constraint on columns with a cascading foreign key.
CREATE TABLE assignments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  module_id   INT NOT NULL,
  class_id    INT NULL,
  student_id  INT NULL,
  assigned_by INT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_assignments_class UNIQUE (module_id, class_id),
  CONSTRAINT uq_assignments_student UNIQUE (module_id, student_id),
  INDEX idx_assignments_class (class_id),
  INDEX idx_assignments_student (student_id),
  CONSTRAINT fk_assignments_module FOREIGN KEY (module_id) REFERENCES modules(id),
  CONSTRAINT fk_assignments_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_assignments_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_assignments_teacher FOREIGN KEY (assigned_by) REFERENCES teachers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- R34, R35: one run of one task by one student. Scores are set by the server
-- from the recorded responses only. `reset` keeps the history of a module a
-- teacher has reset (R43) while taking it out of the progress.
CREATE TABLE attempts (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  student_id        INT NOT NULL,
  task_id           INT NOT NULL,
  status            ENUM('in_progress','completed','reset') NOT NULL DEFAULT 'in_progress',
  score             TINYINT UNSIGNED NULL,
  first_try_score   TINYINT UNSIGNED NULL,
  mistakes          SMALLINT UNSIGNED NULL,
  needs_remediation TINYINT(1) NOT NULL DEFAULT 0,
  started_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at      TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_attempts_student_task (student_id, task_id, status),
  CONSTRAINT fk_attempts_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_attempts_task FOREIGN KEY (task_id) REFERENCES tasks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- R33: one row per tap on an answer option, written as it happens. A child
-- taps an option at most once per trial (the engine ignores repeats), so the
-- unique key also makes a retried POST harmless.
CREATE TABLE responses (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  attempt_id     INT NOT NULL,
  trial_id       INT NOT NULL,
  option_id      VARCHAR(10) NOT NULL,
  is_correct     TINYINT(1) NOT NULL,
  attempt_number TINYINT UNSIGNED NOT NULL,
  answered_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT uq_responses_option UNIQUE (attempt_id, trial_id, option_id),
  CONSTRAINT fk_responses_attempt FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE,
  CONSTRAINT fk_responses_trial FOREIGN KEY (trial_id) REFERENCES trials(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
