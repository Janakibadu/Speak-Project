// Stage 4 of the importer (Design §5.5): write a validated bundle as a draft
// content version, and publish drafts. A bundle with any error writes nothing.
const pool = require('../db');
const { analyseBundle, resolveMedia } = require('./analyse');
const { storeFile } = require('./mediaStore');

// MariaDB returns JSON columns as strings, MySQL as objects.
function json(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

// A media name not in the bundle may already be imported with another
// module (the client's folders share files). Prefer published content.
async function lookupExternal(db, name) {
  const [rows] = await db.query(
    `SELECT cm.media_asset_id, m.week, m.area
       FROM content_media cm
       JOIN content_versions v ON v.id = cm.content_version_id
       JOIN modules m ON m.id = v.module_id
      WHERE cm.file_name = ? AND v.status IN ('published', 'draft')
      ORDER BY v.status = 'published' DESC, v.id DESC
      LIMIT 1`,
    [name]
  );
  if (rows.length === 0) return null;
  return { mediaAssetId: rows[0].media_asset_id, from: `week ${rows[0].week} ${rows[0].area}` };
}

async function upsertAsset(db, stored, originalName) {
  const [result] = await db.query(
    `INSERT INTO media_assets (sha256, kind, mime_type, byte_size, storage_key, original_name)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [stored.sha256, stored.kind, stored.mimeType, stored.byteSize, stored.storageKey, originalName]
  );
  return result.insertId;
}

// Returns { status: 'rejected' | 'draft', versionId?, report }.
async function importBundle(bundle, { teacherId = null } = {}) {
  const analysis = analyseBundle(bundle);
  const { report } = analysis;
  if (report.errors.length > 0) return { status: 'rejected', report };

  const resolved = await resolveMedia(analysis, bundle, (name) => lookupExternal(pool, name));
  if (report.errors.length > 0) return { status: 'rejected', report };

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Files first (idempotent, by hash), then their registry rows.
    const assetIds = new Map();
    for (const [name, where] of resolved) {
      if (where.mediaAssetId) {
        assetIds.set(name, where.mediaAssetId);
      } else {
        const stored = storeFile(bundle.media.get(where.bundleName)(), where.bundleName);
        assetIds.set(name, await upsertAsset(connection, stored, where.bundleName));
      }
    }

    const { week, area } = analysis.module;
    const [moduleResult] = await connection.query(
      `INSERT INTO modules (week, area) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [week, area]
    );
    const moduleId = moduleResult.insertId;

    report.status = 'draft';
    const [versionResult] = await connection.query(
      `INSERT INTO content_versions (module_id, status, source_name, report, imported_by)
       VALUES (?, 'draft', ?, ?, ?)`,
      [moduleId, bundle.sourceName.slice(0, 190), JSON.stringify(report), teacherId]
    );
    const versionId = versionResult.insertId;

    if (assetIds.size > 0) {
      await connection.query(
        'INSERT INTO content_media (content_version_id, file_name, media_asset_id) VALUES ?',
        [[...assetIds].map(([name, id]) => [versionId, name, id])]
      );
    }

    for (const task of analysis.tasks) {
      const [taskResult] = await connection.query(
        `INSERT INTO tasks (content_version_id, position, block_code, format, is_adaption, playable, config)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          versionId,
          task.position,
          task.blockCode,
          task.format,
          task.isAdaption,
          task.playable,
          JSON.stringify({ ...task.config, scored: task.scored }),
        ]
      );
      const trialRows = task.trials.map((trial, index) => [
        taskResult.insertId,
        index + 1,
        trial.kind,
        JSON.stringify(trial.stimulus),
        JSON.stringify(trial.options),
        trial.correctOption,
        JSON.stringify(trial.feedback),
        JSON.stringify({ ...trial.data, _source: trial.source }),
      ]);
      await connection.query(
        `INSERT INTO trials (task_id, position, kind, stimulus, options, correct_option, feedback, data)
         VALUES ?`,
        [trialRows]
      );
    }

    await connection.commit();
    return { status: 'draft', versionId, report };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

class PublishError extends Error {}

// Makes a draft the module's live version; the previous one is archived but
// kept, because recorded attempts point at it (NFR22).
async function publishVersion(versionId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT id, module_id, status FROM content_versions WHERE id = ? FOR UPDATE',
      [versionId]
    );
    if (rows.length === 0) throw new PublishError('Content version not found.');
    if (rows[0].status !== 'draft') throw new PublishError('Only a draft can be published.');

    const moduleId = rows[0].module_id;
    await connection.query(
      "UPDATE content_versions SET status = 'archived' WHERE module_id = ? AND status = 'published'",
      [moduleId]
    );
    await connection.query(
      "UPDATE content_versions SET status = 'published', published_at = NOW() WHERE id = ?",
      [versionId]
    );
    await connection.query('UPDATE modules SET published_version_id = ? WHERE id = ?', [
      versionId,
      moduleId,
    ]);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function listVersions() {
  const [rows] = await pool.query(
    `SELECT v.id, v.status, v.source_name, v.report, v.imported_at, v.published_at,
            m.week, m.area, t.full_name AS imported_by
       FROM content_versions v
       JOIN modules m ON m.id = v.module_id
       LEFT JOIN teachers t ON t.id = v.imported_by
      ORDER BY v.id DESC`
  );
  return rows.map((row) => {
    const report = json(row.report);
    return {
      id: row.id,
      week: row.week,
      area: row.area,
      status: row.status,
      sourceName: row.source_name,
      importedBy: row.imported_by,
      importedAt: row.imported_at,
      publishedAt: row.published_at,
      counts: report.counts,
      warnings: report.warnings.length,
      corrections: report.corrections.length,
    };
  });
}

async function getVersion(versionId) {
  const [rows] = await pool.query(
    `SELECT v.id, v.status, v.source_name, v.report, m.week, m.area
       FROM content_versions v JOIN modules m ON m.id = v.module_id
      WHERE v.id = ?`,
    [versionId]
  );
  if (rows.length === 0) return null;
  const { report, ...rest } = rows[0];
  return { ...rest, report: json(report) };
}

module.exports = { importBundle, publishVersion, listVersions, getVersion, PublishError, json };
