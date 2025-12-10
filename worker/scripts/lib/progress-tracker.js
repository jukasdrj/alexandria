/**
 * Progress Tracker for CLI Output
 * Provides formatted console output and progress bars
 */

import cliProgress from 'cli-progress';
import fs from 'fs/promises';

export class ProgressTracker {
  constructor() {
    this.logs = [];
    this.startTime = Date.now();
  }

  /**
   * Print start banner
   * @param {string} title - Title for the operation
   */
  start(title) {
    console.log('\n' + title);
    console.log('='.repeat(70));
  }

  /**
   * Print phase header
   * @param {string} name - Phase name
   */
  phase(name) {
    console.log(`\n${name}...`);
  }

  /**
   * Log a success message
   * @param {string} message - Message to log
   */
  log(message) {
    console.log(`  ✓ ${message}`);
    this.logs.push({ time: Date.now(), message });
  }

  /**
   * Create a progress bar
   * @param {number} total - Total items to process
   * @returns {object} - Progress bar instance
   */
  createProgressBar(total) {
    const bar = new cliProgress.SingleBar({
      format: '  {bar} {percentage}% | {value}/{total} batches',
      barCompleteChar: '█',
      barIncompleteChar: '░'
    }, cliProgress.Presets.shades_classic);

    bar.start(total, 0);
    return bar;
  }

  /**
   * Print completion summary and save log file
   * @param {object} summary - Summary statistics
   */
  async complete(summary) {
    console.log('\n' + '='.repeat(70));
    console.log('✅ Complete!\n');
    console.log('Summary:');
    console.log(`  • Total books: ${summary.total}`);
    console.log(`  • Valid ISBNs: ${summary.valid}`);
    console.log(`  • Processed: ${summary.processed}`);
    console.log(`  • Skipped: ${summary.skipped}`);
    console.log(`  • Invalid: ${summary.invalid}`);

    const logFile = `logs/seed-queues-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    await fs.writeFile(logFile, JSON.stringify({
      summary,
      logs: this.logs,
      duration_ms: Date.now() - this.startTime
    }, null, 2));

    console.log(`\nLog file: ${logFile}\n`);
  }
}
