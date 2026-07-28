/**
 * @file disposalEngine.js
 * @brief HMRC share-matching disposal engine (same-day, B&B, Section 104).
 */
(function attachDisposalEngine(global) {
  const TaxMath = global.TaxMath;

  /** @type {object} Default ledger entry prototype. */
  const LEDGER_PROTO = {
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
    matchedUid: "",
    rule: "",
    inTaxYear: 0,
    sdltPaid: 0
  };

  /**
   * @brief Default numeric helpers when Decimal.js is unavailable.
   */
  const DEFAULT_MATH = {
    safeAdd(a, b) { return (Number(a) || 0) + (Number(b) || 0); },
    safeSub(a, b) { return (Number(a) || 0) - (Number(b) || 0); },
    safeMult(a, b) { return (Number(a) || 0) * (Number(b) || 0); },
    safeDiv(a, b) {
      const divisor = Number(b) || 0;
      return divisor === 0 ? 0 : (Number(a) || 0) / divisor;
    }
  };

  /**
   * @brief Resolve math helpers from options or fall back to defaults.
   * @param {object} options Engine options.
   * @returns {object} Math helper functions.
   */
  function getMath(options) {
    return {
      safeAdd: (options && options.safeAdd) || DEFAULT_MATH.safeAdd,
      safeSub: (options && options.safeSub) || DEFAULT_MATH.safeSub,
      safeMult: (options && options.safeMult) || DEFAULT_MATH.safeMult,
      safeDiv: (options && options.safeDiv) || DEFAULT_MATH.safeDiv
    };
  }

  /**
   * @brief Assign gain or loss to a disposal ledger entry.
   * @param {object} sell Sell ledger entry.
   * @param {number} totalPnl Matched profit or loss.
   */
  function applyGainLossToSell(sell, totalPnl) {
    if (totalPnl > 0) {
      sell.gain = totalPnl;
      sell.loss = 0;
    } else {
      sell.gain = 0;
      sell.loss = Math.abs(totalPnl);
    }
    sell.totalPnl = totalPnl;
  }

  /**
   * @brief Merge same-day trades into ledger entries per holding.
   * @param {object} holdings Holdings keyed by ticker.
   * @param {object} options Engine options.
   */
  function populateLedger(holdings, options) {
    const getUID = options.getUID;
    const sameDay = options.sameDay || TaxMath.sameDay.bind(TaxMath);
    const math = getMath(options);

    for (let key in holdings) {
      const holding = holdings[key];

      for (let tradeKey in holding.trades) {
        const trade = holding.trades[tradeKey];

        if (!trade.inLedger) {
          const temp = JSON.parse(JSON.stringify(LEDGER_PROTO));
          temp.uid = getUID();
          temp.timestamp = trade.timestamp;
          temp.change = trade.rawType === "Buy" ? trade.number : -trade.number;
          temp.price = trade.priceGBP;
          temp.tradeCount = 1;
          temp.tradeIDs.push(trade.uid);
          holding.ledger.push(temp);
          trade.inLedger = 1;
        }

        const ledgerIndex = holding.ledger.length - 1;
        const currTradeType = trade.rawType;

        for (let i in holding.trades) {
          const compTrade = holding.trades[i];
          if (!compTrade.inLedger && compTrade.rawType === currTradeType && sameDay(trade.timestamp, compTrade.timestamp)) {
            holding.ledger[ledgerIndex].tradeIDs.push(compTrade.uid);
            holding.ledger[ledgerIndex].tradeCount++;

            const newTradeChange = compTrade.rawType === "Buy" ? compTrade.number : -compTrade.number;
            const previousChange = holding.ledger[ledgerIndex].change;
            holding.ledger[ledgerIndex].change = math.safeAdd(previousChange, newTradeChange);
            holding.ledger[ledgerIndex].price = TaxMath.mergeSameDayPrice(
              previousChange,
              holding.ledger[ledgerIndex].price,
              newTradeChange,
              compTrade.priceGBP
            );

            compTrade.inLedger = 1;
            if (holding.ledger[ledgerIndex].tradeCount > 2) {
              holding.ledger[ledgerIndex].comment.pop();
            }
            holding.ledger[ledgerIndex].comment.push(`${holding.ledger[ledgerIndex].tradeCount} trades merged for Same Day Rule.`);
          }
        }
      }
    }
  }

  /**
   * @brief Calculate matched disposal gains/losses for all holdings.
   * @param {object} holdings Holdings keyed by ticker.
   * @param {object} options Engine options.
   * @returns {{holdings: object, errorList: Array, aggregates: object, taxYear: object}} Results.
   */
  function calculateDisposals(holdings, options) {
    const getUID = options.getUID;
    const sameDay = options.sameDay || TaxMath.sameDay.bind(TaxMath);
    const inTaxYear = options.inTaxYear || function () { return 0; };
    const isBnbEligible = options.isBnbEligible || function (sellTs, buyTs) {
      return TaxMath.isBnbEligible(sellTs, buyTs, options.nonResidentPeriods || []);
    };
    const math = getMath(options);
    const errorList = options.errorList || [];
    const taxYear = options.taxYear || { p30: 0, p30Seen: 0 };
    const aggregates = {
      realisedPl: 0,
      realisedProfit: 0,
      realisedLoss: 0,
      disposalCount: 0,
      taxYearData: {
        realisedProfit: 0,
        realisedLoss: 0,
        disposals: 0
      }
    };

    for (let key in holdings) {
      const holding = holdings[key];
      holding.realisedPl = 0;
      holding.realisedProfit = 0;
      holding.realisedLoss = 0;
      holding.tyData = {
        disposalCount: 0,
        realisedLoss: 0,
        realisedProfit: 0
      };

      matchSameDayDisposals(holding, { getUID, sameDay, math });
      matchBedAndBreakfastDisposals(holding, { getUID, isBnbEligible, math });
      applySection104Matching(holding, { math, errorList, getUID });
      aggregateHoldingResults(holding, { inTaxYear, taxYear, aggregates });
    }

    if (!taxYear.p30Seen) {
      errorList.push({
        msg: "Caution - No data seen past the end of the tax year +30 days. This period is required for the 30 day BnB calculations if applicable",
        linkedUid: ""
      });
    }

    return {
      holdings: holdings,
      errorList: errorList,
      aggregates: aggregates,
      taxYear: taxYear
    };
  }

  /**
   * @brief Apply the same-day matching rule to a holding ledger.
   * @param {object} holding Holding with ledger entries.
   * @param {object} deps Helper dependencies.
   */
  function matchSameDayDisposals(holding, deps) {
    const getUID = deps.getUID;
    const sameDay = deps.sameDay;
    const math = deps.math;

    for (let i in holding.ledger) {
      const sell = holding.ledger[i];

      if (sell.change >= 0 || sell.counted) {
        continue;
      }

      for (let j in holding.ledger) {
        const buy = holding.ledger[j];
        if (!sameDay(sell.timestamp, buy.timestamp) || buy.change <= 0 || buy.counted) {
          continue;
        }

        if ((sell.change + buy.change) === 0) {
          const totalPnl = math.safeSub(
            math.safeMult(Math.abs(sell.change), sell.price),
            math.safeMult(buy.change, buy.price)
          );
          applyGainLossToSell(sell, totalPnl);
          sell.comment.push(`Same Day Disposal counted against buy ${buy.uid}`);
          sell.rule = "Same Day";
          sell.taxable = 1;
          sell.matchedUid = buy.uid;
          sell.counted = 1;
          buy.counted = 1;
        } else if (Math.abs(sell.change) > buy.change) {
          sell.comment.push(`Entry split for sameday rule matching Buy entry #${buy.uid}`);
          const sellCopy = JSON.parse(JSON.stringify(sell));
          sellCopy.uid = getUID();
          sell.change = -buy.change;
          sellCopy.change = math.safeSub(sellCopy.change, sell.change);
          holding.ledger.splice(i, 0, sellCopy);

          const totalPnl = math.safeSub(
            math.safeMult(Math.abs(sell.change), sell.price),
            math.safeMult(buy.change, buy.price)
          );
          applyGainLossToSell(sell, totalPnl);
          sell.comment.push(`Same Day Disposal counted against buy ${buy.uid}`);
          sell.rule = "Same Day";
          sell.taxable = 1;
          sell.matchedUid = buy.uid;
          sell.counted = 1;
          buy.counted = 1;
        } else {
          buy.comment.push(`Entry split for sameday rule matching Sell entry #${sell.uid}`);
          const buyCopy = JSON.parse(JSON.stringify(buy));
          buyCopy.uid = getUID();
          buy.change = Math.abs(sell.change);
          buyCopy.change = math.safeSub(buyCopy.change, buy.change);

          const totalPnl = math.safeSub(
            math.safeMult(Math.abs(sell.change), sell.price),
            math.safeMult(buy.change, buy.price)
          );
          applyGainLossToSell(sell, totalPnl);
          sell.comment.push(`Same Day Disposal counted against buy ${buy.uid}`);
          sell.rule = "Same Day";
          sell.taxable = 1;
          sell.matchedUid = buy.uid;
          holding.ledger.splice(j, 0, buyCopy);
          sell.counted = 1;
          buy.counted = 1;
        }
      }
    }
  }

  /**
   * @brief Apply the 30-day bed-and-breakfast matching rule to a holding ledger.
   * @param {object} holding Holding with ledger entries.
   * @param {object} deps Helper dependencies.
   */
  function matchBedAndBreakfastDisposals(holding, deps) {
    const getUID = deps.getUID;
    const isBnbEligible = deps.isBnbEligible;
    const math = deps.math;

    for (let i in holding.ledger) {
      const buy = holding.ledger[i];
      if (buy.change <= 0 || buy.counted) {
        continue;
      }

      for (let j in holding.ledger) {
        const sell = holding.ledger[j];
        if (sell.change >= 0 || sell.counted || !isBnbEligible(sell.timestamp, buy.timestamp)) {
          continue;
        }

        if (sell.change + buy.change === 0) {
          sell.counted = 1;
          sell.comment.push(`30 day BnB rule, counted against Buy #${buy.uid}`);
          buy.counted = 1;
          buy.comment.push(`30 day BnB rule, counted against Sell #${sell.uid}`);

          const totalPnl = math.safeSub(
            math.safeMult(Math.abs(sell.change), sell.price),
            math.safeMult(buy.change, buy.price)
          );
          applyGainLossToSell(sell, totalPnl);
          sell.rule = "30 Day BnB";
          sell.taxable = 1;
          sell.matchedUid = buy.uid;
        } else if (sell.change + buy.change < 0) {
          const sellCopy = JSON.parse(JSON.stringify(sell));
          sellCopy.uid = getUID();

          sell.change = -buy.change;
          sellCopy.change = math.safeSub(sellCopy.change, sell.change);
          sell.counted = 1;
          buy.counted = 1;
          buy.comment.push(`30 day BnB rule, counted against Sell #${sell.uid}`);
          sell.comment.push(`Entry split into #${sellCopy.uid} for 30 day rule matching Buy entry #${buy.uid}`);

          const totalPnl = math.safeSub(
            math.safeMult(Math.abs(sell.change), sell.price),
            math.safeMult(buy.change, buy.price)
          );
          applyGainLossToSell(sell, totalPnl);
          sell.rule = "30 Day BnB";
          sell.taxable = 1;
          sell.matchedUid = buy.uid;
          sell.comment.push(`30 day BnB rule, counted against Buy #${buy.uid}`);

          holding.ledger.splice(Number(j) + 1, 0, sellCopy);
          break;
        } else if (sell.change + buy.change > 0) {
          const buyCopy = JSON.parse(JSON.stringify(buy));
          buyCopy.uid = getUID();

          buy.change = -(sell.change);
          buyCopy.change = math.safeSub(buyCopy.change, buy.change);
          sell.counted = 1;
          buy.counted = 1;
          buy.comment.push(`Entry split into #${buyCopy.uid} for 30 day rule and matched to Sell entry #${sell.uid}`);
          sell.comment.push(`30 day BnB rule, counted against Buy #${buy.uid}`);

          const totalPnl = math.safeSub(
            math.safeMult(Math.abs(sell.change), sell.price),
            math.safeMult(buy.change, buy.price)
          );
          applyGainLossToSell(sell, totalPnl);
          sell.rule = "30 Day BnB";
          sell.taxable = 1;
          sell.matchedUid = buy.uid;

          holding.ledger.splice(Number(i) + 1, 0, buyCopy);
          break;
        }
      }
    }
  }

  /**
   * @brief Apply Section 104 pool matching for remaining unmatched ledger entries.
   * @param {object} holding Holding with ledger entries.
   * @param {object} deps Helper dependencies.
   */
  function applySection104Matching(holding, deps) {
    const math = deps.math;
    const errorList = deps.errorList;

    for (let i in holding.ledger) {
      const entry = holding.ledger[i];
      const index = Number(i);

      if (entry.change > 0) {
        if (!entry.counted) {
          if (index === 0) {
            entry.s104Total = entry.change;
            entry.s104Price = entry.price;
          } else {
            entry.s104Total = math.safeAdd(holding.ledger[index - 1].s104Total, entry.change);
            const totalCost = math.safeAdd(
              math.safeMult(holding.ledger[index - 1].s104Total, holding.ledger[index - 1].s104Price),
              math.safeMult(entry.change, entry.price)
            );
            entry.s104Price = math.safeDiv(totalCost, entry.s104Total);
          }
          entry.comment.push("Added to Section 104 holdings.");
        } else if (index > 0) {
          entry.s104Total = Number(holding.ledger[index - 1].s104Total);
          entry.s104Price = Number(holding.ledger[index - 1].s104Price);
        }
      } else if (entry.change < 0) {
        if (!entry.counted) {
          if (index === 0) {
            errorList.push({
              msg: `Error - no history of holdings for disposal #${entry.uid} of ${holding.name}.`,
              linkedUid: entry.uid
            });
          } else if (Number(Math.abs(entry.change).toFixed(2)) > Number(holding.ledger[index - 1].s104Total.toFixed(2))) {
            errorList.push({
              msg: `Error - Sale exceeds recorded Section 104 holdings for disposal #${entry.uid} of ${holding.name}. Check for missing trade history, in-specie transfers, corporate actions, or free shares.`,
              linkedUid: entry.uid
            });
          } else {
            const totalPnl = math.safeSub(
              math.safeMult(Math.abs(entry.change), entry.price),
              math.safeMult(Math.abs(entry.change), holding.ledger[index - 1].s104Price)
            );
            entry.s104Total = math.safeSub(holding.ledger[index - 1].s104Total, Math.abs(entry.change));
            applyGainLossToSell(entry, totalPnl);
            entry.rule = "Section 104";
            entry.taxable = 1;
            entry.matchedUid = "Section 104";
            entry.s104Price = holding.ledger[index - 1].s104Price;
            entry.comment.push("Gain calculated against Section 104 Holdings");
          }
        } else if (index > 0) {
          entry.s104Total = Number(holding.ledger[index - 1].s104Total);
          entry.s104Price = Number(holding.ledger[index - 1].s104Price);
        }
      }
    }
  }

  /**
   * @brief Roll up realised gains/losses for a holding and tax-year aggregates.
   * @param {object} holding Holding with processed ledger entries.
   * @param {object} deps Helper dependencies.
   */
  function aggregateHoldingResults(holding, deps) {
    const inTaxYear = deps.inTaxYear;
    const taxYear = deps.taxYear;
    const aggregates = deps.aggregates;

    for (let i in holding.ledger) {
      const entry = holding.ledger[i];
      entry.inTaxYear = inTaxYear(entry.timestamp);

      if (entry.timestamp > taxYear.p30) {
        taxYear.p30Seen = 1;
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

    aggregates.taxYearData.realisedProfit += holding.tyData.realisedProfit;
    aggregates.taxYearData.realisedLoss += holding.tyData.realisedLoss;
    aggregates.taxYearData.disposals += holding.tyData.disposalCount;
    aggregates.realisedPl += Number(holding.realisedPl);
    aggregates.realisedLoss += Number(holding.realisedLoss);
    aggregates.realisedProfit += Number(holding.realisedProfit);
    aggregates.disposalCount += Number(holding.disposalCount);
  }

  const DisposalEngine = {
    LEDGER_PROTO: LEDGER_PROTO,
    populateLedger: populateLedger,
    calculateDisposals: calculateDisposals
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = DisposalEngine;
  }
  global.DisposalEngine = DisposalEngine;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : global);
