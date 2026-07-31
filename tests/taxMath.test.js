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

/**
 * @brief Reproduce the pre-fix FX bug: net foreign cash mislabelled as GBP tax.
 * Old code: taxPaidGBP = withholding * ((gross - withholding) / withholding) = net foreign.
 */
function buggyForeignTaxAsNetForeign(shares, pricePerShare, withholdingTax) {
  const gross = shares * pricePerShare;
  const withholding = withholdingTax;
  const exRate = (gross - withholding) / withholding;
  return withholding * exRate;
}

test("foreignWithholdingTaxGbp uses CSV exchange rate when present", function () {
  // $1.50 withheld at 1.25 USD/GBP → £1.20
  const result = TaxMath.foreignWithholdingTaxGbp(100, 0.1, 1.5, 6.8, 1.25);
  assert.ok(Math.abs(result.taxPaidGBP - 1.2) < 0.0001);
  assert.strictEqual(result.exchangeRate, 1.25);
});

test("foreignWithholdingTaxGbp derives rate from net foreign ÷ Total GBP", function () {
  // Gross $11.47, withhold $1.72 (15%), net $9.75 credited as £7.99
  const result = TaxMath.foreignWithholdingTaxGbp(100, 0.1147, 1.72, 7.99, 0);
  const expectedRate = 9.75 / 7.99;
  const expectedTax = 1.72 / expectedRate;
  assert.ok(Math.abs(result.exchangeRate - expectedRate) < 0.0001);
  assert.ok(Math.abs(result.taxPaidGBP - expectedTax) < 0.0001);
});

test("foreignWithholdingTaxGbp returns zero when no withholding", function () {
  const result = TaxMath.foreignWithholdingTaxGbp(10, 1, 0, 8, 1.2);
  assert.strictEqual(result.taxPaidGBP, 0);
  assert.strictEqual(result.exchangeRate, 1.2);
});

test("regression: UWMC-style withholding converts below dividend value", function () {
  // Mirrors Non-UK Dividends bug: VALUE £7.99 showed TAX PAID £9.75 (net USD as GBP)
  const shares = 100;
  const pricePerShare = 0.1147; // gross $11.47
  const withholding = 1.72; // 15% US withholding
  const totalGbp = 7.99; // net credited

  const buggyTax = buggyForeignTaxAsNetForeign(shares, pricePerShare, withholding);
  assert.ok(Math.abs(buggyTax - 9.75) < 0.01, "fixture must reproduce old inflated tax");
  assert.ok(buggyTax > totalGbp, "old bug produced tax greater than dividend value");

  const result = TaxMath.foreignWithholdingTaxGbp(shares, pricePerShare, withholding, totalGbp, 0);
  // Correct: withholding / (netForeign / totalGbp) ≈ £1.41
  assert.ok(Math.abs(result.taxPaidGBP - (1.72 * 7.99 / 9.75)) < 0.0001);
  assert.ok(result.taxPaidGBP < totalGbp);
  assert.ok(result.taxPaidGBP < buggyTax);
});

test("regression: Ecovyst-style withholding stays a fraction of net GBP", function () {
  // VALUE £83.25 / TAX PAID £94.08 under the old bug (~net USD as GBP)
  const shares = 500;
  const pricePerShare = 0.2214; // gross $110.70
  const withholding = 16.62; // 15%
  const totalGbp = 83.25;
  const netForeign = shares * pricePerShare - withholding; // $94.08

  const buggyTax = buggyForeignTaxAsNetForeign(shares, pricePerShare, withholding);
  assert.ok(Math.abs(buggyTax - 94.08) < 0.01);
  assert.ok(buggyTax > totalGbp);

  const result = TaxMath.foreignWithholdingTaxGbp(shares, pricePerShare, withholding, totalGbp, 0);
  const expectedTax = withholding * totalGbp / netForeign; // ≈ £14.69
  assert.ok(Math.abs(result.taxPaidGBP - expectedTax) < 0.0001);
  assert.ok(result.taxPaidGBP < totalGbp);
  // ~15% of gross GBP ≈ withholding/net * totalGbp
  assert.ok(result.taxPaidGBP / totalGbp < 0.25);
});

test("regression: blank CSV exchange rate still converts; CSV rate preferred", function () {
  const shares = 50;
  const price = 0.2;
  const withholding = 1.5; // net foreign = 8.5
  const totalGbp = 6.8;

  const derived = TaxMath.foreignWithholdingTaxGbp(shares, price, withholding, totalGbp, 0);
  assert.ok(Math.abs(derived.exchangeRate - (8.5 / 6.8)) < 0.0001);
  assert.ok(Math.abs(derived.taxPaidGBP - (1.5 * 6.8 / 8.5)) < 0.0001);

  const fromCsv = TaxMath.foreignWithholdingTaxGbp(shares, price, withholding, totalGbp, 1.25);
  assert.strictEqual(fromCsv.exchangeRate, 1.25);
  assert.ok(Math.abs(fromCsv.taxPaidGBP - 1.2) < 0.0001);
});

test("regression: foreign tax year totals use converted GBP withholding", function () {
  const bounds = TaxMath.getTaxYearBounds(2021);
  const inYear = (timestamp) => TaxMath.inTaxYear(timestamp, bounds);

  // Two UWMC-like rows in 2021-22 plus one outside the year
  const uwmc = TaxMath.foreignWithholdingTaxGbp(100, 0.1147, 1.72, 7.99, 0);
  const ecvt = TaxMath.foreignWithholdingTaxGbp(500, 0.2214, 16.62, 83.25, 0);
  const outside = TaxMath.foreignWithholdingTaxGbp(10, 1, 1.5, 7, 1.2);

  const dividends = [
    { timestamp: ukMillis(2021, 7, 8), value: 7.99, isUk: 0, taxPaidGBP: uwmc.taxPaidGBP },
    { timestamp: ukMillis(2021, 8, 24), value: 83.25, isUk: 0, taxPaidGBP: ecvt.taxPaidGBP },
    { timestamp: ukMillis(2023, 8, 24), value: 7, isUk: 0, taxPaidGBP: outside.taxPaidGBP }
  ];

  const totals = TaxMath.recalculateForeignDividendDetails(dividends, inYear);
  assert.ok(Math.abs(totals.nonUk - (7.99 + 83.25)) < 0.0001);
  assert.ok(Math.abs(totals.taxPaid - (uwmc.taxPaidGBP + ecvt.taxPaidGBP)) < 0.0001);
  // Aggregated tax must remain far below the inflated net-foreign sum (~103.83)
  assert.ok(totals.taxPaid < 20);
  assert.ok(totals.taxPaid < totals.nonUk);
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
