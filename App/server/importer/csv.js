// Reader for the client's CSVs (TR07): semicolon-delimited, no quoting, UTF-8
// or Windows-1252, and LF, CRLF or old-Mac CR line endings (some files mix them).

function decode(buffer) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    return { text: withoutBom, encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buffer), encoding: 'windows-1252' };
  }
}

// "Image _2" → "image_2", "task type" → "task_type", "Story_audio" → "story_audio".
function normaliseHeader(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s*_\s*/g, '_')
    .replace(/\s+/g, '_');
}

// Returns { header, rows, encoding }. Each row is an object keyed by the
// normalised header; a repeated column name gets a suffix (audio_nom_2__2) so
// no value is lost. Trailing empty columns and blank lines are dropped.
function parseCsv(buffer) {
  const { text, encoding } = decode(buffer);
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.replace(/[;\s]/g, '') !== '');
  if (lines.length === 0) return { header: [], rows: [], encoding };

  const rawHeader = lines[0].split(';');
  while (rawHeader.length > 0 && rawHeader[rawHeader.length - 1].trim() === '') rawHeader.pop();

  const seen = new Map();
  const header = rawHeader.map((name, index) => {
    const base = normaliseHeader(name) || `column_${index + 1}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}__${count}`;
  });

  const rows = lines.slice(1).map((line, index) => {
    const cells = line.split(';');
    const row = {};
    header.forEach((name, column) => {
      row[name] = (cells[column] || '').trim();
    });
    const extra = cells.slice(header.length).filter((c) => c.trim() !== '');
    return { line: index + 2, values: row, extraCells: extra.length };
  });

  return { header, rows, encoding };
}

module.exports = { parseCsv, normaliseHeader };
