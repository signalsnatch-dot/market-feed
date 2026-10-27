const fs = require('fs');
const path = require('path');

const SIGNALS_DIR = './signals';
const OUTPUT_PREFIX = 'filtered_';

// Columns to keep — ordered, minimal tokens.
const COLUMNS = [
  'version',
  'instrument',
  'name',
  'type',
  'entry',
  'sl',
  'tp',
  'confidence',
  'threshold',
  'barNumber',
  'timestamp',
  'ist',          // derived: IST day/date/time
  'exitReason',
  'exitPrice',
];

/**
 * Convert a millisecond epoch timestamp to an IST string:
 *   "Thu, 18 Sep 2026 15:31:07 IST"
 */
function toIST(ts) {
  if (ts === undefined || ts === null || ts === '') return '';
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '';

  // Format in Asia/Kolkata (IST, UTC+5:30)
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Intl gives e.g. "Thu, 18 Sep 2026, 15:31:07" — normalise separators.
  const parts = fmt.formatToParts(d).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second} IST`;
}

/**
 * Filter + project a signals array.
 *  - drop trades with bar_type === "price"
 *  - keep only trades with status === "completed"
 *  - project whitelisted columns
 *  - derive IST string from timestamp
 */
function filterAndProject(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((t) => t.bar_type !== 'price' && t.status === 'completed')
    .map((t) => {
      const row = {};
      for (const key of COLUMNS) {
        if (key === 'ist') continue;
        row[key] = t[key] ?? '';
      }
      row.ist = toIST(t.timestamp);
      return row;
    });
}

/**
 * Minimal CSV encoder — quotes only when necessary.
 */
function csvCell(value) {
  const s = String(value);
  if (s === '') return '';
  const needsQuote = /[",\n\r]/.test(s) || s !== s.trim();
  return needsQuote ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const header = COLUMNS.join(',');
  const lines = rows.map((row) => COLUMNS.map((c) => csvCell(row[c])).join(','));
  return [header, ...lines].join('\n') + '\n';
}

function getJsonFiles(dir) {
  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }
  return fs
    .readdirSync(dir)
    .filter(
      (f) =>
        f.toLowerCase().endsWith('.json') &&
        !f.startsWith(OUTPUT_PREFIX)
    )
    .map((f) => path.join(dir, f));
}

function main() {
  const files = getJsonFiles(SIGNALS_DIR);
  if (files.length === 0) {
    console.log('No JSON files found in ./signals');
    return;
  }

  let written = 0;
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const rows = filterAndProject(data);

      if (rows.length === 0) {
        console.log(`⏭  ${path.basename(file)} → no completed non-price trades`);
        continue;
      }

      const base = path.basename(file, path.extname(file));
      const outFile = path.join(path.dirname(file), `${OUTPUT_PREFIX}${base}.csv`);

      fs.writeFileSync(outFile, toCsv(rows), 'utf-8');
      console.log(`✅ ${path.basename(file)} → ${path.basename(outFile)} (${rows.length} rows)`);
      written++;
    } catch (err) {
      console.error(`❌ ${file}: ${err.message}`);
    }
  }

  console.log(`\nDone. Wrote ${written} CSV file(s).`);
}

main();