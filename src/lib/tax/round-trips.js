/**
 * @file round-trips.js
 * @brief Round-trip report generation from taxable ledger entries.
 */
import { safeMult, safeSub } from './decimal.js';
import { getDmyString } from './dates.js';

/**
 * @param {Object} engine
 */
export function generateRoundtrips(engine) {
  for (const key in engine.holdings) {
    const holding = engine.holdings[key];

    for (let j in holding.ledger) {
      const entry = holding.ledger[j];
      j = Number(j);

      if (entry.taxable) {
        const trip = {};

        if (entry.rule === 'Section 104') {
          trip.dateBought = '';
          trip.cost = safeMult(holding.ledger[j - 1].s104Price, Math.abs(entry.change)).toFixed(2);
        } else {
          const buy = getLedgerFromUid(entry.matchedUid, engine);
          trip.dateBought = getDmyString(buy.timestamp);
          trip.cost = safeMult(buy.price, Math.abs(entry.change)).toFixed(2);
        }

        trip.dateSold = getDmyString(entry.timestamp);
        trip.timestamp = entry.timestamp;
        trip.asset = holding.ticker;
        trip.name = holding.name;
        trip.amount = Math.abs(entry.change);
        trip.proceeds = safeMult(entry.price, Math.abs(entry.change)).toFixed(2);
        trip.gainLoss = safeSub(entry.gain, entry.loss).toFixed(2);
        trip.note = entry.rule;

        engine.allRoundTrips.push(trip);
      }
    }
  }

  engine.allRoundTrips.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * @param {number|string} uid
 * @param {Object} engine
 * @returns {Object|undefined}
 */
export function getLedgerFromUid(uid, engine) {
  for (const key in engine.holdings) {
    for (const entry of engine.holdings[key].ledger) {
      if (entry.uid === uid) {
        return entry;
      }
    }
  }
  return undefined;
}
