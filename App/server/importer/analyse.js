// Parse → normalise → validate a bundle (Design §5.5, stages 1–3), without
// touching the database. Media references are only collected here; the
// caller resolves them (bundle files first, then already-imported content).
const fs = require('fs');
const path = require('path');
const { parseCsv } = require('./csv');
const { parseCsvName } = require('./bundle');
const { FORMATS, normaliseRow } = require('./formats');

const MANIFEST_DIR = path.join(__dirname, 'manifests');
const CORRECTIONS_FILE = path.join(__dirname, 'corrections.json');

// "at_197.mp3", "i_231_1.png": a file name, as opposed to text like "den".
const FILE_RE = /^[^\s;/\\]+\.[A-Za-z][A-Za-z0-9]{1,3}$/;
// Looks like a media id but has no usable extension ("at_304", "i_12.").
const MEDIA_ID_RE = /^(i|at|ai)_\d/i;
// OpenSesame's "no file" placeholder.
const NONE_RE = /^None\.[a-z0-9]+$/i;
// General-file columns whose image is an optional instruction picture.
const OPTIONAL_MEDIA_KEYS = new Set(['explanation_image', 'welcome_image']);

function loadCorrections(file = CORRECTIONS_FILE) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).corrections : [];
}

function defaultManifest(week, areaLetter) {
  const file = path.join(MANIFEST_DIR, `W${week}_${areaLetter}.csv`);
  return fs.existsSync(file)
    ? { buffer: fs.readFileSync(file), source: path.basename(file) }
    : null;
}

function parseManifest(buffer) {
  return parseCsv(buffer).rows.map(({ line, values }) => ({
    line,
    block: values.block,
    format: values.format,
    adaption: /^(yes|ja|true|1)$/i.test(values.adaption || ''),
  }));
}

// Block "V2" → number 2, plain task; "G3_reflection_adaption" → number 3, reflection_adaption.
function parseBlock(block) {
  const match = /^[VG](\d+)(?:_(reflection|reflection_adaption))?$/i.exec(block || '');
  if (!match) return null;
  return { number: Number(match[1]), reflection: match[2] ? match[2].toLowerCase() : null };
}

function blockFiles(block, files) {
  const { number, reflection } = block;
  const ofKind = (kind) => files.find((f) => f.number === number && f.kind === kind);
  if (reflection) {
    return { general: ofKind(`${reflection}_general`), data: ofKind(reflection), example: null };
  }
  return { general: ofKind('general'), data: ofKind('task'), example: ofKind('example') };
}

