-- Content store (R17–R20, NFR21, NFR22, TR07). Written only by the importer;
-- learner data (assignments, attempts, responses) comes later and points at
-- these tables but never shares their lifecycle.

-- One row per logical module: one week within one area (R17, R18).
-- Assignments will target this row, so a republished version reaches them.
CREATE TABLE modules (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  week                 TINYINT UNSIGNED NOT NULL,
  area                 ENUM('vocabulary','grammar') NOT NULL,
  published_version_id INT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_modules_week_area UNIQUE (week, area)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One import of one module. Attempts will record the version they were
-- played against, so a reimport never changes recorded results (Design §3.1).
CREATE TABLE content_versions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  module_id    INT NOT NULL,
  status       ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  source_name  VARCHAR(190) NOT NULL,
  report       JSON NOT NULL,
  imported_by  INT NULL,
  imported_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_versions_module (module_id, status),
  CONSTRAINT fk_versions_module FOREIGN KEY (module_id) REFERENCES modules(id),
  CONSTRAINT fk_versions_teacher FOREIGN KEY (imported_by) REFERENCES teachers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE modules
  ADD CONSTRAINT fk_modules_published_version
  FOREIGN KEY (published_version_id) REFERENCES content_versions(id);

-- Ordered task blocks within a version. `format` is the overview-sheet code
-- (A, B, F_2, V_3, AT, …); `block_code` is the CSV block (W6_V2, W6_G3_reflection).
CREATE TABLE tasks (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  content_version_id INT NOT NULL,
  position           SMALLINT UNSIGNED NOT NULL,
  block_code         VARCHAR(60) NOT NULL,
  format             VARCHAR(10) NOT NULL,
  is_adaption        TINYINT(1) NOT NULL DEFAULT 0,
  playable           TINYINT(1) NOT NULL DEFAULT 1,
  config             JSON NOT NULL,
  CONSTRAINT uq_tasks_position UNIQUE (content_version_id, position),
  CONSTRAINT fk_tasks_version FOREIGN KEY (content_version_id) REFERENCES content_versions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Normalised trials (Design §3.2). Media are referenced by file name and
-- resolved through content_media for the same version.
CREATE TABLE trials (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  task_id        INT NOT NULL,
  position       SMALLINT UNSIGNED NOT NULL,
  kind           ENUM('question','screen','example') NOT NULL,
  stimulus       JSON NOT NULL,
  options        JSON NOT NULL,
  correct_option VARCHAR(40) NULL,
  feedback       JSON NOT NULL,
  data           JSON NOT NULL,
  CONSTRAINT uq_trials_position UNIQUE (task_id, position),
  CONSTRAINT fk_trials_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Every stored media file once, by content hash. Files live outside public/
-- under MEDIA_DIR and are served only through the media controller (NFR13, TR08).
CREATE TABLE media_assets (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  sha256        CHAR(64) NOT NULL,
  kind          ENUM('image','audio','other') NOT NULL,
  mime_type     VARCHAR(60) NOT NULL,
  byte_size     INT UNSIGNED NOT NULL,
  storage_key   VARCHAR(100) NOT NULL,
  original_name VARCHAR(190) NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_media_sha256 UNIQUE (sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- File name → asset, per version. The same name can mean different files in
-- different weeks (e.g. i_264.jpg), so names are only unique within a version.
CREATE TABLE content_media (
  content_version_id INT NOT NULL,
  file_name          VARCHAR(190) NOT NULL,
  media_asset_id     INT NOT NULL,
  PRIMARY KEY (content_version_id, file_name),
  INDEX idx_content_media_name (file_name),
  CONSTRAINT fk_content_media_version FOREIGN KEY (content_version_id) REFERENCES content_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_content_media_asset FOREIGN KEY (media_asset_id) REFERENCES media_assets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- R31, R32: attempts per trial and the remediation threshold, per format.
CREATE TABLE task_type_config (
  format             VARCHAR(10) PRIMARY KEY,
  mistake_threshold  TINYINT UNSIGNED NOT NULL DEFAULT 3,
  attempts_per_trial TINYINT UNSIGNED NOT NULL DEFAULT 2
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO task_type_config (format) VALUES
  ('A'), ('B'), ('C'), ('F_1'), ('F_2'), ('T'), ('R'), ('G1'), ('G2'), ('V_3'), ('U'),
  ('AT'), ('AV'), ('AX'), ('AH'), ('AD'), ('H_X4'), ('N'), ('AF'), ('AM');
