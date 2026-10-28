// Media files are stored once each, named by content hash, under MEDIA_DIR,
// which must lie outside public/ (NFR13, TR08). They are only ever served
// through the authorised media controller.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TYPES = {
  jpg: ['image', 'image/jpeg'],
  jpeg: ['image', 'image/jpeg'],
  png: ['image', 'image/png'],
  gif: ['image', 'image/gif'],
  webp: ['image', 'image/webp'],
  mp3: ['audio', 'audio/mpeg'],
  wav: ['audio', 'audio/wav'],
  ogg: ['audio', 'audio/ogg'],
  m4a: ['audio', 'audio/mp4'],
};

function mediaDir() {
  return process.env.MEDIA_DIR || path.join(__dirname, '..', 'storage', 'media');
}

function describe(fileName) {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  const [kind, mimeType] = TYPES[ext] || ['other', 'application/octet-stream'];
  return { ext, kind, mimeType };
}

// Writes the file unless an identical one is already stored.
function storeFile(buffer, fileName) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const { ext, kind, mimeType } = describe(fileName);
  const storageKey = `${sha256.slice(0, 2)}/${sha256}${ext ? `.${ext}` : ''}`;
  const target = path.join(mediaDir(), storageKey);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, target);
  }
  return { sha256, storageKey, kind, mimeType, byteSize: buffer.length };
}

function filePath(storageKey) {
  return path.resolve(mediaDir(), storageKey);
}

module.exports = { storeFile, filePath, mediaDir, describe };