function analyseBundle(bundle, options = {}) {
  const corrections = options.corrections || loadCorrections();
  const errors = [];
  const warnings = [];
  const applied = new Map();
  const error = (code, message, at = {}) => errors.push({ code, message, ...at });
  const warn = (code, message, at = {}) => warnings.push({ code, message, ...at });
  const used = new Set();
  const mediaRefs = new Map(); // name → { optional, places: [] }
  const tasks = [];
  let module = null;
  let manifestSource = null;

  for (const { name } of bundle.duplicates.filter((d) => d.isCsv)) {
    error('DUPLICATE_FILE', `The bundle contains more than one file named ${name}.`, {
      file: name,
    });
  }

  // Which module is this? Every CSV must belong to the same week and area.
  const files = [];
  for (const name of bundle.csv.keys()) {
    const parsed = parseCsvName(name);
    if (parsed) files.push({ name, ...parsed });
    else
      warn(
        'UNKNOWN_CSV',
        `${name} does not follow the K2_W<week>_<V|G><n>_<kind>.csv naming and is ignored.`,
        { file: name }
      );
  }
  const modules = new Set(files.map((f) => `${f.week}:${f.area}`));
  if (files.length === 0) {
    error('NO_CONTENT', 'The bundle contains no content CSV files.');
    return { module: null, tasks: [], media: [], report: report() };
  }
  if (modules.size > 1) {
    error(
      'MIXED_MODULES',
      `The bundle mixes several modules (${[...modules].join(', ')}). Upload one week and area at a time.`
    );
    return { module: null, tasks: [], media: [], report: report() };
  }
  const { week, area, areaLetter } = files[0];
  module = { week, area };

  // The manifest maps CSV blocks to formats, in play order.
  let manifestBuffer = bundle.manifest ? bundle.manifest : null;
  manifestSource = bundle.manifest ? 'manifest.csv (bundle)' : null;
  if (!manifestBuffer) {
    const fallback = defaultManifest(week, areaLetter);
    if (fallback) [manifestBuffer, manifestSource] = [fallback.buffer, fallback.source];
  }
  if (!manifestBuffer) {
    error(
      'NO_MANIFEST',
      `No manifest.csv for week ${week} ${area}: add one to the bundle (block;format;adaption).`
    );
    return { module, tasks: [], media: [], report: report() };
  }
  const manifest = parseManifest(manifestBuffer);

  function addRef(name, optional, place) {
    const ref = mediaRefs.get(name) || { optional: true, places: [] };
    ref.optional = ref.optional && optional;
    ref.places.push(place);
    mediaRefs.set(name, ref);
  }

  // Applies corrections, blanks "None.*" and collects media references.
  function cleanRow(fileName, values, line, { optionalKeys = new Set() } = {}) {
    const out = {};
    for (const [key, raw] of Object.entries(values)) {
      let value = raw;
      for (const c of corrections) {
        if (value === c.from && (!c.file || c.file.toLowerCase() === fileName.toLowerCase())) {
          const id = `${c.file || '*'}|${c.from}`;
          applied.set(id, { ...c, count: (applied.get(id)?.count || 0) + 1 });
          value = c.to;
        }
      }
      if (NONE_RE.test(value)) value = '';
      if (value && FILE_RE.test(value)) {
        addRef(value, optionalKeys.has(key), { file: fileName, line, column: key });
      } else if (value && MEDIA_ID_RE.test(value)) {
        error(
          'MALFORMED_MEDIA_NAME',
          `"${value}" looks like a media file but has no valid extension.`,
          { file: fileName, line, column: key }
        );
      } else if (value && optionalKeys.has(key)) {
        warn(
          'PLACEHOLDER_IMAGE',
          `"${value}" is not a file name; the instruction image is left out.`,
          { file: fileName, line, column: key }
        );
        value = '';
      }
      out[key] = value;
    }
    return out;
  }

  manifest.forEach((entry, index) => {
    const at = { file: manifestSource, line: entry.line };
    const block = parseBlock(entry.block);
    const format = FORMATS[entry.format];
    if (!block)
      return error(
        'BAD_BLOCK',
        `Manifest block "${entry.block}" is not like V2, G3 or G2_reflection.`,
        at
      );
    if (!format)
      return error(
        'UNKNOWN_FORMAT',
        `Unknown task format "${entry.format}" for block ${entry.block}.`,
        at
      );

    const { general, data, example } = blockFiles(block, files);
    if (!data) return error('MISSING_BLOCK_FILE', `No CSV found for block ${entry.block}.`, at);
    [general, data, example].filter(Boolean).forEach((f) => used.add(f.name));

    let config = {};
    if (general) {
      const parsed = parseCsv(bundle.csv.get(general.name));
      if (parsed.rows.length !== 1) {
        warn(
          'GENERAL_ROWS',
          `${general.name} should have exactly one data row (has ${parsed.rows.length}).`,
          { file: general.name }
        );
      }
      if (parsed.rows[0]) {
        config = cleanRow(general.name, parsed.rows[0].values, parsed.rows[0].line, {
          optionalKeys: OPTIONAL_MEDIA_KEYS,
        });
      }
    } else if (!block.reflection) {
      warn('NO_GENERAL', `Block ${entry.block} has no _general.csv (no instruction audio).`, at);
    }

    const trials = [];
    const addRows = (file, isExample) => {
      const parsed = parseCsv(bundle.csv.get(file.name));
      for (const { line, values, extraCells } of parsed.rows) {
        if (extraCells)
          warn(
            'EXTRA_CELLS',
            `Line ${line} has ${extraCells} value(s) beyond the header; they are ignored.`,
            { file: file.name, line }
          );
        const clean = cleanRow(file.name, values, line);
        const { extraMedia, ...trial } = normaliseRow(entry.format, clean, { example: isExample });
        trial.source = { file: file.name, line };
        for (const name of extraMedia)
          addRef(name, true, { ...trial.source, column: '(implicit)' });
        trials.push(trial);
      }
    };
    if (example) addRows(example, true);
    addRows(data, false);

    const playable = format.playable !== false;
    if (trials.length === 0) error('EMPTY_TASK', `Block ${entry.block} has no rows.`, at);
    if (playable) {
      for (const t of trials.filter((t) => t.kind === 'question')) {
        if (t.options.length < 2)
          error('TOO_FEW_OPTIONS', 'A question needs at least two answer options.', t.source);
        if (!t.correctOption)
          error('NO_CORRECT_OPTION', 'A question has no correct option.', t.source);
      }
    } else {
      warn(
        'NOT_PLAYABLE',
        `Format ${entry.format} (block ${entry.block}) is imported but not offered to children yet.`,
        at
      );
    }

    tasks.push({
      position: index + 1,
      blockCode: `W${week}_${entry.block}`,
      format: entry.format,
      isAdaption: entry.adaption,
      playable,
      scored: format.scored,
      config,
      trials,
    });
  });

  for (const f of files) {
    if (!used.has(f.name))
      warn('UNUSED_FILE', `${f.name} is not listed in the manifest and is ignored.`, {
        file: f.name,
      });
  }

  const media = [...mediaRefs].map(([name, ref]) => ({ name, ...ref }));

  function report() {
    return {
      module,
      manifest: manifestSource,
      corrections: [...applied.values()],
      counts: {
        csvFiles: bundle.csv.size,
        tasks: tasks.length,
        trials: tasks.reduce((n, t) => n + t.trials.length, 0),
        mediaReferenced: mediaRefs.size,
        mediaFilesInBundle: bundle.media.size,
      },
      errors,
      warnings,
    };
  }

  return { module, tasks, media, report: report() };
}

