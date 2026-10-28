const express = require('express');
const pool = require('../db');
const { verifyToken, requireRole, requireActiveStudent } = require('../middleware/auth');
const { filePath } = require('../importer/mediaStore');

// The authorised media controller (NFR13, TR08): the only way media files
// leave MEDIA_DIR. Students get assets of published content only; teachers
// also those of drafts, so they can check an import. Anything else is a 404,
// so the response never reveals whether an asset exists.
const router = express.Router();
router.use(verifyToken, requireRole('TEACHER', 'STUDENT'), requireActiveStudent);

router.get('/:assetId', async (req, res, next) => {
  try {
    if (!/^[0-9]+$/.test(req.params.assetId)) {
      return res.status(404).json({ error: 'Media not found.' });
    }
    const statuses = req.user.role === 'TEACHER' ? ['published', 'draft'] : ['published'];
    const [rows] = await pool.query(
      `SELECT ma.storage_key, ma.mime_type, ma.sha256
         FROM media_assets ma
        WHERE ma.id = ?
          AND EXISTS (SELECT 1 FROM content_media cm
                        JOIN content_versions v ON v.id = cm.content_version_id
                       WHERE cm.media_asset_id = ma.id AND v.status IN (?))`,
      [req.params.assetId, statuses]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Media not found.' });
    const asset = rows[0];

    // Files are named by content hash, so a cached copy never goes stale.
    // sendFile handles Range requests, which iPad Safari needs for audio.
    res.sendFile(
      filePath(asset.storage_key),
      {
        headers: {
          'Content-Type': asset.mime_type,
          'Cache-Control': 'private, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
          ETag: `"${asset.sha256}"`,
        },
        etag: false,
        lastModified: false,
      },
      (err) => {
        if (!err || res.headersSent) return;
        if (err.code === 'ENOENT') {
          // Registered but missing on disk: a storage problem, not a client error.
          console.error(`[media] File missing for asset ${req.params.assetId}`);
          return res.status(404).json({ error: 'Media not found.' });
        }
        next(err);
      }
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
