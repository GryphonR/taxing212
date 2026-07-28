/**
 * @file taxMath.js
 * @brief Pure tax calculation helpers shared by the Vue app and Node tests.
 *
 * Implements UK HMRC-aligned helpers for tax year boundaries, per-share
 * pricing (including incidental costs), and share-matching primitives.
 */
(function attachTaxMath(global) {
  /** @type {string} IANA timezone used for all UK tax year boundaries. */
  const UK_ZONE = "Europe/London";

  /** @type {number} Milliseconds in one calendar day for bed-and-breakfast windows. */
  const MS_PER_DAY = 1000 * 60 * 60 * 24;

  /**
   * @brief Resolve Luxon from browser globals or Node require().
   * @returns {object} Luxon module.
   */
  function getLuxon() {
    if (global.luxon) {
      return global.luxon;
    }
    if (typeof require === "function") {
      return require("luxon");
    }
    throw new Error("Luxon is required for TaxMath");
  }

  /**
   * @brief Sum allowable incidental acquisition/disposal costs (TCGA92/S38).
   * @param {number} stampDuty Stamp duty reserve tax in GBP.
   * @param {number} transactionFee Broker transaction fee in GBP.
   * @param {number} finraFee FINRA fee in GBP.
   * @param {number} frenchTransactionTax French transaction tax in GBP.
   * @returns {number} Total incidental costs in GBP.
   */
  function incidentalCosts(stampDuty, transactionFee, finraFee, frenchTransactionTax) {
    return (Number(stampDuty) || 0)
      + (Number(transactionFee) || 0)
      + (Number(finraFee) || 0)
      + (Number(frenchTransactionTax) || 0);
  }

  /**
   * @brief Compute UK tax year start, end, and end+30-day timestamps.
   * @param {number} targetYear Tax year start year (e.g. 2024 for 2024-25).
   * @returns {{start: number, end: number, p30: number}} Bounds as epoch milliseconds.
   */
  function getTaxYearBounds(targetYear) {
    const luxon = getLuxon();
    const startYear = Number(targetYear);
    const endYear = startYear + 1;

    const start = luxon.DateTime.fromObject(
      { year: startYear, month: 4, day: 6, hour: 0, minute: 0, second: 0, millisecond: 0 },
      { zone: UK_ZONE }
    );
    const end = luxon.DateTime.fromObject(
      { year: endYear, month: 4, day: 5, hour: 23, minute: 59, second: 59, millisecond: 999 },
      { zone: UK_ZONE }
    );

    return {
      start: start.toMillis(),
      end: end.toMillis(),
      p30: end.plus({ days: 30 }).toMillis()
    };
  }

  /**
   * @brief Parse a YYYY-MM-DD calendar string to UK start-of-day millis.
   * @param {string} dateString ISO calendar date from an HTML date input.
   * @returns {number} Epoch milliseconds at 00:00:00.000 UK local time, or NaN when invalid.
   */
  function ukCalendarDayStartMillis(dateString) {
    if (!dateString) {
      return NaN;
    }

    const luxon = getLuxon();
    const parts = String(dateString).split("-");
    if (parts.length !== 3) {
      return NaN;
    }

    const date = luxon.DateTime.fromObject(
      {
        year: Number(parts[0]),
        month: Number(parts[1]),
        day: Number(parts[2]),
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0
      },
      { zone: UK_ZONE }
    );

    return date.isValid ? date.toMillis() : NaN;
  }

  /**
   * @brief Parse a YYYY-MM-DD calendar string to UK end-of-day millis.
   * @param {string} dateString ISO calendar date from an HTML date input.
   * @returns {number} Epoch milliseconds at 23:59:59.999 UK local time, or NaN when invalid.
   */
  function ukCalendarDayEndMillis(dateString) {
    if (!dateString) {
      return NaN;
    }

    const luxon = getLuxon();
    const parts = String(dateString).split("-");
    if (parts.length !== 3) {
      return NaN;
    }

    const date = luxon.DateTime.fromObject(
      {
        year: Number(parts[0]),
        month: Number(parts[1]),
        day: Number(parts[2]),
        hour: 23,
        minute: 59,
        second: 59,
        millisecond: 999
      },
      { zone: UK_ZONE }
    );

    return date.isValid ? date.toMillis() : NaN;
  }

  /**
   * @brief Map a timestamp to the UK tax year it falls within.
   * @param {number} timestamp Epoch milliseconds.
   * @returns {number} Tax year start year.
   */
  function getTaxYearFromTimestamp(timestamp) {
    const luxon = getLuxon();
    const date = luxon.DateTime.fromMillis(timestamp, { zone: UK_ZONE });

    if (date.month < 4 || (date.month === 4 && date.day < 6)) {
      return date.year - 1;
    }
    return date.year;
  }

  /**
   * @brief Return the UK tax year that contains the current date.
   * @param {number} [now] Optional epoch milliseconds (defaults to Date.now()).
   * @returns {number} Tax year start year.
   */
  function getCurrentTaxYear(now) {
    return getTaxYearFromTimestamp(now != null ? now : Date.now());
  }

  /**
   * @brief Build a continuous ascending list of tax years from earliest data through today.
   *
   * Fills in intermediate years so the results-page dropdown matches the unbounded
   * step-2 picker: users can review any year between their first activity and now.
   *
   * @param {number[]} dataYears Tax years found in trade/dividend timestamps.
   * @param {number} [now] Optional epoch milliseconds for "today" (testing).
   * @returns {number[]} Ascending tax year start years, or [] when no data years.
   */
  function buildTaxYearRange(dataYears, now) {
    if (!dataYears || dataYears.length === 0) {
      return [];
    }

    const minYear = Math.min.apply(null, dataYears);
    const maxDataYear = Math.max.apply(null, dataYears);
    const currentTaxYear = getCurrentTaxYear(now);
    const maxYear = Math.max(maxDataYear, currentTaxYear);
    const years = [];

    for (let year = minYear; year <= maxYear; year++) {
      years.push(year);
    }

    return years;
  }

  /**
   * @brief Check whether a timestamp falls inside a tax year.
   * @param {number} timestamp Epoch milliseconds.
   * @param {{start: number, end: number}} bounds Tax year bounds.
   * @returns {boolean} True when inside the tax year (inclusive).
   */
  function inTaxYear(timestamp, bounds) {
    return timestamp >= bounds.start && timestamp <= bounds.end;
  }

  /**
   * @brief Compare two timestamps for same calendar day in the UK.
   * @param {number} ref Reference timestamp.
   * @param {number} test Timestamp to compare.
   * @returns {boolean} True when both fall on the same UK calendar day.
   */
  function sameDay(ref, test) {
    const luxon = getLuxon();
    const refDate = luxon.DateTime.fromMillis(ref, { zone: UK_ZONE });
    const testDate = luxon.DateTime.fromMillis(test, { zone: UK_ZONE });
    return refDate.hasSame(testDate, "day");
  }

  /**
   * @brief Compute per-share GBP price including incidental costs where needed.
   *
   * Uses Total (GBP) when present because it reflects actual cash consideration.
   * Falls back to price/exchange rate plus or minus per-share fees.
   *
   * @param {string} rawType "Buy" or "Sell".
   * @param {number} numberOfShares Number of shares in the trade.
   * @param {number} pricePerShare Price per share in trade currency.
   * @param {number} exchangeRate Exchange rate to GBP.
   * @param {number} totalGbp Total cash consideration in GBP.
   * @param {{stampDuty?: number, transactionFee?: number, finraFee?: number, frenchTransactionTax?: number}} fees Parsed fee fields.
   * @returns {number} Effective per-share price in GBP.
   */
  function effectivePricePerShare(rawType, numberOfShares, pricePerShare, exchangeRate, totalGbp, fees) {
    const shares = Math.abs(Number(numberOfShares) || 0);
    if (shares === 0) {
      return 0;
    }

    const total = Math.abs(Number(totalGbp) || 0);
    if (total > 0) {
      return total / shares;
    }

    const sharePriceGbp = (Number(pricePerShare) || 0) / (Number(exchangeRate) || 1);
    const feesPerShare = incidentalCosts(
      fees && fees.stampDuty,
      fees && fees.transactionFee,
      fees && fees.finraFee,
      fees && fees.frenchTransactionTax
    ) / shares;

    if (rawType === "Buy") {
      return sharePriceGbp + feesPerShare;
    }
    return Math.max(0, sharePriceGbp - feesPerShare);
  }

  /**
   * @brief Average per-share price after merging same-day ledger entries.
   * @param {number} existingChange Signed share change on the existing entry.
   * @param {number} existingPrice Existing per-share price in GBP.
   * @param {number} newChange Signed share change being merged in.
   * @param {number} newPrice Per-share price in GBP for the new entry.
   * @returns {number} Weighted average per-share price in GBP.
   */
  function mergeSameDayPrice(existingChange, existingPrice, newChange, newPrice) {
    const currentNotional = Math.abs(existingChange) * Math.abs(existingPrice);
    const newNotional = Math.abs(newChange) * Math.abs(newPrice);
    const mergedChange = existingChange + newChange;
    return (currentNotional + newNotional) / Math.abs(mergedChange);
  }

  /**
   * @brief Add shares to a Section 104 holding pool.
   * @param {number} prevTotal Existing pool quantity.
   * @param {number} prevPrice Existing average pool price.
   * @param {number} change Shares being added.
   * @param {number} price Per-share acquisition price.
   * @returns {{s104Total: number, s104Price: number}} Updated pool state.
   */
  function section104Add(prevTotal, prevPrice, change, price) {
    const s104Total = prevTotal + change;
    const totalCost = (prevTotal * prevPrice) + (change * price);
    return {
      s104Total: s104Total,
      s104Price: totalCost / s104Total
    };
  }

  /**
   * @brief Dispose shares from a Section 104 holding pool.
   * @param {number} s104Total Existing pool quantity.
   * @param {number} s104Price Existing average pool price.
   * @param {number} disposeQty Signed negative disposal quantity.
   * @param {number} sellPrice Per-share disposal price.
   * @returns {{gain: number, loss: number, newTotal: number, totalPnl: number}} Disposal result.
   */
  function section104Dispose(s104Total, s104Price, disposeQty, sellPrice) {
    const quantity = Math.abs(disposeQty);
    const totalPnl = (quantity * sellPrice) - (quantity * s104Price);

    return {
      gain: totalPnl > 0 ? totalPnl : 0,
      loss: totalPnl <= 0 ? Math.abs(totalPnl) : 0,
      newTotal: s104Total - quantity,
      totalPnl: totalPnl
    };
  }

  /**
   * @brief Check whether a sell/buy pair qualifies for the 30-day bed-and-breakfast rule.
   * @param {number} sellTimestamp Disposal timestamp.
   * @param {number} buyTimestamp Re-acquisition timestamp.
   * @returns {boolean} True when buy occurs 1-30 days after the sell.
   */
  function isWithinBedAndBreakfastWindow(sellTimestamp, buyTimestamp) {
    if (sellTimestamp >= buyTimestamp) {
      return false;
    }

    const daysBetween = (buyTimestamp - sellTimestamp) / MS_PER_DAY;
    return daysBetween <= 30;
  }

  /**
   * @brief Check whether the taxpayer was UK resident at a given timestamp.
   * @param {number} timestamp Epoch milliseconds to test.
   * @param {Array<{from: number, to: (number|null)}>} nonResidentPeriods Non-UK residence intervals.
   * @returns {boolean} True when UK resident (not inside a non-resident period).
   */
  function isUkResidentAt(timestamp, nonResidentPeriods) {
    if (!nonResidentPeriods || !nonResidentPeriods.length) {
      return true;
    }

    for (let i = 0; i < nonResidentPeriods.length; i++) {
      const period = nonResidentPeriods[i];
      const from = Number(period.from);
      const to = period.to == null || period.to === "" ? Number.POSITIVE_INFINITY : Number(period.to);

      if (!isNaN(from) && timestamp >= from && timestamp <= to) {
        return false;
      }
    }

    return true;
  }

  /**
   * @brief Check whether bed-and-breakfast matching applies to a sell/buy pair.
   * @param {number} sellTimestamp Disposal timestamp.
   * @param {number} buyTimestamp Re-acquisition timestamp.
   * @param {Array<{from: number, to: (number|null)}>} nonResidentPeriods Non-UK residence intervals.
   * @returns {boolean} True when inside the 30-day window and UK resident at re-acquisition.
   */
  function isBnbEligible(sellTimestamp, buyTimestamp, nonResidentPeriods) {
    return isWithinBedAndBreakfastWindow(sellTimestamp, buyTimestamp)
      && isUkResidentAt(buyTimestamp, nonResidentPeriods);
  }

  /**
   * @brief Compute same-day disposal gain or loss for a matched lot.
   * @param {number} sellQty Signed sell quantity (negative).
   * @param {number} sellPrice Per-share sell price in GBP.
   * @param {number} buyQty Signed buy quantity (positive).
   * @param {number} buyPrice Per-share buy price in GBP.
   * @returns {{gain: number, loss: number, totalPnl: number}} Matched gain/loss.
   */
  function sameDayGainLoss(sellQty, sellPrice, buyQty, buyPrice) {
    const matchedQty = Math.min(Math.abs(sellQty), Math.abs(buyQty));
    const totalPnl = (matchedQty * sellPrice) - (matchedQty * buyPrice);

    return {
      gain: totalPnl > 0 ? totalPnl : 0,
      loss: totalPnl <= 0 ? Math.abs(totalPnl) : 0,
      totalPnl: totalPnl
    };
  }

  /**
   * @brief Aggregate foreign dividend totals for the active tax year.
   * @param {Array<{timestamp: number, value: number, isUk: number, taxPaidGBP: number}>} dividends Parsed dividends.
   * @param {function(number): boolean} isInTaxYear Returns true when timestamp is in selected tax year.
   * @returns {{nonUk: number, taxPaid: number}} Foreign dividend totals.
   */
  function recalculateForeignDividendDetails(dividends, isInTaxYear) {
    let nonUk = 0;
    let taxPaid = 0;

    for (let i = 0; i < dividends.length; i++) {
      const dividend = dividends[i];
      if (!isInTaxYear(dividend.timestamp)) {
        continue;
      }
      if (!dividend.isUk) {
        nonUk += Number(dividend.value) || 0;
        taxPaid += Number(dividend.taxPaidGBP) || 0;
      }
    }

    return { nonUk: nonUk, taxPaid: taxPaid };
  }

  const TaxMath = {
    UK_ZONE: UK_ZONE,
    MS_PER_DAY: MS_PER_DAY,
    incidentalCosts: incidentalCosts,
    getTaxYearBounds: getTaxYearBounds,
    ukCalendarDayStartMillis: ukCalendarDayStartMillis,
    ukCalendarDayEndMillis: ukCalendarDayEndMillis,
    getTaxYearFromTimestamp: getTaxYearFromTimestamp,
    getCurrentTaxYear: getCurrentTaxYear,
    buildTaxYearRange: buildTaxYearRange,
    inTaxYear: inTaxYear,
    sameDay: sameDay,
    effectivePricePerShare: effectivePricePerShare,
    mergeSameDayPrice: mergeSameDayPrice,
    section104Add: section104Add,
    section104Dispose: section104Dispose,
    isWithinBedAndBreakfastWindow: isWithinBedAndBreakfastWindow,
    isUkResidentAt: isUkResidentAt,
    isBnbEligible: isBnbEligible,
    sameDayGainLoss: sameDayGainLoss,
    recalculateForeignDividendDetails: recalculateForeignDividendDetails
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = TaxMath;
  }
  global.TaxMath = TaxMath;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : global);
