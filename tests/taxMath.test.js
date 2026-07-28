/**
 * @file taxMath.test.js
 * @brief Node-based tests for HMRC-aligned tax calculation helpers.
 */
const assert = require("assert");
const { DateTime } = require("luxon");
const TaxMath = require("../Scripts/taxMath.js");

/** @returns {number} Epoch milliseconds for a UK local date/time. */
function ukMillis(year, month, day, hour, minute) {
  return DateTime.fromObject(
    { year: year, month: month, day: day, hour: hour || 0, minute: minute || 0 },
    { zone: TaxMath.UK_ZONE }
  ).toMillis();
}

let passed = 0;

/**
 * @brief Run a single assertion-backed test case.
 * @param {string} name Test description.
 * @param {function(): void} fn Test body.
 */
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

test("tax year includes all of 5 April in Europe/London", function () {
  const bounds = TaxMath.getTaxYearBounds(2024);
  const start = ukMillis(2024, 4, 6, 0, 0);
  const endOfYear = ukMillis(2025, 4, 5, 23, 59);
  const afterYear = ukMillis(2025, 4, 6, 0, 0);

  assert.strictEqual(bounds.start, start);
  assert.ok(TaxMath.inTaxYear(endOfYear, bounds));
  assert.ok(!TaxMath.inTaxYear(afterYear, bounds));
  assert.strictEqual(TaxMath.getTaxYearFromTimestamp(endOfYear), 2024);
  assert.strictEqual(TaxMath.getTaxYearFromTimestamp(afterYear), 2025);
});

test("effective price uses total GBP cash consideration per share", function () {
  const buyPrice = TaxMath.effectivePricePerShare("Buy", 100, 10, 1, -1015, {
    stampDuty: 5,
    transactionFee: 10,
    finraFee: 0,
    frenchTransactionTax: 0
  });

  assert.strictEqual(buyPrice, 10.15);

  const sellPrice = TaxMath.effectivePricePerShare("Sell", 50, 20, 1, 995, {
    stampDuty: 0,
    transactionFee: 5,
    finraFee: 0,
    frenchTransactionTax: 0
  });

  assert.strictEqual(sellPrice, 19.9);
});

test("effective price falls back to share price plus fees when total is missing", function () {
  const buyPrice = TaxMath.effectivePricePerShare("Buy", 10, 100, 1, 0, {
    stampDuty: 5,
    transactionFee: 5,
    finraFee: 0,
    frenchTransactionTax: 0
  });

  assert.strictEqual(buyPrice, 101);
});

test("same-day merge averages merged sell prices", function () {
  const mergedSellPrice = TaxMath.mergeSameDayPrice(-100, 10, -50, 12);
  assert.strictEqual(mergedSellPrice, 10.666666666666666);
});

test("same-day gain uses proceeds minus matched acquisition cost", function () {
  const result = TaxMath.sameDayGainLoss(-500, 7, 500, 7);
  assert.strictEqual(result.totalPnl, 0);
  assert.strictEqual(result.gain, 0);
  assert.strictEqual(result.loss, 0);
});

test("bed and breakfast requires UK residence at re-acquisition", function () {
  const sell = ukMillis(2024, 1, 1);
  const buy = ukMillis(2024, 1, 15);

  assert.ok(TaxMath.isBnbEligible(sell, buy, []));
  assert.ok(!TaxMath.isBnbEligible(sell, buy, [{ from: buy, to: buy }]));
});

test("non-resident period end date includes full UK calendar day", function () {
  const period = [{
    from: TaxMath.ukCalendarDayStartMillis("2024-03-10"),
    to: TaxMath.ukCalendarDayEndMillis("2024-03-12")
  }];
  const noonOnEndDay = ukMillis(2024, 3, 12, 12, 0);
  const startOfNextDay = ukMillis(2024, 3, 13, 0, 0);

  assert.ok(!TaxMath.isUkResidentAt(noonOnEndDay, period));
  assert.ok(TaxMath.isUkResidentAt(startOfNextDay, period));
});

