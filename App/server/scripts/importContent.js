// Imports content folders from the command line (development, first setup).
//   npm run import -- "<module folder>" [--publish]
//   npm run import -- --all "<Speak Programming folder>" [--publish]
// With --all, every subfolder containing a Stimuli/ folder is imported. Modules
// rejected only for missing media are retried once at the end, because the
// client's folders share files that another module may provide.
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const pool = require('../db');
const { fromDirectory } = require('../importer/bundle');
const { importBundle, publishVersion } = require('../importer/importService');

function summary(name, result) {
  const { report } = result;
  const head = `${result.status.toUpperCase().padEnd(8)} ${name}`;
  const counts = report.counts
    ? ` — ${report.counts.tasks} tasks, ${report.counts.trials} trials`
    : '';
  const lines = [
    `${head}${counts}, ${report.warnings.length} warning(s), ${report.corrections.length} correction(s)`,
  ];
  for (const e of report.errors) {
    lines.push(
      `    ✗ ${e.code} ${e.file ? `${e.file}${e.line ? `:${e.line}` : ''} ` : ''}${e.message}`
    );
  }
  return lines.join('\n');
}

async function importFolder(dir, publish) {
  const result = await importBundle(fromDirectory(dir));
  if (result.status === 'draft' && publish) {
    await publishVersion(result.versionId);
    result.status = 'published';
  }
  console.log(summary(path.basename(dir), result));
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const publish = args.includes('--publish');
  const all = args.includes('--all');
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error('Usage: npm run import -- [--all] <folder> [--publish]');
    process.exit(2);
  }

  if (!all) {
    const result = await importFolder(path.resolve(target), publish);
    return result.status === 'rejected' ? 1 : 0;
  }

  const folders = fs
    .readdirSync(target)
    .map((d) => path.join(target, d))
    .filter((d) => fs.existsSync(path.join(d, 'Stimuli')));
  const retry = [];
  let failed = 0;
  for (const dir of folders) {
    const result = await importFolder(dir, publish);
    if (result.status !== 'rejected') continue;
    if (result.report.errors.every((e) => e.code === 'MISSING_MEDIA')) retry.push(dir);
    else failed++;
  }
  if (retry.length) console.log('\nRetrying modules that may use media from the others:');
  for (const dir of retry) {
    if ((await importFolder(dir, publish)).status === 'rejected') failed++;
  }
  return failed > 0 ? 1 : 0;
}

main()
  .then((code) => (process.exitCode = code))
  .catch((err) => {
    console.error(`[import] ${err.code || 'ERROR'}: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
