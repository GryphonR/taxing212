/**
 * @file corp-actions.js
 * @brief Manual trade rows and retrospective corporate action application.
 */
import { getTradeValue } from '../parse/csv-normaliser.js';
import { safeDiv, safeMult } from './decimal.js';
import { getTimestamp } from './dates.js';

/**
 * @param {Record<string, unknown>[]} rawTrades
 * @param {Object[]} manualTrades
 */
export function appendManualTrades(rawTrades, manualTrades) {
  for (const mt of manualTrades) {
    rawTrades.push({
      action: mt.action,
      time: mt.date.replace('T', ' '),
      isin: '',
      ticker: mt.ticker,
      name: mt.name || mt.ticker,
      numberOfShares: mt.shares,
      pricePerShare: mt.price,
      currencyPricePerShare: 'GBP',
      exchangeRate: 1,
      resultGbp: 0,
      totalGbp: safeMult(mt.shares, mt.price),
      withholdingTax: 0,
      withholdingTaxCurrency: 'GBP',
      stampDutyReserveTaxGbp: 0,
      transactionFeeGbp: 0,
      finraFeeGbp: 0,
      notes: 'Manual Transfer',
      id: mt.uid,
      frenchTransactionTax: 0,
    });
  }
}

/**
 * @param {Record<string, unknown>[]} rawTrades
 * @param {Object[]} corpActions
 */
export function applyCorpActions(rawTrades, corpActions) {
  for (const action of corpActions) {
    const actionTime = new Date(action.date).getTime();

    for (const trade of rawTrades) {
      const tradeTime = getTimestamp(getTradeValue(trade, 'time', 1));
      const ticker = getTradeValue(trade, 'ticker', 3);

      if (tradeTime < actionTime && ticker === action.ticker) {
        if (action.type === 'Split') {
          trade.numberOfShares = safeMult(trade.numberOfShares, action.ratio);
          trade.pricePerShare = safeDiv(trade.pricePerShare, action.ratio);
        } else if (action.type === 'Rename') {
          trade.ticker = action.newTicker;
          trade.name = action.newName || trade.name;
        }
      }
    }
  }
}
