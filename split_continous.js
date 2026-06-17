const fs = require('fs');
const path = require('path');

// Configuration
const INPUT_DIR = './extract-subset';
const OUTPUT_DIR = './extracted';
const MAX_GAP_MS = 10 * 60 * 1000; //  minutes

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Parse a CSV line into an object.
 * Expected columns: receive_timestamp, receive_time_iso, exchange_timestamp, exchange_time_iso,
 *                   latency_ms, instrument_key, ltp, last_traded_quantity
 */
function parseCSVLine(line, headers) {
    const values = line.split(',');
    if (values.length !== headers.length) return null;

    const row = {};
    for (let i = 0; i < headers.length; i++) {
        row[headers[i]] = values[i].trim();
    }
    return row;
}

/**
 * Validate a row.
 * - Must have all fields non-empty.
 * - instrument_key must contain '|' (proper format), not just a number.
 */
function isValidRow(row) {
    if (!row) return false;
    const required = ['receive_timestamp', 'receive_time_iso', 'exchange_timestamp',
                      'exchange_time_iso', 'latency_ms', 'instrument_key', 'ltp', 'last_traded_quantity'];
    for (const field of required) {
        if (!row[field] || row[field].trim() === '') return false;
    }
    // Instrument key must be like "NSE_FO|62329", not just a number
    if (!row.instrument_key.includes('|')) return false;
    return true;
}

/**
 * Process a single CSV file.
 */
function processFile(filePath, fileName) {
    console.log(`Processing ${fileName}...`);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);

    if (lines.length < 2) {
        console.log(`  Skipping ${fileName}: not enough data.`);
        return;
    }

    const headers = lines[0].split(',');
    const dataRows = [];

    // Parse and validate each row
    for (let i = 1; i < lines.length; i++) {
        const row = parseCSVLine(lines[i], headers);
        if (isValidRow(row)) {
            // Convert exchange_time_iso to Date object for sorting/comparison
            row._date = new Date(row.exchange_time_iso);
            dataRows.push(row);
        }
    }

    if (dataRows.length === 0) {
        console.log(`  No valid rows found in ${fileName}.`);
        return;
    }

    // Sort by timestamp (though likely already sorted)
    dataRows.sort((a, b) => a._date - b._date);

    // Split into continuous groups based on time gap
    const groups = [];
    let currentGroup = [dataRows[0]];

    for (let i = 1; i < dataRows.length; i++) {
        const prevDate = dataRows[i - 1]._date;
        const currDate = dataRows[i]._date;
        const gapMs = currDate - prevDate;

        if (gapMs <= MAX_GAP_MS) {
            currentGroup.push(dataRows[i]);
        } else {
            // Gap too large → finish current group and start a new one
            groups.push(currentGroup);
            currentGroup = [dataRows[i]];
        }
    }
    // Push the last group
    if (currentGroup.length > 0) groups.push(currentGroup);

    // Write each group to a separate CSV file
    const baseName = path.basename(fileName, path.extname(fileName));
    let partCounter = 1;

    for (const group of groups) {
        if (group.length === 0) continue;

        // Prepare CSV lines
        const outLines = [headers.join(',')];
        for (const row of group) {
            // Reconstruct original CSV line (without the _date helper)
            const values = headers.map(h => row[h]);
            outLines.push(values.join(','));
        }

        const outFileName = `${baseName}_part${partCounter}.csv`;
        const outPath = path.join(OUTPUT_DIR, outFileName);
        fs.writeFileSync(outPath, outLines.join('\n'), 'utf8');
        console.log(`  -> Created ${outFileName} (${group.length} rows)`);
        partCounter++;
    }

    console.log(`Finished ${fileName}: ${groups.length} continuous subsets.`);
}

// Main: read all CSV files from INPUT_DIR
function main() {
    const files = fs.readdirSync(INPUT_DIR).filter(f => f.toLowerCase().endsWith('.csv'));
    if (files.length === 0) {
        console.log('No CSV files found in', INPUT_DIR);
        return;
    }

    for (const file of files) {
        const fullPath = path.join(INPUT_DIR, file);
        processFile(fullPath, file);
    }

    console.log('All files processed.');
}

main();