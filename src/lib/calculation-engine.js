/**
 * @file calculation-engine.js
 * @brief Pure tax-calculation engine extracted from the Vue application layer.
 */
import { getTradeValue } from './parse/csv-normaliser.js';
import { getNumber, safeAdd, safeDiv, safeMult, safeSub } from './tax/decimal.js';
import {
  getDmyString,
  getTaxYearBounds,
  getTaxYearFromTimestamp,
  getTimestamp,
  inTaxYear,
  sameDay,
} from './tax/dates.js';

/** @type {number} Monotonic ledger UID counter, reset per runCalculation call. */
let uidCounter = 0;

/**
 * Reset the global UID counter so repeated test runs stay deterministic.
 */
export function resetUidCounter() {
  uidCounter = 0;
}

/**
 * @returns {number} Next unique ledger / trade identifier.
 */
function getUID() {
  return uidCounter++;
}

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

  appendManualTrades(rawTrades, input.manualTrades || [], engine);
  applyCorpActions(rawTrades, input.corpActions || [], engine);

  for (const trade of rawTrades) {
    ingestTrade(trade, engine);
  }

  sortTrades(engine);
  populateLedger(engine);
  calculateDisposals(engine);
  generateRoundtrips(engine);
  buildAvailableTaxYears(engine);
  recalculateTaxYearData(engine);

  return {
    holdings: engine.holdings,
    dividends: engine.dividends,
    deposits: engine.deposits,
    withdrawals: engine.withdrawals,
    errorList: engine.errorList,
    allRoundTrips: engine.allRoundTrips,
    availableTaxYears: engine.availableTaxYears,
    taxYearData: engine.taxYearData,
    disposalCount: engine.disposalCount,
    realisedProfit: engine.realisedProfit,
    realisedLoss: engine.realisedLoss,
    realisedPl: engine.realisedPl,
    dividendsTotal: engine.dividendsTotal,
    dividendDetails: engine.dividendDetails,
  };
}

/**
 * @param {number} taxYearTarget
 * @param {Record<string, boolean>} ukOthersList
 * @returns {Object}
 */
