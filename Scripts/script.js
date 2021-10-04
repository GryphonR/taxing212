Vue.config.productionTip = false;
// Vue.config.devtools = false;

var assetPrototype = {

}

const app = new Vue({
  el: '#app',
  data: {
    calculating: 0,
    message: "",
    purchaseValue: 0,
    totalRealisedPl: 0,
    deposits: [],
    withdrawals: [],
    dividends: [],
    freeShares: [],
    holdings: {}
  },
  methods: {
    //Housekeeping Methods:
    getTradeClass(type) {
      if (type === "Buy") {
        return 'trade-row-buy';
      } else {
        return 'trade-row-sell';
      }
    },
    // Calculation Methods:
    selectedFile() {
      t = this
      console.log('selected a file');
      // console.log(this.$refs.myFile.files[0]);

      this.calculating = 1;
      this.message = "Parseing CSV";

      var file = this.$refs.myFile.files[0];
      // console.log(file);
      var trades = Papa.parse(file, {
        complete: function (results) {
          // Remove titles
          var headers = results.data.shift();

          for (key in results.data) {
            trade = results.data[key];

            let type = trade[0];

            if (type == "Deposit") { //Account Action
              t.newDeposit(trade);
            } else if (type == "Withdrawal") { // Accont Action
              t.newWithdrawal(trade);
            } else if (type == "Dividend (Ordinary)" || type == "Dividend (Special)"){
              t.newDividend(trade);
            } else { // Specific Holding Action
              t.newTrade(trade);
            }
          }
          console.log(`Calling calculate Disposals`);
          t.populateLedger();
          t.calculateDisposals();

          t.calculating = 0;
          // console.log(JSON.stringify(this.holdings));
          // data = results.data;
        }
      });
      //Now calculate disposals


    },
    newDeposit(trade) {
      t = this;
      console.log(`New Deposit: `);
      //special case for free shares:
      if (trade[17] == "Free Shares Promotion") {
        // t.addFreeShare(trade);
        return;
      }
      let temp = {
        timestamp: Date.parse(trade[1]),
        dateString: trade[1],
        value: trade[10]
      };
      console.log(JSON.stringify(temp));
      if (trade[17] == "Free Shares Promotion") {
        this.freeShares.push(temp);
      } else {
        this.deposits.push(temp);
      }
    },
    newWithdrawal(trade) {
      let temp = {
        timestamp: Date.parse(trade[1]),
        dateString: trade[1],
        value: trade[10]
      };
      this.withdrawals.push(temp);
    },
    newDividend(trade) {
      let temp = {
        ticker: trade[3],
        name :trade[4],
        timestamp: Date.parse(trade[1]),
        dateString: trade[1],
        value: trade[10]
      };
      this.dividends.push(temp);
    },
    newTrade(trade) {
      let rawTradeType = "Sell";
      ticker = trade[3];
      name = trade[4];
      isin = trade[2];

      if (trade[0] == "Market buy" || trade[0] == "Limit buy") {
        rawTradeType = "Buy";
      }

      let temp = {
        timestamp: Date.parse(trade[1]),
        dateString: trade[1],
        orderType: trade[0],
        rawType: rawTradeType,
        value: trade[10],
        // isin: trade[2],
        number: Number(trade[5]),
        price: Number(trade[6]),
        currency: trade[7],
        exchangeRate: trade[8],
        result: Number(trade[9]),
        total: Number(trade[10]),
        withholdingTax: trade[11],
        wthTaxCurrency: trade[12],
        stampDuty: trade[14],
        transactionFee: trade[15],
        finraFee: trade[16],
        notes: trade[17],
        t212ID: trade[18],
        frenchTransactionTax: trade[19],
        wasFree: false
      };

      /// HOLDINGS
      if (!(ticker in this.holdings)) {
        // console.log(`${ticker} not found in holdings:`);
        // console.log(JSON.stringify(this.holdings));
        // console.log(`Adding ${ticker} to Instruments`);
        this.holdings[ticker] = {
          ticker: ticker,
          isin: isin,
          name: name,
          holdings: 0,
          costBasis: 0,
          averageCostPs: 0,
          realisedPl: 0,
          disposalCount: 0,
          trades: [],
          ledger: [],
          disposals: []
        }
      } else {
        console.log("Existing Ticker");
      }

      this.holdings[ticker].trades.push(temp);
      // console.log(`Total ${ticker} trades: ${this.holdings[ticker].trades.length}`);
      // console.log(JSON.stringify(temp));


      if (temp.rawType == "Buy") {
        this.purchaseValue += temp.total; // Updates the global totlal purchase cost
        //Calculate average share price
        this.holdings[ticker].costBasis += temp.total
        this.holdings[ticker].holdings += temp.number;
        this.holdings[ticker].averageCostPs = temp.total;
      } else {
        this.holdings[ticker].averageCost += temp.result;
        this.purchaseValue += temp.result;
        this.holdings[ticker].holdings -= temp.number;
        this.holdings[ticker].disposalCount++;
      }

    },
    populateLedger() {
      this.message = "Populating Ledger";
      // Create an individual ledger for each holding.

      // Ledger Prototype:
      const ledgerProto = {
        timestamp: 0,
        change: 0,
        price: 0,
        currency: "",
        exchangeRate: 0,
        totalGBP: 0,
        feesPaid: 0,
        costBasis: 0,
        txid: 0
      }

      for (key in this.holdings) { // For each holding
        var holding = this.holdings[key];
        // console.log(`Ledger holding: ${JSON.stringify(holding)}`);
        // console.log(`Num Trades: ${holding.trades.length}`);

        for (tradeKey in holding.trades) { // for each trade
          var t = holding.trades[tradeKey];
          let temp = Object.create(ledgerProto);
          temp.timestamp = t.timestamp;
          temp.change = t.rawType == "Buy" ? t.number : -t.number;
          // console.log(`Type = ${t.rawType}, buy = ${t.rawType == "BUY"}`);
          temp.price = t.price;
          if (holding.ledger.length == 0) {
            temp.total = temp.change;
          } else {
            temp.total = Number(holding.ledger[holding.ledger.length - 1].total) + temp.change;
          }
          holding.ledger.push(temp);
          // console.log(`Adding to ${holding.ticker} ledger: ${JSON.stringify(temp)}`);
        }
        // console.log(`Num Ledger Entries: ${holding.ledger.length}`);

      }

    },
    calculateDisposals() {
      this.message = "Calculating Disposals";
      // console.log(`Disp: All Holdings: ${JSON.stringify(this.holdings)}`);

      for (key in this.holdings) {
        var holding = this.holdings[key];
        console.log(JSON.stringify(holding));
        if (holding.disposalCount) {

          //What we need to do...
          //  Check if trade is a sell.
          //  If sell, check if same day disposal - marks as such
          //  else check if BNB/30 day disposal
          //  else mark as Section104


        }
      }
    }
  }
})