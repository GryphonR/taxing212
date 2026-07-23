/**
 * @file fixture-loader.js
 * @brief Helpers for loading synthetic T212 CSV fixtures in Vitest.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvText } from '../../src/lib/parse/csv-normaliser.js';
import { runCalculation } from '../../src/lib/calculation-engine.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');

/**
 * Read a fixture CSV from test/fixtures and parse it into normalised trade rows.
 * @param {string} fileName
 * @returns {Record<string, unknown>[]}
 */
export function loadFixtureCsv(fileName) {
  const csvText = readFileSync(join(fixturesDir, fileName), 'utf8');
  return parseCsvText(csvText);
}

/**
 * Run the calculation engine against a fixture CSV file.
 * @param {string} fileName
 * @param {number} taxYearTarget
 * @param {Object} [options]
 * @returns {import('../../src/lib/calculation-engine.js').CalculationResult}
 */
export function runFixture(fileName, taxYearTarget, options = {}) {
  return runCalculation({
    rawTrades: loadFixtureCsv(fileName),
    manualTrades: options.manualTrades || [],
    corpActions: options.corpActions || [],
    taxYearTarget,
    ukOthersList: options.ukOthersList || {},
  });
}

/**
 * Find a holding by ticker symbol.
 * @param {import('../../src/lib/calculation-engine.js').CalculationResult} result
 * @param {string} ticker
 * @returns {Object|undefined}
 */
export function getHolding(result, ticker) {
  return result.holdings[ticker];
}

/**
 * Return taxable ledger entries for a ticker.
 * @param {import('../../src/lib/calculation-engine.js').CalculationResult} result
 * @param {string} ticker
 * @returns {Object[]}
 */
export function getTaxableLedgerEntries(result, ticker) {
  const holding = getHolding(result, ticker);
  if (!holding) {
    return [];
  }
  return holding.ledger.filter((entry) => entry.taxable);
}
