/**
 * @file disposalEngine.test.js
 * @brief Integration tests for the HMRC share-matching disposal engine.
 */
const assert = require("assert");
const TaxMath = require("../Scripts/taxMath.js");
const DisposalEngine = require("../Scripts/disposalEngine.js");

const DAY_MS = 86400000;

/** @returns {number} Synthetic timestamp for day offset. */
function day(offset) {
  return offset * DAY_MS;
}

let uidCounter = 1;

/** @returns {number} Unique test id. */
function nextUid() {
  return uidCounter++;
}

/**
 * @brief Build a synthetic trade object.
 * @param {string} rawType Buy or Sell.
 * @param {number} number Share quantity.
 * @param {number} priceGBP Per-share GBP price.
 * @param {number} timestamp Trade timestamp.
 * @returns {object} Trade record.
 */
function makeTrade(rawType, number, priceGBP, timestamp) {
  return {
    uid: nextUid(),
    rawType: rawType,
    number: number,
    priceGBP: priceGBP,
    timestamp: timestamp,
    inLedger: 0
  };
}

/**
 * @brief Build a holding with derived position counts.
 * @param {string} ticker Ticker symbol.
 * @param {Array<object>} trades Trade list.
 * @returns {object} Holding record.
 */
function makeHolding(ticker, trades) {
  let holdings = 0;
  let disposalCount = 0;

  for (let i = 0; i < trades.length; i++) {
    if (trades[i].rawType === "Buy") {
      holdings += trades[i].number;
    } else {
      holdings -= trades[i].number;
      disposalCount++;
    }
  }

  return {
    ticker: ticker,
    name: ticker,
    trades: trades,
    ledger: [],
    holdings: holdings,
    disposalCount: disposalCount,
    tradeCount: trades.length,
    realisedPl: 0,
    realisedProfit: 0,
    realisedLoss: 0,
    tyData: { disposalCount: 0, realisedProfit: 0, realisedLoss: 0 }
  };
}

/**
 * @brief Run populateLedger and calculateDisposals on holdings.
 * @param {object} holdings Holdings keyed by ticker.
 * @param {object} options Optional engine overrides.
 * @returns {object} Engine result.
 */
function runEngine(holdings, options) {
  const engineOptions = Object.assign({
    getUID: () => nextUid(),
    inTaxYear: () => 1,
    taxYear: { p30: Number.POSITIVE_INFINITY, p30Seen: 1 },
    errorList: [],
    nonResidentPeriods: []
  }, options || {});

  DisposalEngine.populateLedger(holdings, engineOptions);
  return DisposalEngine.calculateDisposals(holdings, engineOptions);
}

/**
 * @brief Sum taxable disposal gains minus losses for a holding.
 * @param {object} holding Processed holding.
 * @returns {number} Net realised P/L.
 */
function netRealisedPl(holding) {
  return holding.realisedProfit - holding.realisedLoss;
}

/**
 * @brief Find ledger entries that applied a given matching rule.
 * @param {object} holding Processed holding.
 * @param {string} rule Rule label.
 * @returns {Array<object>} Matching ledger rows.
 */
