const express = require('express');
const multer = require('multer');
const { verifyToken, requireRole } = require('../middleware/auth');
const { fromZip } = require('../importer/bundle');
const {
  importBundle,
  publishVersion,
  listVersions,
  getVersion,
  PublishError,
} = require('../importer/importService');

// Content import (R09, R42, TR07). Any teacher may import (Addendum 01);
// content is global, so there is no ownership check.
const router = express.Router();
router.use(verifyToken, requireRole('TEACHER'));

const maxUploadMb = () => Number(process.env.MAX_UPLOAD_MB) || 100;

function receiveBundle(req, res, next) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadMb() * 1024 * 1024, files: 1 },
  }).single('bundle');
  upload(req, res, (err) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `The file is larger than ${maxUploadMb()} MB.` });
    }
    if (err) return res.status(400).json({ error: 'The upload could not be read.' });
    next();
  });
}

router.get('/versions', async (req, res, next) => {
  try {
    res.json({ versions: await listVersions() });
  } catch (err) {
    next(err);
  }
});

router.get('/versions/:id', async (req, res, next) => {
  try {
    const version = await getVersion(req.params.id);
    if (!version) return res.status(404).json({ error: 'Content version not found.' });
    res.json({ version });
  } catch (err) {
    next(err);
  }
});

router.post('/import', receiveBundle, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a .zip file to upload.' });
    let bundle;
    try {
      bundle = fromZip(req.file.buffer, req.file.originalname);
    } catch {
      return res.status(400).json({ error: 'The file is not a valid .zip archive.' });
    }

    const result = await importBundle(bundle, { teacherId: req.user.sub });
    if (result.status === 'rejected') {
      return res
        .status(422)
        .json({ error: 'The content has errors and was not imported.', report: result.report });
    }
    res.status(201).json({ versionId: result.versionId, report: result.report });
  } catch (err) {
    next(err);
  }
});

router.post('/:versionId/publish', async (req, res, next) => {
  try {
    await publishVersion(req.params.versionId);
    res.json({ message: 'Content version published.' });
  } catch (err) {
    if (err instanceof PublishError) {
      const status = err.message === 'Content version not found.' ? 404 : 409;
      return res.status(status).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
