/**
 * @file engine-state.js
 * @brief Initial state factory for a calculation run.
 */
import { getTaxYearBounds } from './dates.js';

/**
 * @param {number} taxYearTarget
 * @param {Record<string, boolean>} ukOthersList
 * @returns {Object}
 */
export function createEngineState(taxYearTarget, ukOthersList) {
  const bounds = getTaxYearBounds(taxYearTarget);

  return {
    ukOthersList,
    taxYear: {
      target: taxYearTarget,
      start: bounds.start,
      end: bounds.end,
      p30: bounds.p30,
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
    allRoundTrips: [],
    availableTaxYears: [],
    errorList: [],
    disposalCount: 0,
    realisedProfit: 0,
    realisedLoss: 0,
    realisedPl: 0,
    deposits: [],
    withdrawals: [],
    dividends: [],
    dividendsTotal: 0,
    dividendDetails: {
      uk: 0,
      nonUk: 0,
      taxPaid: 0,
    },
    freeShares: [],
    holdings: {},
  };
}

/**
 * @param {Record<string, unknown>[]} trades
 * @returns {Record<string, unknown>[]}
 */
export function cloneTrades(trades) {
  return trades.map((trade) => ({ ...trade }));
}
