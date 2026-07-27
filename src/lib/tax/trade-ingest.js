/**
 * @file trade-ingest.js
 * @brief Import normalised CSV rows into holdings, deposits, and dividends.
 */
import { getTradeValue } from '../parse/csv-normaliser.js';
import { getNumber, safeDiv } from './decimal.js';
import { getTimestamp, inTaxYear } from './dates.js';
import { getUID } from './uid.js';

/**
 * @param {Record<string, unknown>} trade
 * @param {Object} engine
 */
export function ingestTrade(trade, engine) {
  const type = getTradeValue(trade, 'action', 0);
  const firstword = String(type).substr(0, String(type).indexOf(' '));

  if (type === 'Deposit') {
    newDeposit(trade, engine);
  } else if (type === 'Withdrawal') {
    newWithdrawal(trade, engine);
  } else if (firstword === 'Dividend') {
    newDividend(trade, engine);
  } else if (!isInstrumentTrade(trade)) {
    return;
  } else {
    newTrade(trade, engine);
  }
}

/**
 * @param {Record<string, unknown>} trade
 * @returns {boolean}
 */
export function isInstrumentTrade(trade) {
  const action = getTradeValue(trade, 'action', 0);
  if (action == null || action === '') {
    return false;
  }

  const actionLower = String(action).toLowerCase();
  if (!actionLower.includes('buy') && !actionLower.includes('sell')) {
    return false;
  }

  const ticker = getTradeValue(trade, 'ticker', 3);
  const isin = getTradeValue(trade, 'isin', 2);
  return ticker !== '' || isin !== '';
}

/**
 * @param {Record<string, unknown>} trade
 * @param {Object} engine
 */
function newDeposit(trade, engine) {
  const temp = {
    uid: getUID(),
    timestamp: getTimestamp(getTradeValue(trade, 'time', 1)),
    dateString: getTradeValue(trade, 'time', 1),
    value: getTradeValue(trade, 'totalGbp', 10),
  };

  if (getTradeValue(trade, 'notes', 17) === 'Free Shares Promotion') {
    engine.freeShares.push(temp);
  } else {
    engine.deposits.push(temp);
  }
}

/**
 * @param {Record<string, unknown>} trade
 * @param {Object} engine
 */
function newWithdrawal(trade, engine) {
  engine.withdrawals.push({
    uid: getUID(),
    timestamp: getTimestamp(getTradeValue(trade, 'time', 1)),
    dateString: getTradeValue(trade, 'time', 1),
    value: getTradeValue(trade, 'totalGbp', 10),
  });
}

/**
 * @param {Record<string, unknown>} trade
 * @param {Object} engine
 */
function newDividend(trade, engine) {
  const temp = {
    uid: getUID(),
    ticker: getTradeValue(trade, 'ticker', 3),
    name: getTradeValue(trade, 'name', 4),
    timestamp: getTimestamp(getTradeValue(trade, 'time', 1)),
    dateString: getTradeValue(trade, 'time', 1),
    value: Number(getTradeValue(trade, 'totalGbp', 10)),
    isUk: getTradeValue(trade, 'currencyPricePerShare', 7) === 'GBX' ? 1 : 0,
    taxCurrency: getTradeValue(trade, 'currencyPricePerShare', 7),
    taxPaid: getTradeValue(trade, 'withholdingTax', 11),
    taxPaidGBP: 0,
    exchangeRate: 0,
    ukCompany: 1,
    inTaxYear: inTaxYear(getTimestamp(getTradeValue(trade, 'time', 1)), engine.taxYear),
  };

  if (!temp.isUk) {
    if (temp.inTaxYear) {
      engine.dividendDetails.nonUk += temp.value;
    }
    if (getNumber(getTradeValue(trade, 'withholdingTax', 11)) > 0) {
      const exRate = (
        (getNumber(getTradeValue(trade, 'numberOfShares', 5)) * getNumber(getTradeValue(trade, 'pricePerShare', 6)))
        - getNumber(getTradeValue(trade, 'withholdingTax', 11))
      ) / getNumber(getTradeValue(trade, 'withholdingTax', 11));
      temp.taxPaidGBP = getNumber(getTradeValue(trade, 'withholdingTax', 11)) * exRate;
      temp.exchangeRate = exRate;
      if (temp.inTaxYear) {
        engine.dividendDetails.taxPaid += temp.taxPaidGBP;
      }
    }
  } else {
    temp.ukCompany = !divUkOthersCheck(temp.name, engine.ukOthersList);
  }

  if (temp.inTaxYear) {
    engine.taxYearData.dividends += temp.value;
  }
  if (temp.timestamp > engine.taxYear.p30) {
    engine.taxYear.p30Seen = 1;
  }

  engine.dividendsTotal += temp.value;
  engine.dividends.push(temp);
}