function entriesWithRule(holding, rule) {
  return holding.ledger.filter(function (entry) {
    return entry.rule === rule;
  });
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

test("ACCA Mr Monk example produces chargeable gain of 2620", function () {
  uidCounter = 1;
  const sellPrice = 10000 / 1200;
  const holding = makeHolding("LION", [
    makeTrade("Buy", 500, 4, day(1)),
    makeTrade("Buy", 500, 4.8, day(2)),
    makeTrade("Buy", 500, 6, day(100)),
    makeTrade("Sell", 1200, sellPrice, day(100)),
    makeTrade("Buy", 500, 7, day(115))
  ]);
  const holdings = { LION: holding };
  const result = runEngine(holdings);

  assert.ok(Math.abs(netRealisedPl(result.holdings.LION) - 2620) < 0.02);
  assert.strictEqual(entriesWithRule(result.holdings.LION, "Same Day").length, 1);
  assert.strictEqual(entriesWithRule(result.holdings.LION, "30 Day BnB").length, 1);
  assert.strictEqual(entriesWithRule(result.holdings.LION, "Section 104").length, 1);
});

test("same-day partial match leaves remainder for Section 104", function () {
  uidCounter = 1;
  const holding = makeHolding("TEST", [
    makeTrade("Buy", 100, 5, day(1)),
    makeTrade("Buy", 40, 6, day(10)),
    makeTrade("Sell", 100, 10, day(10))
  ]);
  const result = runEngine({ TEST: holding });
  const sameDayEntries = entriesWithRule(result.holdings.TEST, "Same Day");
  const s104Entries = entriesWithRule(result.holdings.TEST, "Section 104");

  assert.strictEqual(sameDayEntries.length, 1);
  assert.strictEqual(s104Entries.length, 1);
  assert.ok(Math.abs(sameDayEntries[0].totalPnl - 160) < 0.01);
  assert.ok(Math.abs(s104Entries[0].totalPnl - 300) < 0.01);
});

test("bed and breakfast assigns gain to the sell ledger entry", function () {
  uidCounter = 1;
  const holding = makeHolding("BNB", [
    makeTrade("Buy", 100, 5, day(1)),
    makeTrade("Sell", 100, 10, day(10)),
    makeTrade("Buy", 100, 6, day(20))
  ]);
  const result = runEngine({ BNB: holding });
  const bnbSell = entriesWithRule(result.holdings.BNB, "30 Day BnB")[0];

  assert.strictEqual(bnbSell.gain, 400);
  assert.strictEqual(bnbSell.loss, 0);
});

test("non-resident re-purchase skips bed and breakfast matching", function () {
  function buildScenario() {
    return makeHolding("RES", [
      makeTrade("Buy", 100, 5, day(1)),
      makeTrade("Sell", 100, 10, day(10)),
      makeTrade("Buy", 100, 6, day(20))
    ]);
  }

  uidCounter = 1;
  const residentResult = runEngine({ RES: buildScenario() }, { nonResidentPeriods: [] });
  uidCounter = 100;
  const nonResidentResult = runEngine({ RES: buildScenario() }, {
    nonResidentPeriods: [{ from: day(19), to: day(21) }]
  });

  assert.strictEqual(entriesWithRule(residentResult.holdings.RES, "30 Day BnB").length, 1);
  assert.strictEqual(entriesWithRule(nonResidentResult.holdings.RES, "30 Day BnB").length, 0);
  assert.strictEqual(entriesWithRule(nonResidentResult.holdings.RES, "Section 104").length, 1);
  assert.ok(netRealisedPl(nonResidentResult.holdings.RES) > netRealisedPl(residentResult.holdings.RES));
});

test("non-resident period end date includes re-purchase on last day", function () {
  const { DateTime } = require("luxon");
  const endDayNoon = DateTime.fromObject(
    { year: 2024, month: 3, day: 12, hour: 12, minute: 0 },
    { zone: TaxMath.UK_ZONE }
  ).toMillis();

  uidCounter = 1;
  const holding = makeHolding("EDGE", [
    makeTrade("Buy", 100, 5, day(1)),
    makeTrade("Sell", 100, 10, day(10)),
    makeTrade("Buy", 100, 6, endDayNoon)
  ]);
  const result = runEngine({ EDGE: holding }, {
    nonResidentPeriods: [{
      from: TaxMath.ukCalendarDayStartMillis("2024-03-10"),
      to: TaxMath.ukCalendarDayEndMillis("2024-03-12")
    }]
  });

  assert.strictEqual(entriesWithRule(result.holdings.EDGE, "30 Day BnB").length, 0);
  assert.strictEqual(entriesWithRule(result.holdings.EDGE, "Section 104").length, 1);
});

test("same-day merge averages multiple buy prices on one day", function () {
  uidCounter = 1;
  const holding = makeHolding("MERGE", [
    makeTrade("Buy", 100, 10, day(5)),
    makeTrade("Buy", 50, 12, day(5)),
    makeTrade("Sell", 150, 15, day(20))
  ]);
  const result = runEngine({ MERGE: holding });
  const buys = result.holdings.MERGE.ledger.filter(function (entry) {
    return entry.change > 0 && !entry.counted;
  });

  assert.strictEqual(buys.length, 1);
  assert.ok(Math.abs(buys[0].price - 10.666666666666666) < 0.0001);
});

test("sale exceeding recorded pool adds a diagnostic error", function () {
  uidCounter = 1;
  const holding = makeHolding("ERR", [
    makeTrade("Buy", 50, 5, day(1)),
    makeTrade("Sell", 100, 10, day(2))
  ]);
  const errors = [];
  runEngine({ ERR: holding }, { errorList: errors });

  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].msg.includes("missing trade history"));
});

test("holdings are isolated by ticker", function () {
  uidCounter = 1;
  const holdings = {
    AAA: makeHolding("AAA", [
      makeTrade("Buy", 10, 5, day(1)),
      makeTrade("Sell", 10, 8, day(2))
    ]),
    BBB: makeHolding("BBB", [
      makeTrade("Buy", 10, 2, day(1)),
      makeTrade("Sell", 10, 4, day(2))
    ])
  };
  const result = runEngine(holdings);

  assert.strictEqual(netRealisedPl(result.holdings.AAA), 30);
  assert.strictEqual(netRealisedPl(result.holdings.BBB), 20);
});

console.log(`\n${passed} tests passed`);
