/**
 * @file ledger.js
 * @brief Build calculation ledgers and apply the same-day merge rule.
 */
import { safeAdd, safeDiv, safeMult } from './decimal.js';
import { sameDay } from './dates.js';
import { getUID } from './uid.js';

/**
 * @param {Object} engine
 */
export function populateLedger(engine) {
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