/**
 * @param {string} name
 * @param {Record<string, boolean>} ukOthersList
 * @returns {boolean}
 */
function divUkOthersCheck(name, ukOthersList) {
  return Object.prototype.hasOwnProperty.call(ukOthersList, name);
}

/**
 * @param {Record<string, unknown>} trade
 * @param {Object} engine
 */
function newTrade(trade, engine) {
  let rawTradeType = 'Sell';
  const ticker = getTradeValue(trade, 'ticker', 3);
  const name = getTradeValue(trade, 'name', 4);
  const isin = getTradeValue(trade, 'isin', 2);

  if (String(getTradeValue(trade, 'action', 0)).toLowerCase().includes('buy')) {
    rawTradeType = 'Buy';
  }

  const temp = {
    uid: getUID(),
    timestamp: getTimestamp(getTradeValue(trade, 'time', 1)),
    dateString: getTradeValue(trade, 'time', 1),
    orderType: getTradeValue(trade, 'action', 0),
    rawType: rawTradeType,
    value: getNumber(getTradeValue(trade, 'totalGbp', 10)),
    number: getNumber(getTradeValue(trade, 'numberOfShares', 5)),
    price: getNumber(getTradeValue(trade, 'pricePerShare', 6)),
    priceGBP: safeDiv(
      getNumber(getTradeValue(trade, 'pricePerShare', 6)),
      getNumber(getTradeValue(trade, 'exchangeRate', 8)) || 1,
    ),
    exchangeRate: getNumber(getTradeValue(trade, 'exchangeRate', 8)) || 1,
    result: getNumber(getTradeValue(trade, 'resultGbp', 9)),
    total: getNumber(getTradeValue(trade, 'totalGbp', 10)),
    withholdingTax: getNumber(getTradeValue(trade, 'withholdingTax', 11)),
    wthTaxCurrency: getTradeValue(trade, 'withholdingTaxCurrency', 12),
    stampDuty: getNumber(getTradeValue(trade, 'stampDutyReserveTaxGbp', 14)),
    transactionFee: getNumber(getTradeValue(trade, 'transactionFeeGbp', 15)),
    finraFee: getNumber(getTradeValue(trade, 'finraFeeGbp', 16)),
    notes: getTradeValue(trade, 'notes', 17),
    t212ID: getTradeValue(trade, 'id', 18),
    frenchTransactionTax: getNumber(getTradeValue(trade, 'frenchTransactionTax', 19)),
    wasFree: false,
    inLedger: 0,
  };

  if (!(ticker in engine.holdings)) {
    engine.holdings[ticker] = {
      uid: getUID(),
      ticker,
      isin,
      name,
      holdings: 0,
      averageCostPs: 0,
      realisedProfit: 0,
      realisedLoss: 0,
      realisedPl: 0,
      disposalCount: 0,
      tradeCount: 0,
      trades: [],
      ledger: [],
      disposals: [],
      tyData: {
        disposalCount: 0,
        realisedLoss: 0,
        realisedProfit: 0,
      },
      uiExpand: 0,
    };
  }

  engine.holdings[ticker].trades.push(temp);

  if (temp.rawType === 'Buy') {
    if (!isNaN(temp.number)) {
      engine.holdings[ticker].holdings += temp.number;
    }
    engine.holdings[ticker].tradeCount++;
  } else {
    if (!isNaN(temp.number)) {
      engine.holdings[ticker].holdings -= temp.number;
    }
    engine.holdings[ticker].disposalCount++;
    engine.holdings[ticker].tradeCount++;
  }
}

/**
 * @param {Object} engine
 */
export function sortTrades(engine) {
  for (const key in engine.holdings) {
    engine.holdings[key].trades.sort((a, b) => a.timestamp - b.timestamp);
  }

  engine.dividends.sort((a, b) => a.timestamp - b.timestamp);

  engine.holdings = Object.fromEntries(
    Object.entries(engine.holdings).sort(([, a], [, b]) => a.trades[0].timestamp - b.trades[0].timestamp),
  );
}