function createEngineState(taxYearTarget, ukOthersList) {
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
function cloneTrades(trades) {
  return trades.map((trade) => ({ ...trade }));
}

/**
 * @param {Record<string, unknown>[]} rawTrades
 * @param {Object[]} manualTrades
 * @param {Object} engine
 */
function appendManualTrades(rawTrades, manualTrades, engine) {
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
 * @param {Object} engine
 */
function applyCorpActions(rawTrades, corpActions, engine) {
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

/**
 * @param {Record<string, unknown>} trade
 * @param {Object} engine
 */
function ingestTrade(trade, engine) {
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
function isInstrumentTrade(trade) {
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
function sortTrades(engine) {
  for (const key in engine.holdings) {
    engine.holdings[key].trades.sort((a, b) => a.timestamp - b.timestamp);
  }

  engine.dividends.sort((a, b) => a.timestamp - b.timestamp);

  engine.holdings = Object.fromEntries(
    Object.entries(engine.holdings).sort(([, a], [, b]) => a.trades[0].timestamp - b.trades[0].timestamp),
  );
}

/**
 * @param {Object} engine
 */
function populateLedger(engine) {
  const ledgerProto = {
    uid: 0,
    timestamp: 0,
    change: 0,
    price: 0,
    exchangeRate: 0,
    tradeCount: 0,
    tradeIDs: [],
    comment: [],
    counted: 0,
    gain: 0,
    loss: 0,
    totalPnl: 0,
    s104Total: 0,
    s104Price: 0,
    taxable: 0,
    matchedUid: '',
    rule: '',
    inTaxYear: 0,
    sdltPaid: 0,
  };

  for (const key in engine.holdings) {
    const holding = engine.holdings[key];

    for (const tradeKey in holding.trades) {
      const trade = holding.trades[tradeKey];

      if (!trade.inLedger) {
        const temp = JSON.parse(JSON.stringify(ledgerProto));
        temp.uid = getUID();
        temp.timestamp = trade.timestamp;
        temp.change = trade.rawType === 'Buy' ? trade.number : -trade.number;
        temp.price = trade.priceGBP;
        temp.tradeCount = 1;
        temp.tradeIDs.push(trade.uid);
        holding.ledger.push(temp);
        trade.inLedger = 1;
      }

      const ledgerIndex = holding.ledger.length - 1;
      const currTradeType = trade.rawType;

      for (const i in holding.trades) {
        const compTrade = holding.trades[i];
        if (!compTrade.inLedger) {
          if (compTrade.rawType === currTradeType) {
            if (sameDay(trade.timestamp, compTrade.timestamp)) {
              holding.ledger[ledgerIndex].tradeIDs.push(compTrade.uid);
              holding.ledger[ledgerIndex].tradeCount++;

              const currNP = safeMult(holding.ledger[ledgerIndex].change, holding.ledger[ledgerIndex].price);
              const newTradeChange = compTrade.rawType === 'Buy' ? compTrade.number : -compTrade.number;
              const newNP = safeMult(Math.abs(newTradeChange), Math.abs(compTrade.priceGBP));

              holding.ledger[ledgerIndex].change = safeAdd(holding.ledger[ledgerIndex].change, newTradeChange);
              holding.ledger[ledgerIndex].priceGBP = safeDiv(
                safeAdd(currNP, newNP),
                Math.abs(holding.ledger[ledgerIndex].change),
              );

              compTrade.inLedger = 1;
              if (holding.ledger[ledgerIndex].tradeCount > 2) {
                holding.ledger[ledgerIndex].comment.pop();
              }
              holding.ledger[ledgerIndex].comment.push(
                `${holding.ledger[ledgerIndex].tradeCount} trades merged for Same Day Rule.`,
              );
            }
          }
        }
      }
    }
  }
}

/**
 * @param {Object} engine
 */
function calculateDisposals(engine) {
  for (const key in engine.holdings) {
    const holding = engine.holdings[key];

    applySameDayDisposals(holding, engine);
    applyBedAndBreakfastDisposals(holding, engine);
    applySection104Disposals(holding, engine);
    aggregateHoldingTotals(holding, engine);
  }

  if (!engine.taxYear.p30Seen) {
    engine.errorList.push({
      msg: 'Caution - No data seen past the end of the tax year +30 days. This period is required for the 30 day BnB calculations if applicable',
      linkedUid: '',
    });
  }
}

/**
 * @param {Object} holding
 * @param {Object} engine
 */
function applySameDayDisposals(holding, engine) {
  for (const i in holding.ledger) {
    const sell = holding.ledger[i];

    if (sell.change < 0 && !sell.counted) {
      for (const j in holding.ledger) {
        const buy = holding.ledger[j];
        if (sameDay(sell.timestamp, buy.timestamp) && buy.change > 0 && !buy.counted) {
          if ((sell.change + buy.change) === 0) {
            const tmp = safeSub(safeMult(Math.abs(sell.change), sell.price), safeMult(buy.change, buy.price));
            if (tmp > 0) {
              sell.gain = tmp;
            } else {
              sell.loss = Math.abs(tmp);
            }
            sell.comment.push(`Same Day Disposal counted against buy ${buy.uid}`);
            sell.rule = 'Same Day';
            sell.totalPnl = tmp;
            sell.taxable = 1;
            sell.matchedUid = buy.uid;
            sell.counted = 1;
            buy.counted = 1;
          } else if (Math.abs(sell.change) > buy.change) {
            sell.comment.push(`Entry split for sameday rule matching Buy entry #${buy.uid}`);
            const sellCopy = JSON.parse(JSON.stringify(sell));
            sellCopy.uid = getUID();
            sell.change = -buy.change;
            sellCopy.change = safeSub(sellCopy.change, sell.change);

            const tmp = safeSub(safeMult(Math.abs(sell.change), sell.price), safeMult(buy.change, buy.price));
            if (tmp > 0) {
              sell.gain = tmp;
            } else {
              sell.loss = Math.abs(tmp);
            }

            sell.comment.push(`Same Day Disposal counted against buy ${buy.uid}`);
            sell.rule = 'Same Day';
            sell.totalPnl = tmp;
            sell.taxable = 1;
            sell.matchedUid = buy.uid;
            sell.counted = 1;
            buy.counted = 1;
            holding.ledger.splice(i, 0, sellCopy);
          } else {
            buy.comment.push(`Entry split for sameday rule matching Sell entry #${sell.uid}`);
            const buyCopy = JSON.parse(JSON.stringify(buy));
            buyCopy.uid = getUID();
            buy.change = Math.abs(sell.change);
            buyCopy.change = safeSub(buyCopy.change, buy.change);

            const tmp = safeSub(safeMult(Math.abs(sell.change), sell.price), safeMult(buy.change, buy.price));
            if (tmp > 0) {
              sell.gain = tmp;
            } else {
              sell.loss = Math.abs(tmp);
            }

            sell.comment.push(`Same Day Disposal counted against buy ${buy.uid}`);
            sell.rule = 'Same Day';
            sell.totalPnl = tmp;
            sell.taxable = 1;
            sell.matchedUid = buy.uid;
            holding.ledger.splice(j, 0, buyCopy);
            sell.counted = 1;
            buy.counted = 1;
          }
        }
      }
    }
  }
}

/**
 * @param {Object} holding
 * @param {Object} engine
 */
function applyBedAndBreakfastDisposals(holding, engine) {
  for (const i in holding.ledger) {
    const buy = holding.ledger[i];

    if (buy.change > 0 && !buy.counted) {
      const thirtyDays = 1000 * 60 * 60 * 24 * 30;
      const cutOff = buy.timestamp - thirtyDays;

      for (const j in holding.ledger) {
        const sell = holding.ledger[j];
        if (sell.change < 0 && !sell.counted) {
          if (sell.timestamp > cutOff && sell.timestamp < buy.timestamp) {
            if (sell.change + buy.change === 0) {
              sell.counted = 1;
              sell.comment.push(`30 day BnB rule, counted against Buy #${buy.uid}`);
              buy.counted = 1;
              buy.comment.push(`30 day BnB rule, counted against Sell #${sell.uid}`);

              const tmp = safeSub(safeMult(Math.abs(sell.change), sell.price), safeMult(buy.change, buy.price));
              if (tmp > 0) {
                buy.gain = tmp;
              } else {
                buy.loss = Math.abs(tmp);
              }

              sell.rule = '30 Day BnB';
              sell.totalPnl = tmp;
              sell.taxable = 1;
              sell.matchedUid = buy.uid;
            } else if (sell.change + buy.change < 0) {
              const sellCopy = JSON.parse(JSON.stringify(sell));
              sellCopy.uid = getUID();

              sell.change = -buy.change;
              sellCopy.change = safeSub(sellCopy.change, sell.change);
              sell.counted = 1;
              buy.counted = 1;
              buy.comment.push(`30 day BnB rule, counted against Sell #${sell.uid}`);
              sell.comment.push(`Entry split into #${sellCopy.uid} for 30 day rule matching Buy entry #${buy.uid}`);

              const tmp = safeSub(safeMult(Math.abs(sell.change), sell.price), safeMult(buy.change, buy.price));
              if (tmp > 0) {
                sell.gain = tmp;
              } else {
                sell.loss = Math.abs(tmp);
              }

              sell.rule = '30 Day BnB';
              sell.totalPnl = tmp;
              sell.taxable = 1;
              sell.matchedUid = buy.uid;
              sell.comment.push(`30 day BnB rule, counted against Buy #${buy.uid}`);

              const newPos = Number(j) + 1;
              holding.ledger.splice(newPos, 0, sellCopy);
              break;
            } else if (sell.change + buy.change > 0) {
              const buyCopy = JSON.parse(JSON.stringify(buy));
              buyCopy.uid = getUID();

              buy.change = -(sell.change);
              buyCopy.change = safeSub(buyCopy.change, buy.change);
              sell.counted = 1;
              buy.counted = 1;
              buy.comment.push(`Entry split into #${buyCopy.uid} for 30 day rule and matched to Sell entry #${sell.uid}`);
              sell.comment.push(`30 day BnB rule, counted against Buy #${buy.uid}`);

              const tmp = safeSub(safeMult(Math.abs(sell.change), sell.price), safeMult(buy.change, buy.price));
              if (tmp > 0) {
                sell.gain = tmp;
              } else {
                sell.loss = Math.abs(tmp);
              }

              sell.rule = '30 Day BnB';
              sell.totalPnl = tmp;
              sell.taxable = 1;
              sell.matchedUid = buy.uid;

              const newPos = Number(i) + 1;
              holding.ledger.splice(newPos, 0, buyCopy);
              break;
            }
          }
        }
      }
    }
  }
}

/**
 * @param {Object} holding
 * @param {Object} engine
 */
function applySection104Disposals(holding, engine) {
  for (let i in holding.ledger) {
    let entry = holding.ledger[i];
    i = Number(i);

    if (entry.change > 0) {
      if (!entry.counted) {
        if (i === 0) {
          entry.s104Total = entry.change;
          entry.s104Price = entry.price;
        } else {
          entry.s104Total = safeAdd(holding.ledger[i - 1].s104Total, entry.change);
          const totalCost = safeAdd(
            safeMult(holding.ledger[i - 1].s104Total, holding.ledger[i - 1].s104Price),
            safeMult(entry.change, entry.price),
          );
          entry.s104Price = safeDiv(totalCost, entry.s104Total);
        }
        entry.comment.push('Added to Section 104 holdings.');
      } else if (i > 0) {
        entry.s104Total = Number(holding.ledger[i - 1].s104Total);
        entry.s104Price = Number(holding.ledger[i - 1].s104Price);
      }
    } else if (entry.change < 0) {
      if (!entry.counted) {
        if (i === 0) {
          engine.errorList.push({
            msg: `Error - no history of holdings for disposal #${entry.uid} of ${holding.name}.`,
            linkedUid: entry.uid,
          });
        } else if (Number(Math.abs(entry.change).toFixed(2)) > Number((holding.ledger[i - 1].s104Total).toFixed(2))) {
          engine.errorList.push({
            msg: `Error - Sale exceeds S401 Holdings for disposal ${entry.uid} of ${holding.name}.`,
            linkedUid: entry.uid,
          });
        } else {
          const tmp = safeSub(
            safeMult(Math.abs(entry.change), entry.price),
            safeMult(Math.abs(entry.change), holding.ledger[i - 1].s104Price),
          );
          entry.s104Total = safeSub(holding.ledger[i - 1].s104Total, Math.abs(entry.change));
          if (tmp > 0) {
            entry.gain = tmp;
          } else {
            entry.loss = Math.abs(tmp);
          }
          entry.rule = 'Section 104';
          entry.totalPnl = tmp;
          entry.taxable = 1;
          entry.matchedUid = 'Section 104';
          entry.s104Price = holding.ledger[i - 1].s104Price;
          entry.comment.push('Gain calculated against Section 104 Holdings');
        }
      } else if (i > 0) {
        entry.s104Total = Number(holding.ledger[i - 1].s104Total);
        entry.s104Price = Number(holding.ledger[i - 1].s104Price);
      }
    }
  }
}

/**
 * @param {Object} holding
 * @param {Object} engine
 */
function aggregateHoldingTotals(holding, engine) {
  for (const i in holding.ledger) {
    const entry = holding.ledger[i];
    entry.inTaxYear = inTaxYear(entry.timestamp, engine.taxYear);

    if (entry.timestamp > engine.taxYear.p30) {
      engine.taxYear.p30Seen = 1;
    }

    holding.realisedPl += entry.totalPnl;
    holding.realisedProfit += entry.gain;
    holding.realisedLoss += entry.loss;

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

  engine.realisedPl += Number(holding.realisedPl);
  engine.realisedLoss += Number(holding.realisedLoss);
  engine.realisedProfit += Number(holding.realisedProfit);
  engine.disposalCount += Number(holding.disposalCount);
}

/**
 * @param {Object} engine
 */
function generateRoundtrips(engine) {
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
function getLedgerFromUid(uid, engine) {
  for (const key in engine.holdings) {
    for (const entry of engine.holdings[key].ledger) {
      if (entry.uid === uid) {
        return entry;
      }
    }
  }
  return undefined;
}

/**
 * @param {Object} engine
 */
function buildAvailableTaxYears(engine) {
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
function recalculateTaxYearData(engine) {
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

/**
 * Re-run only the tax-year slice of an existing calculation result.
 * Mirrors the Vue tax-year dropdown behaviour.
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
    errorList: engine.errorList,
    taxYearData: engine.taxYearData,
  };
}
