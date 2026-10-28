-- SPEAK — core schema for teacher auth, classes, students.
-- Same tables as the former schema.sql. IF NOT EXISTS keeps this safe on
-- databases that were created from schema.sql before migrations existed.

CREATE TABLE IF NOT EXISTS teachers (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  full_name               VARCHAR(120) NOT NULL,
  email                   VARCHAR(190) NOT NULL UNIQUE,
  password_hash           VARCHAR(100) NOT NULL,
  is_active               TINYINT(1) NOT NULL DEFAULT 1,
  reset_token_hash        CHAR(64) NULL,
  reset_token_expires_at  TIMESTAMP NULL DEFAULT NULL,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS classes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  name       VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_classes_teacher (teacher_id),
  CONSTRAINT fk_classes_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS students (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  class_id       INT NOT NULL,
  display_name   VARCHAR(80) NOT NULL,
  access_code    CHAR(6) NOT NULL UNIQUE,
  status         ENUM('active','deactivated') NOT NULL DEFAULT 'active',
  last_active_at TIMESTAMP NULL DEFAULT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_students_class (class_id),
  CONSTRAINT fk_students_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT chk_access_code_numeric CHECK (access_code REGEXP '^[0-9]{6}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
