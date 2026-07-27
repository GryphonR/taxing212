/**
 * @file tax-year.js
 * @brief Tax-year filtering and summary recomputation.
 */
import { getTaxYearBounds, getTaxYearFromTimestamp, inTaxYear } from './dates.js';

/**
 * @param {Object} engine
 */
export function buildAvailableTaxYears(engine) {
  const taxYears = {};

  for (const ticker in engine.holdings) {
    for (const entry of engine.holdings[ticker].ledger) {
      if (!isNaN(entry.timestamp)) {
        taxYears[getTaxYearFromTimestamp(entry.timestamp)] = true;
      }
    }
  }

  for (const dividend of engine.dividends) {
    if (!isNaN(dividend.timestamp)) {
      taxYears[getTaxYearFromTimestamp(dividend.timestamp)] = true;
    }
  }

  engine.availableTaxYears = Object.keys(taxYears).map(Number).sort((a, b) => a - b);

  if (engine.availableTaxYears.length && engine.availableTaxYears.indexOf(engine.taxYear.target) < 0) {
    engine.taxYear.target = engine.availableTaxYears[engine.availableTaxYears.length - 1];
    const bounds = getTaxYearBounds(engine.taxYear.target);
    engine.taxYear.start = bounds.start;
    engine.taxYear.end = bounds.end;
    engine.taxYear.p30 = bounds.p30;
  }
}

/**
 * @param {Object} engine
 */
export function recalculateTaxYearData(engine) {
  const bounds = getTaxYearBounds(engine.taxYear.target);
  engine.taxYear.start = bounds.start;
  engine.taxYear.end = bounds.end;
  engine.taxYear.p30 = bounds.p30;
  engine.taxYear.p30Seen = 0;

  engine.errorList = engine.errorList.filter(
    (error) => !error.msg.includes('No data seen past the end of the tax year +30 days'),
  );

  engine.taxYearData = {
    realisedProfit: 0,
    realisedLoss: 0,
    disposals: 0,
    costs: 0,
    proceeds: 0,
    dividends: 0,
    roundTrips: [],
  };

  for (const key in engine.holdings) {
    const holding = engine.holdings[key];
    holding.tyData = {
      disposalCount: 0,
      realisedLoss: 0,
      realisedProfit: 0,
    };

    for (const entry of holding.ledger) {
      entry.inTaxYear = inTaxYear(entry.timestamp, engine.taxYear);

      if (entry.timestamp > engine.taxYear.p30) {
        engine.taxYear.p30Seen = 1;
      }

      if (entry.inTaxYear) {
        holding.tyData.realisedProfit += entry.gain;
        holding.tyData.realisedLoss += entry.loss;
        if (entry.change < 0) {
          holding.tyData.disposalCount++;
        }
      }
    }

    engine.taxYearData.realisedProfit += holding.tyData.realisedProfit;
    engine.taxYearData.realisedLoss += holding.tyData.realisedLoss;
    engine.taxYearData.disposals += holding.tyData.disposalCount;
  }

  for (const dividend of engine.dividends) {
    dividend.inTaxYear = inTaxYear(dividend.timestamp, engine.taxYear);

    if (dividend.timestamp > engine.taxYear.p30) {
      engine.taxYear.p30Seen = 1;
    }

    if (dividend.inTaxYear) {
      engine.taxYearData.dividends += dividend.value;
    }
  }

  for (const trip of engine.allRoundTrips) {
    if (inTaxYear(trip.timestamp, engine.taxYear)) {
      engine.taxYearData.roundTrips.push(trip);
      engine.taxYearData.proceeds += Number(trip.proceeds);
      engine.taxYearData.costs += Number(trip.cost);
    }
  }

  if (!engine.taxYear.p30Seen) {
    engine.errorList.push({
      msg: 'Caution - No data seen past the end of the tax year +30 days. This period is required for the 30 day BnB calculations if applicable',
      linkedUid: '',
    });
  }
}
