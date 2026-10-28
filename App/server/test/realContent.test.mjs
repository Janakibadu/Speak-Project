import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { fromDirectory } = require('../importer/bundle.js');
const { analyseBundle, resolveMedia } = require('../importer/analyse.js');

// Design §9.2 Gate 2: run the importer against the client's real content.
// Until the client supplies the missing files, every module except
// Vocabulary week 12 must fail on exactly these gaps (docs/media-gaps.md).
// When files arrive, this test fails: update the list and the docs.
const CONTENT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'Speak Programming'
);

// Media other modules provide are resolved once those are imported, so only
// names missing from every folder are listed here.
const SHARED = new Set(['ai_233.mp3', 'i_025.png']);
const KNOWN_GAPS = {
  'Vocabular week 6': ['i_024.jpg'],
  'Vocabulary week 12': [],
  'Grammar week 6': ['i_024.jpg', 'i_231_1.png'],
  'Grammar week 10': ['i_231_1.png'],
  'Grammar week 12': ['i_024.jpg'],
};

async function analyse(folder) {
  const bundle = fromDirectory(path.join(CONTENT, folder));
  const analysis = analyseBundle(bundle);
  await resolveMedia(analysis, bundle);
  return analysis;
}

const missingNames = (report) =>
  report.errors
    .filter((e) => e.code === 'MISSING_MEDIA')
    .map((e) => e.message.split(' ')[0])
    .filter((name) => !SHARED.has(name))
    .sort();

describe.skipIf(!fs.existsSync(CONTENT))('client content (weeks 6, 10, 12)', () => {
  for (const [folder, gaps] of Object.entries(KNOWN_GAPS)) {
    it(`${folder}: parses fully; only the known media gaps remain`, async () => {
      const { report } = await analyse(folder);
      expect(report.errors.filter((e) => e.code !== 'MISSING_MEDIA')).toEqual([]);
      expect(missingNames(report)).toEqual(gaps);
      expect(report.counts.trials).toBeGreaterThan(30);
    });
  }

  it('Vocabulary week 10: media folder is a copy of week 12, so its media are missing', async () => {
    const { report } = await analyse('Vocabulary week 10');
    expect(report.errors.filter((e) => e.code !== 'MISSING_MEDIA')).toEqual([]);
    expect(report.counts.trials).toBe(70);
    expect(missingNames(report).length).toBeGreaterThan(150);
  });
});