test("calendar date helpers use UK timezone boundaries", function () {
  const start = TaxMath.ukCalendarDayStartMillis("2024-06-15");
  const end = TaxMath.ukCalendarDayEndMillis("2024-06-15");

  assert.strictEqual(start, ukMillis(2024, 6, 15, 0, 0));
  assert.strictEqual(end, ukMillis(2024, 6, 15, 23, 59) + 59999);
});

test("bed and breakfast window is inclusive at day 30", function () {
  const sell = ukMillis(2024, 1, 1, 12, 0);
  const buyDay30 = ukMillis(2024, 1, 31, 12, 0);
  const buyDay31 = ukMillis(2024, 2, 1, 12, 0);

  assert.ok(TaxMath.isWithinBedAndBreakfastWindow(sell, buyDay30));
  assert.ok(!TaxMath.isWithinBedAndBreakfastWindow(sell, buyDay31));
});

test("section 104 pool tracks weighted average cost", function () {
  const first = TaxMath.section104Add(0, 0, 1000, 2);
  assert.strictEqual(first.s104Total, 1000);
  assert.strictEqual(first.s104Price, 2);

  const second = TaxMath.section104Add(first.s104Total, first.s104Price, 1000, 2.4);
  assert.strictEqual(second.s104Total, 2000);
  assert.strictEqual(second.s104Price, 2.2);
});

test("ACCA share matching example totals gain of 2620", function () {
  const proceeds = 10000;
  const sellPrice = proceeds / 1200;
  const sameDayCost = 3000;
  const bedAndBreakfastCost = 3500;

  const sameDayGain = (500 * sellPrice) - sameDayCost;
  const bedAndBreakfastGain = (500 * sellPrice) - bedAndBreakfastCost;
  const section104 = TaxMath.section104Dispose(1000, 4.4, -200, sellPrice);
  const totalCost = sameDayCost + bedAndBreakfastCost + (200 * 4.4);
  const totalGain = sameDayGain + bedAndBreakfastGain + section104.totalPnl;

  assert.strictEqual(totalCost, 7380);
  assert.ok(Math.abs(totalGain - 2620) < 0.01);
});

test("foreign dividend totals respect selected tax year", function () {
  const bounds2024 = TaxMath.getTaxYearBounds(2024);
  const inTaxYear2024 = (timestamp) => TaxMath.inTaxYear(timestamp, bounds2024);

  const dividends = [
    {
      timestamp: ukMillis(2024, 8, 1),
      value: 100,
      isUk: 0,
      taxPaidGBP: 15
    },
    {
      timestamp: ukMillis(2025, 8, 1),
      value: 200,
      isUk: 0,
      taxPaidGBP: 30
    }
  ];

  const year2024 = TaxMath.recalculateForeignDividendDetails(dividends, inTaxYear2024);
  assert.strictEqual(year2024.nonUk, 100);
  assert.strictEqual(year2024.taxPaid, 15);
});

test("getCurrentTaxYear returns the UK tax year containing a timestamp", function () {
  const mid2025 = ukMillis(2025, 8, 1);
  const early2026 = ukMillis(2026, 3, 1);

  assert.strictEqual(TaxMath.getCurrentTaxYear(mid2025), 2025);
  assert.strictEqual(TaxMath.getCurrentTaxYear(early2026), 2025);
  assert.strictEqual(TaxMath.getCurrentTaxYear(ukMillis(2026, 4, 6)), 2026);
});

test("buildTaxYearRange fills years from earliest data through current tax year", function () {
  const now = ukMillis(2026, 7, 28);
  const range = TaxMath.buildTaxYearRange([2019, 2024], now);

  assert.deepStrictEqual(range, [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
});

test("buildTaxYearRange returns empty array when no data years", function () {
  assert.deepStrictEqual(TaxMath.buildTaxYearRange([]), []);
});

console.log(`\n${passed} tests passed`);
