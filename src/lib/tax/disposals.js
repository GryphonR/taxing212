/**
 * @file disposals.js
 * @brief HMRC disposal matching: same-day, bed and breakfast, and Section 104.
 */
import { safeAdd, safeDiv, safeMult, safeSub } from './decimal.js';
import { inTaxYear, sameDay } from './dates.js';
import { getUID } from './uid.js';

/**
 * @param {Object} engine
 */
export function calculateDisposals(engine) {
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
