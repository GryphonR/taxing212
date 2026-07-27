/**
 * @file calculation-engine.js
 * @brief Orchestrates the taxing212 HMRC calculation pipeline.
 */
import { appendManualTrades, applyCorpActions } from './tax/corp-actions.js';
import { calculateDisposals } from './tax/disposals.js';
import { cloneTrades, createEngineState } from './tax/engine-state.js';
import { populateLedger } from './tax/ledger.js';
import { generateRoundtrips } from './tax/round-trips.js';
import { ingestTrade, sortTrades } from './tax/trade-ingest.js';
import { buildAvailableTaxYears, recalculateTaxYearData } from './tax/tax-year.js';
import { getTaxYearBounds } from './tax/dates.js';
import { resetUidCounter } from './tax/uid.js';

/**
 * @typedef {Object} CalculationInput
 * @property {Record<string, unknown>[]} rawTrades
 * @property {Object[]} [manualTrades]
 * @property {Object[]} [corpActions]
 * @property {number} taxYearTarget
 * @property {Record<string, boolean>} [ukOthersList]
 */

/**
 * @typedef {Object} CalculationResult
 * @property {Record<string, Object>} holdings
 * @property {Object[]} dividends
 * @property {Object[]} deposits
 * @property {Object[]} withdrawals
 * @property {Object[]} errorList
 * @property {Object[]} allRoundTrips
 * @property {number[]} availableTaxYears
 * @property {Object} taxYearData
 * @property {Object} taxYear
 * @property {number} disposalCount
 * @property {number} realisedProfit
 * @property {number} realisedLoss
 * @property {number} realisedPl
 * @property {number} dividendsTotal
 * @property {Object} dividendDetails
 */

/**
 * Run the full taxing212 calculation pipeline without Vue or browser APIs.
 * @param {CalculationInput} input
 * @returns {CalculationResult}
 */
export function runCalculation(input) {
  resetUidCounter();

  const engine = createEngineState(input.taxYearTarget, input.ukOthersList || {});
  const rawTrades = cloneTrades(input.rawTrades || []);

  appendManualTrades(rawTrades, input.manualTrades || []);
  applyCorpActions(rawTrades, input.corpActions || []);

  for (const trade of rawTrades) {
    ingestTrade(trade, engine);
  }

  sortTrades(engine);
  populateLedger(engine);
  calculateDisposals(engine);
  generateRoundtrips(engine);
  buildAvailableTaxYears(engine);
  recalculateTaxYearData(engine);

  return snapshotResult(engine);
}

/**
 * Re-run only the tax-year slice of an existing calculation result.
 * @param {CalculationResult} result
 * @param {number} taxYearTarget
 * @returns {CalculationResult}
 */
export function recalculateForTaxYear(result, taxYearTarget) {
  const engine = {
    holdings: result.holdings,
    dividends: result.dividends,
    allRoundTrips: result.allRoundTrips,
    errorList: result.errorList.filter(
      (error) => !error.msg.includes('No data seen past the end of the tax year +30 days'),
    ),
    taxYear: {
      target: taxYearTarget,
      ...getTaxYearBounds(taxYearTarget),
      p30Seen: 0,
    },
    taxYearData: {
      realisedProfit: 0,
      realisedLoss: 0,
      disposals: 0,
      costs: 0,
      proceeds: 0,
      dividends: 0,
      roundTrips: [],
    },
  };

  recalculateTaxYearData(engine);

  return {
    ...result,
    taxYear: engine.taxYear,
    errorList: engine.errorList,
    taxYearData: engine.taxYearData,
  };
}

/**
 * @param {Object} engine
 * @returns {CalculationResult}
 */
function snapshotResult(engine) {
  return {
    holdings: engine.holdings,
    dividends: engine.dividends,
    deposits: engine.deposits,
    withdrawals: engine.withdrawals,
    errorList: engine.errorList,
    allRoundTrips: engine.allRoundTrips,
    availableTaxYears: engine.availableTaxYears,
    taxYearData: engine.taxYearData,
    taxYear: engine.taxYear,
    disposalCount: engine.disposalCount,
    realisedProfit: engine.realisedProfit,
    realisedLoss: engine.realisedLoss,
    realisedPl: engine.realisedPl,
    dividendsTotal: engine.dividendsTotal,
    dividendDetails: engine.dividendDetails,
  };
}

export { resetUidCounter } from './tax/uid.js';
