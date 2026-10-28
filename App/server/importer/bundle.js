// A content bundle is one module: its CSVs plus media, either a folder (CLI,
// tests) or an uploaded zip (ContentImportPage). Files are indexed by base
// name; folders inside the bundle (e.g. Stimuli/) don't matter.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const CSV_RE =
  /^K2_W(\d+)_([VG])(\d+)_(general|task|example|reflection|reflection_adaption|reflection_adaption_general)\.csv$/i;
const MANIFEST_RE = /^manifest\.csv$/i;

function isJunk(name) {
  return name.startsWith('.') || name.startsWith('._') || /^thumbs\.db$/i.test(name);
}

function emptyBundle(sourceName) {
  return { sourceName, csv: new Map(), media: new Map(), manifest: null, duplicates: [] };
}

function add(bundle, name, load) {
  if (isJunk(name)) return;
  if (MANIFEST_RE.test(name)) {
    bundle.manifest = load();
    return;
  }
  const isCsv = /\.csv$/i.test(name);
  const target = isCsv ? bundle.csv : bundle.media;
  if (target.has(name)) {
    // Copies of a file are common (e.g. a screenshot at the root and in
    // Stimuli/). The analysis decides whether a duplicate matters.
    bundle.duplicates.push({ name, isCsv, load });
    return;
  }
  target.set(name, load);
}

function fromDirectory(dir) {
  const bundle = emptyBundle(path.basename(dir));
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) add(bundle, entry.name, () => fs.readFileSync(full));
    }
  };
  walk(dir);
  // CSVs and the manifest are small: read them now. Media are read on demand.
  for (const [name, load] of bundle.csv) bundle.csv.set(name, load());
  return bundle;
}

function fromZip(buffer, sourceName) {
  const bundle = emptyBundle(sourceName);
  const zip = new AdmZip(buffer);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || entry.entryName.startsWith('__MACOSX/')) continue;
    add(bundle, path.posix.basename(entry.entryName), () => entry.getData());
  }
  for (const [name, load] of bundle.csv) bundle.csv.set(name, load());
  return bundle;
}

function parseCsvName(name) {
  const match = name.match(CSV_RE);
  if (!match) return null;
  return {
    week: Number(match[1]),
    area: match[2].toUpperCase() === 'V' ? 'vocabulary' : 'grammar',
    areaLetter: match[2].toUpperCase(),
    number: Number(match[3]),
    kind: match[4].toLowerCase(),
  };
}

module.exports = { fromDirectory, fromZip, parseCsvName };