// Resolves every referenced media name: exact name in the bundle, else a
// case-insensitive match (warning), else `lookupExternal(name)` (content
// already imported for another module), else an error or, for optional
// files (instruction images, U's extras), a warning. Mutates and returns the report.
async function resolveMedia(analysis, bundle, lookupExternal = async () => null) {
  const { report } = analysis;
  const byLower = new Map([...bundle.media.keys()].map((n) => [n.toLowerCase(), n]));
  const resolved = new Map();

  for (const ref of analysis.media) {
    const where = ref.places[0];
    if (bundle.media.has(ref.name)) {
      const copies = bundle.duplicates.filter((d) => !d.isCsv && d.name === ref.name);
      const original = copies.length ? bundle.media.get(ref.name)() : null;
      if (copies.some((d) => !original.equals(d.load()))) {
        report.errors.push({
          code: 'DUPLICATE_FILE',
          message: `The bundle has different files named ${ref.name}; it is unclear which one is meant.`,
          ...where,
        });
        continue;
      }
      resolved.set(ref.name, { bundleName: ref.name });
    } else if (byLower.has(ref.name.toLowerCase())) {
      const actual = byLower.get(ref.name.toLowerCase());
      resolved.set(ref.name, { bundleName: actual });
      report.warnings.push({
        code: 'MEDIA_CASE',
        message: `${ref.name} matched ${actual} only when ignoring upper/lower case.`,
        ...where,
      });
    } else {
      const external = await lookupExternal(ref.name);
      if (external) {
        resolved.set(ref.name, { mediaAssetId: external.mediaAssetId });
        report.warnings.push({
          code: 'MEDIA_FROM_OTHER_MODULE',
          message: `${ref.name} is not in this bundle; using the copy imported with ${external.from}.`,
          ...where,
        });
      } else if (ref.optional) {
        report.warnings.push({
          code: 'MISSING_OPTIONAL_MEDIA',
          message: `Optional file ${ref.name} is missing and will be left out.`,
          ...where,
        });
      } else {
        report.errors.push({
          code: 'MISSING_MEDIA',
          message: `${ref.name} is referenced but not found (${ref.places.length} place(s)).`,
          ...where,
        });
      }
    }
  }
  report.counts.mediaResolved = resolved.size;
  return resolved;
}

module.exports = { analyseBundle, resolveMedia, parseManifest, loadCorrections, FILE_RE };
