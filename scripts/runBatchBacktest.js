/**
 * runBatchBacktest.js — Automated batch backtester for fix profiles
 * 
 * Usage:
 *   node scripts/runBatchBacktest.js <profile>
 *   node scripts/runBatchBacktest.js off
 *   node scripts/runBatchBacktest.js entry_stop
 *   node scripts/runBatchBacktest.js all    (runs all profiles sequentially)
 * 
 * Profiles: off, entry_stop, trend, leg_quality, exit_mgmt
 * 
 * For each profile:
 *   1. Clears ./live-backtest-results/
 *   2. Sets FIX_PROFILE env var
 *   3. Runs node backtesterAsLive.js run-all
 *   4. Runs node generateReport.js --live --compact-only
 *   5. Copies compact output to compact_<profile>.md
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROFILES = ['off', 'entry_stop', 'trend', 'leg_quality', 'exit_mgmt'];
const RESULTS_DIR = './live-backtest-results';
const CANDLES_DIR = './candles/live';
const COMPACT_DIR = './compact-results';

function runProfile(profile) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🔄 Running profile: ${profile}`);
    console.log(`${'═'.repeat(70)}`);

    // 1. Clear previous results
    console.log('   🧹 Clearing previous results...');
    if (fs.existsSync(RESULTS_DIR)) {
        fs.rmSync(RESULTS_DIR, { recursive: true, force: true });
    }
    if (fs.existsSync(CANDLES_DIR)) {
        fs.rmSync(CANDLES_DIR, { recursive: true, force: true });
    }

    // 2. Run backtester
    console.log('   📊 Running backtesterAsLive.js run-all...');
    const backtestStart = Date.now();
    try {
        execSync('node backtesterAsLive.js run-all', {
            stdio: 'inherit',
            env: { ...process.env, FIX_PROFILE: profile },
            timeout: 3600000, // 1 hour max
        });
    } catch (err) {
        console.error(`   ❌ Backtest failed: ${err.message}`);
        return false;
    }
    const backtestDuration = ((Date.now() - backtestStart) / 1000 / 60).toFixed(1);
    console.log(`   ⏱ Backtest completed in ${backtestDuration} min`);

    // 3. Run report generator (writes compact file to version-backtest-report/)
    console.log('   📝 Running generateReport.js --live...');
    const reportStart = Date.now();
    try {
        execSync('node generateReport.js --live', {
            stdio: 'inherit',
            env: { ...process.env, FIX_PROFILE: profile },
            timeout: 300000,
        });
    } catch (err) {
        console.error(`   ❌ Report generation failed: ${err.message}`);
        return false;
    }
    const reportDuration = ((Date.now() - reportStart) / 1000).toFixed(1);
    console.log(`   ⏱ Report generated in ${reportDuration}s`);

    // 4. Find and copy the compact summary file
    const REPORT_DIR = './version-backtest-report';
    if (!fs.existsSync(REPORT_DIR)) {
        console.error('   ⚠️ Report directory not found');
        return false;
    }

    // Look for the most recent live_compact_summary_*.md file
    const files = fs.readdirSync(REPORT_DIR)
        .filter(f => f.startsWith('live_compact_summary_') && f.endsWith('.md'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(REPORT_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
        console.error('   ⚠️ No compact summary file found in version-backtest-report/');
        return false;
    }

    const latestCompact = files[0].name;
    const sourcePath = path.join(REPORT_DIR, latestCompact);

    // Read and copy with profile header
    if (!fs.existsSync(COMPACT_DIR)) fs.mkdirSync(COMPACT_DIR, { recursive: true });
    const compactPath = path.join(COMPACT_DIR, `compact_${profile}.md`);
    const compactContent = fs.readFileSync(sourcePath, 'utf8');
    const header = `# Compact Backtest Summary — Profile: \`${profile}\`\n` +
                   `Generated: ${new Date().toISOString()}\n` +
                   `Backtest duration: ${backtestDuration} min | Report generation: ${reportDuration}s\n\n`;
    fs.writeFileSync(compactPath, header + compactContent);
    console.log(`   📄 Compact summary copied from ${latestCompact} → ${compactPath}`);

    return true;
}

function runAll() {
    console.log(`\n${'█'.repeat(70)}`);
    console.log(`█ BATCH BACKTEST — Running all ${PROFILES.length} profiles`);
    console.log(`${'█'.repeat(70)}`);

    const results = [];
    for (const profile of PROFILES) {
        const success = runProfile(profile);
        results.push({ profile, success });
    }

    console.log(`\n${'═'.repeat(70)}`);
    console.log('📋 SUMMARY');
    console.log(`${'═'.repeat(70)}`);
    for (const r of results) {
        console.log(`   ${r.success ? '✅' : '❌'} ${r.profile}`);
    }
    console.log(`\n📂 Compact files saved to ${COMPACT_DIR}/`);
    console.log('   Compare them to identify which fix batches improved performance.');
}

// Main
const args = process.argv.slice(2);
const profile = args[0];

if (!profile) {
    console.log(`
Usage: node scripts/runBatchBacktest.js <profile|all>

Profiles:
  off          — Baseline (no fixes, V51-V106 match V1-V50 behavior)
  entry_stop   — Batch 1: STOP_WIDER_RATIO + TRIGGER_WIDER_OFFSET + ATR_DYNAMIC_STOP_FLOOR + SLIPPAGE
  trend        — Batch 2: TREND_ABR_NORMALIZED_SLOPE + TREND_ADX_FILTER + TREND_GAP_BAR_OPTIONAL
  leg_quality  — Batch 3: LEG_DEPTH_RATIO + PIVOT_STRUCTURAL_DETECTION
  exit_mgmt    — Batch 4: TRAILING_STOP + TIME_BASED_EXIT + SAME_BAR_EXIT_PATH
  all          — Run all profiles sequentially

Output: compact_<profile>.md in ./compact-results/
`);
    process.exit(1);
}

if (profile === 'all') {
    runAll();
} else {
    const success = runProfile(profile);
    process.exit(success ? 0 : 1);
}