Vue.config.productionTip = false;
// Vue.config.devtools = false;

var UID = 0;

var assetPrototype = {

}

const app = new Vue({
  el: '#app',
  data: {
    fileList: [],
    taxYear: {
      target: new Date().getFullYear() - 1,
      start: 0,
      end: 0,
      p30: 0,
      p30Seen: 0
    },
    taxYearData: {
      realisedProfit: 0,
      realisedLoss: 0,
      disposals: 0,
      costs: 0,
      dividends: 0
    },
    calculating: 0,
    calculated: 0,
    message: "",
    disposalCount: 0,
    realisedProfit: 0,
    realisedLoss: 0,
    realisedPl: 0,
    deposits: [],
    withdrawals: [],
    dividends: [],
    dividendsTotal: 0,
    freeShares: [],
    holdings: {},
    rtHolder: ""
  },
  mounted: function() {
    //Check Local Storage for data:
    this.$nextTick(function() {
      if (localStorage.getItem("rawData") != null) {
        let tmpFiles = JSON.parse(localStorage.getItem('rawData'));
        for (i in tmpFiles) {
          this.fileList.push(tmpFiles[i].name);
        }
      }
    });
  },
  computed: {
    fyText: function() {
      let a = Number(this.taxYear.target);
      let b = Number(this.taxYear.target) + 1;

      // Also using this function to compute tax year start and end dates:
      let startDate = new Date();
      startDate.setTime(0);
      let endDate = new Date();
      endDate.setTime(0);
      startDate.setDate(6);
      startDate.setMonth(3);
      startDate.setFullYear(a);
      endDate.setDate(5);
      endDate.setMonth(3);
      endDate.setFullYear(b);
      endPlusThirty = endDate;
      endPlusThirty.setMonth(4);

      this.taxYear.start = startDate.getTime();
      this.taxYear.end = endDate.getTime();
      this.taxYear.p30 = endPlusThirty.getTime();

      a = String(a).slice(-2);
      b = String(b).slice(-2);
      return (`${a}-${b}FY`);
    }
  },
  methods: {
    //UI Functions:
    back() {
      this.calculated = 0;
      this.resetCalculations();
    },
    clearFiles() {
      this.fileList = {};
      localStorage.clear();
    },
    resetCalculations() {
      this.purchaseValue = 0;
      this.realisedPl = 0;
      this.disposalCount = 0;
      this.realisedProfit = 0;
      this.realisedLoss = 0;
      this.deposits = [];
      this.withdrawals = [];
      this.dividends = [];
      this.dividendsTotal = 0;
      this.freeShares = [];
      this.holdings = {};
      this.taxYearData = {
        realisedProfit: 0,
        realisedLoss: 0,
        disposals: 0,
        costs: 0,
        dividends: 0
      };
    },
    //Housekeeping Methods:
    getTradeClass(type) {
      if (isNaN(type)) {
        if (type === "Buy") {
          return 'trade-row-buy';
        } else {
          return 'trade-row-sell';
        }
      } else if (Number(type) > 0) {
        return 'trade-row-buy';
      } else {
        return 'trade-row-sell';
      }
    },
    getUID() {
      return UID++;
    },
    sameDay(ref, test) { //returns true if dates are in the same day
      ref = luxon.DateTime.fromMillis(ref);
      test = luxon.DateTime.fromMillis(test);

      if (ref.year != test.year) {
        return false;
      } else if (ref.month != test.month) {
        return false
      } else if (ref.day != test.day) {
        return false;
      } else {
        return true;
      }

    },
    getTimestamp(date) { // Takes in a datestring returns UTC Seconds
      // console.log(date);
      let timestamp = Date.parse(date);
      // console.log(timestamp);
      return timestamp;
    },
    getDmyString(timestamp) {
      let date = new Date();
      date.setTime(timestamp);
      let day = date.getDate() < 10 ? "0" + date.getDate() : date.getDate();
      let month = (date.getMonth() + 1) < 10 ? "0" + (Number(date.getMonth()) + 1) : date.getMonth() + 1;
      return (`${day}-${month}-${date.getFullYear()}`);
    },
    getLedgerFromUid(uid) {
      for (i in this.holdings) {
        let holding = this.holdings[i];

        for (j in holding.ledger) {
          let entry = holding.ledger[j];
          if (entry.uid === uid) {
            return (entry);
          }
        }
      }
    },
    generateRoundtrips() {
      // Thinking out loud...
      // > Add headings to .csv string
      // > Date Sold, Date Aquired, Asset, Ammount, Cost (GBP), Proceeds (GBP), Gain/Loss (GBP), Notes
      // > Go through holdings>ledger
      // > If disposal and in tax year, find matching buy/S104 price
      // > Generate line.
      // > repeat
      let csv = "";
      csv = csv + `Date Sold, Date Aquired, Asset, Ammount, Cost (GBP), Proceeds (GBP), Gain/Loss (GBP), Notes \n`;

      for (i in this.holdings) {
        let holding = this.holdings[i];

        for (j in holding.ledger) {
          let entry = holding.ledger[j];
          j = Number(j);
          if (entry.change < 0 && entry.inTaxYear) {
            //Add to Round Trips
            if (entry.rule === "Section 104") {
              let dateSold = this.getDmyString(entry.timestamp);
              let asset = holding.ticker;
              let ammount = Math.abs(entry.change);
              let cost = (holding.ledger[j - 1].s104Price * Math.abs(entry.change)).toFixed(2);
              let proceeds = (entry.price * Math.abs(entry.change)).toFixed(2);
              let gainLoss = (entry.gain - entry.loss).toFixed(2);
              csv = csv + `${dateSold},,${asset},${ammount},${cost},${proceeds},${gainLoss},${entry.rule}\n`;
            } else {
              let buy = this.getLedgerFromUid(entry.matchedUid);
              let dateSold = this.getDmyString(entry.timestamp);
              let dateBought = this.getDmyString(buy.timestamp);
              let asset = holding.ticker;
              let ammount = Math.abs(entry.change);
              let cost = (buy.price * Math.abs(entry.change)).toFixed(2);
              let proceeds = (entry.price * Math.abs(entry.change)).toFixed(2);
              let gainLoss = (entry.gain - entry.loss).toFixed(2);
              csv = csv + `${dateSold},${dateBought},${asset},${ammount},${cost},${proceeds},${gainLoss},${entry.rule}\n`;

            }

          }
        }
      }
      this.rtHolder = csv;

      // now a direct copypasta from stackoverflow for the download
      var blob = new Blob([csv], {
        type: 'text/csv;charset=utf-8;'
      });
      if (navigator.msSaveBlob) { // IE 10+
        navigator.msSaveBlob(blob, filename);
      } else {
        var link = document.createElement("a");
        if (link.download !== undefined) { // feature detection
          // Browsers that support HTML5 download attribute
          var url = URL.createObjectURL(blob);
          link.setAttribute("href", url);
          link.setAttribute("download", "My CSV.csv");
          link.style.visibility = 'hidden';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      }

    },
    // Calculation Methods:
    addFile() {
      let t = this;
      let data = [];
      let dataKey = 0;
      if (localStorage.getItem("rawData") != null) {
        data = JSON.parse(localStorage.getItem('rawData'));
        // console.log(`Files exist: ${data[0].name}`);
        dataKey = data.length - 1;
      }

      var localFile = this.$refs.csvFile.files[0];

      let file = {
        name: "",
        data: ""
      }

      file.name = localFile.name;

      let uniquFile = 1;

      for (j in data) {
        if (data[j].name === file.name) {
          uniquFile = 0;
          alert(`${file.name}\n\nWarning: A file with this name is already loaded.\nIt has not been added again.`);
        }
      }

      // console.log(`File Name: ${file.name}`);
      if (uniquFile) {
        t.fileList.push(file.name);
        // console.log(file);
        var trades = Papa.parse(localFile, {
          complete: function(results) {
            // Remove titles
            var headers = results.data.shift();

            while (results.data[results.data.length - 1][0] == "") { //remove any empty lines from the end of the file
              results.data.pop();
            }
            file.data = results.data;
            data.push(file);
            localStorage.setItem("rawData", JSON.stringify(data));
            // console.log(`File Data: ${JSON.stringify(file.data)}`);
          }
        });
      }

    },
    calculate() {
      t = this

      let data = [];
      if (localStorage.getItem("rawData") != null) {
        data = JSON.parse(localStorage.getItem('rawData'));

        for (file in data) {
          for (key in data[file].data) {
            trade = data[file].data[key];

            let type = trade[0];

            let firstword = type.substr(0, type.indexOf(" ")); // reduce to first word only - makes finding different kinds of dividends far easier

            if (type == "Deposit") { //Account Action
              t.newDeposit(trade);
            } else if (type == "Withdrawal") { // Accont Action
              t.newWithdrawal(trade);
            } else if (firstword == "Dividend") {
              t.newDividend(trade);
            } else { // Specific Holding Action
              t.newTrade(trade);
            }
          }
        }

        t.populateLedger();
        // console.log(`Calling calculate Disposals`);
        t.calculateDisposals();

        t.calculating = 0;
        t.calculated = 1;
        // console.log(JSON.stringify(this.holdings));
        // data = data;
        //   }
        // });
        //Now calculate disposals

      } else {
        alert("No Files loaded - add your data and try again.");
      }
    },
    newDeposit(trade) {
      t = this;
      // console.log(`New Deposit: `);
      //special case for free shares:
      if (trade[17] == "Free Shares Promotion") {
        // t.addFreeShare(trade);
        return;
      }
      let temp = {
        uid: this.getUID(),
        timestamp: this.getTimestamp(trade[1]),
        dateString: trade[1],
        value: trade[10]
      };
      // console.log(JSON.stringify(temp));
      if (trade[17] == "Free Shares Promotion") {
        this.freeShares.push(temp);
      } else {
        this.deposits.push(temp);
      }
    },
    newWithdrawal(trade) {
      let temp = {
        uid: this.getUID(),
        timestamp: this.getTimestamp(trade[1]),
        dateString: trade[1],
        value: trade[10]
      };
      this.withdrawals.push(temp);
    },
    newDividend(trade) { //TODO check dividend currency and conversion rate
      let temp = {
        uid: this.getUID(),
        ticker: trade[3],
        name: trade[4],
        timestamp: this.getTimestamp(trade[1]),
        dateString: trade[1],
        value: Number(trade[10]),
        inTaxYear: 0
      };
      //If in tax year, add to tax year data
      if (temp.timestamp >= this.taxYear.start && temp.timestamp <= this.taxYear.end) {
        temp.inTaxYear = 1;
        this.taxYearData.dividends += temp.value;
      }
      if (temp.timestamp > this.taxYear.p30) { // A check that the data goes past the 30 days required to identify bnb trades
        this.taxYear.p30Seen = 1;
      }
      this.dividendsTotal += temp.value;
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
        uid: this.getUID(),
        timestamp: this.getTimestamp(trade[1]),
        dateString: trade[1],
        orderType: trade[0],
        rawType: rawTradeType,
        value: Number(trade[10]),
        // isin: trade[2],
        number: Number(trade[5]),
        price: Number(trade[6]),
        priceGBP: Number(trade[6]) / Number(trade[8]), // Price / exchange rate
        currency: trade[7],
        exchangeRate: Number(trade[8]),
        result: Number(trade[9]),
        total: Number(trade[10]),
        withholdingTax: Number(trade[11]),
        wthTaxCurrency: trade[12],
        stampDuty: Number(trade[14]),
        transactionFee: Number(trade[15]),
        finraFee: Number(trade[16]),
        notes: trade[17],
        t212ID: trade[18],
        frenchTransactionTax: Number(trade[19]),
        wasFree: false,
        inLedger: 0
      };

      /// HOLDINGS
      if (!(ticker in this.holdings)) {
        // console.log(`${ticker} not found in holdings:`);
        // console.log(JSON.stringify(this.holdings));
        // console.log(`Adding ${ticker} to Instruments`);
        this.holdings[ticker] = {
          uid: this.getUID(),
          ticker: ticker,
          isin: isin,
          name: name,
          holdings: 0,
          averageCostPs: 0,
          realisedProfit: 0,
          realisedLoss: 0,
          realisedPl: 0,
          disposalCount: 0,
          trades: [],
          ledger: [],
          disposals: [],
          tyData: {
            disposalCount: 0,
            realisedLoss: 0,
            realisedProfit: 0
          }
        };
      }

      this.holdings[ticker].trades.push(temp);

      if (temp.rawType == "Buy") {
        //Calculate average share price
        if (!isNaN(temp.number)) this.holdings[ticker].holdings += temp.number;
        // if (!isNaN(temp.total)) this.holdings[ticker].averageCostPs = temp.total; //TODO - update this from Section 104 Holdings
      } else {
        // if (!isNaN(temp.result)) this.holdings[ticker].averageCost += temp.result;
        if (!isNaN(temp.number)) this.holdings[ticker].holdings -= temp.number;
        this.holdings[ticker].disposalCount++;
      }

    },
    populateLedger() {
      this.message = "Populating Ledger";
      // Create an individual ledger for each holding. This applies the same day rule.
      // Multiple buy or multiple sells on the same day will be combined into one ledger entry.
      /*
      The “same day” rule TCGA92/S105(1)
        All shares of the same class in the same company acquired by the same person on the same day
        and in the same capacity are treated as though they were acquired by a single transaction,
        TCGA92/S105 (1)(a).

        All shares of the same class in the same company disposed of by the same person on the same day
        and in the same capacity are also treated as though they were disposed of by a single transaction,
        TCGA92/S105 (1)(a).
      */



      // Ledger Prototype:
      const ledgerProto = {
        uid: 0,
        timestamp: 0,
        change: 0, //Change in share holdings, +ve is buy, -ve is sell
        price: 0, // Price at which change occured
        currency: "",
        exchangeRate: 0,
        totalGBP: 0,
        feesPaid: 0,
        txid: 0,
        tradeCount: 0,
        tradeIDs: [],
        // comment: "", //TODO make array to hold multiple comments
        comment: [], //TODO make array to hold multiple comments
        counted: 0, // Has this ledger entry already been accounted for in tax calculations.
        // split: 0, // Does the tax in this entry fall into more than one category
        // subledger: [], // If split, breakdown transactions go in here
        gain: 0,
        loss: 0,
        s104Total: 0,
        s104Price: 0,
        taxable: 0,
        totalPnl: 0,
        matchedUid: 0,
        rule: "",
        inTaxYear: 0
      }

      for (key in this.holdings) { // For each holding in holdings

        var holding = this.holdings[key]; // holding refers to the complete record of each stock on record

        for (tradeKey in holding.trades) { // for each trade in the holding

          var t = holding.trades[tradeKey];

          if (!t.inLedger) { // If trade is not already in the ledger
            // let temp = Object.create(ledgerProto);
            let temp = JSON.parse(JSON.stringify(ledgerProto));
            temp.uid = this.getUID();
            temp.timestamp = t.timestamp;
            temp.change = t.rawType == "Buy" ? t.number : -t.number;
            temp.price = t.priceGBP;
            temp.tradeCount = 1;
            temp.tradeIDs.push(t.uid);
            // if (holding.ledger.length == 0) { // Keep a runing total of shares held
            //   temp.total = temp.change;
            // } else {
            //   temp.total = Number(holding.ledger[holding.ledger.length - 1].total) + temp.change;
            // }
            holding.ledger.push(temp);
            t.inLedger = 1; //Mark trade as in ledger
          }

          let ledgerIndex = holding.ledger.length - 1; // The index at which the last holding was stored
          let currTradeType = t.rawType;

          // Now cycle through trades again and determine if any are of the same type, on the same day,
          // and not yet in the ledger

          for (i in holding.trades) {
            compTrade = holding.trades[i];
            if (!compTrade.inLedger) { //Trade under comparison is not in ledger, therefore check it.
              if (compTrade.rawType === currTradeType) { //Trade type matches
                if (this.sameDay(t.timestamp, compTrade.timestamp)) {
                  // console.log(`Same Day Rule, Combined trades ${t.uid} with ${compTrade.uid}`);
                  // Add this trade to the current ledger entry, holding.ledger[ledgerIndex]
                  holding.ledger[ledgerIndex].tradeIDs.push(compTrade.uid);
                  holding.ledger[ledgerIndex].tradeCount++;

                  // Calculate new share number and price
                  let currNP = holding.ledger[ledgerIndex].change * holding.ledger[ledgerIndex].price; //Ledger entry current price*holdings
                  let newTradeChange = compTrade.rawType == "Buy" ? compTrade.number : -compTrade.number;
                  let newNP = Math.abs(newTradeChange) * Math.abs(compTrade.priceGBP);
                  // console.log(`3 Merge, NTChange=${newTradeChange}, NewPrice=${compTrade.priceGBP}`);

                  holding.ledger[ledgerIndex].change += newTradeChange; //sum of shares in this ledger entry so far
                  holding.ledger[ledgerIndex].priceGBP = (currNP + newNP) / Math.abs(holding.ledger[ledgerIndex].change);
                  // console.log(`3 Merge ${compTrade.uid} - currnp=${currNP}, newNP=${newNP}, Divisor=${Math.abs(holding.ledger[ledgerIndex].change)}`);

                  compTrade.inLedger = 1; // trade is in ledger
                  // If trade count is greater than 2, need to remove last merge comment
                  if (holding.ledger[ledgerIndex].tradeCount > 2) holding.ledger[ledgerIndex].comment.pop();
                  holding.ledger[ledgerIndex].comment.push(`${holding.ledger[ledgerIndex].tradeCount} trades merged for Same Day Rule.`);
                }
              }
            }
          }

          // Now calculate the running total:
          // if (ledgerIndex == 0) { // Keep a runing total of shares held
          //   holding.ledger[ledgerIndex].total = holding.ledger[ledgerIndex].change;
          // } else {
          //   holding.ledger[ledgerIndex].total = Number(holding.ledger[ledgerIndex - 1].total) + holding.ledger[ledgerIndex].change;
          // }

          // console.log(`Adding to ${holding.ticker} ledger: ${JSON.stringify(temp)}`);
        }
        // console.log(`Num Ledger Entries: ${holding.ledger.length}`);

      }

    },
    calculateDisposals() {
      //  Order of calculations:
      //  Check if same day disposal - marks as such. Split buy or sell transaction in ledger as appropriate
      //  Check if buy is within 30 days of sell - mark and split ledger transations appropriately
      //  Calculate Section104 Pool Price

      // Handle same day disposals.

      /*
      Same day Rules: https://www.gov.uk/hmrc-internal-manuals/capital-gains-manual/cg51560#IDATX33F

      If there is an acquisition and a disposal on the same day the disposal is identified first against the acquisition
      on the same day, TCGA92/S105 (1)(b).

      If the number of shares disposed of exceeds the number acquired on the same day the excess shares will be identified
      in the normal way.

      If the number of shares acquired exceeds the number sold on the same day the surplus is added to the Section 104 holding,
      unless they are identified with disposals under the ‘bed and breakfast’ rule, see below

      */

      for (key in this.holdings) { // For each holding in holdings
        var holding = this.holdings[key];

        for (i in holding.ledger) {
          sell = holding.ledger[i];

          if (sell.change < 0 && !sell.counted) { //disposal
            for (j in holding.ledger) {
              buy = holding.ledger[j];
              if (this.sameDay(sell.timestamp, buy.timestamp) && buy.change > 0 && !buy.counted) {
                // Ledger entry with a buy on same day as disposal
                // console.log(`Sameday Disposal UID${sell.uid}`);
                // buyare shares transacted in each entry:
                if ((sell.change + buy.change) === 0) {
                  // Happy days, they match. Calculate gain/loss
                  // console.log(`${sell.change} ${sell.price}`)
                  let tmp = Math.abs(Number(sell.price) * Number(sell.change)) - Number(buy.price) * Number(buy.change);
                  // console.log(`Temp GL = ${tmp}`);
                  if (tmp > 0) {
                    //gain
                    sell.gain = tmp;
                  } else {
                    sell.loss = Math.abs(tmp);
                  }

                  sell.comment.push(`Same Day Disposal counted against buy ${buy.uid}`);
                  sell.rule = "Same Day";

                  sell.totalPnl = tmp;
                  sell.taxable = 1;
                  sell.matchedUid = buy.uid;

                  sell.counted = 1;
                  buy.counted = 1;

                } else {
                  // Split same day disposal
                  // console.log(`Split same day disposal`);
                  if (Math.abs(sell.change) > buy.change) { //More sold on day than bought on day
                    // We need to split the sold ledger entry into two.
                    sell.comment.push(`Entry split for sameday rule matching Buy entry #${buy.uid}`);
                    sellCopy = JSON.parse(JSON.stringify(sell));
                    sellCopy.uid = this.getUID();
                    sell.change = -(buy.change);
                    sellCopy.change = Number(sellCopy.change) - Number(sell.change);

                    holding.ledger.splice(i, 0, sellCopy);

                    let tmp = Math.abs(Number(sell.price) * Number(sell.change)) - Number(buy.price) * Number(buy.change);
                    // console.log(`Temp GL = ${tmp}`);
                    if (tmp > 0) {
                      //gain
                      sell.gain = tmp;
                    } else {
                      sell.loss = Math.abs(tmp);
                    }

                    sell.comment.push(`Same Day Disposal counted against buy ${buy.uid}`);
                    sell.rule = "Same Day";

                    sell.totalPnl = tmp;
                    sell.taxable = 1;
                    sell.matchedUid = buy.uid;

                    sell.counted = 1;
                    buy.counted = 1;
                    // console.log(JSON.stringify(holding.ledger));

                  } else { //Buy change greater than sell change, split buy
                    buy.comment.push(`Entry split for sameday rule matching Sell entry #${sell.uid}`);
                    buyCopy = JSON.parse(JSON.stringify(buy));
                    buyCopy.uid = this.getUID();
                    buy.change = Math.abs(sell.change);
                    buyCopy.change = Number(buyCopy.change) - Number(buy.change);
                    // console.log(Number(buyCopy.change));
                    // console.log(Number(buy.change));

                    let tmp = Math.abs(Number(sell.price) * Number(sell.change)) - Number(buy.price) * Number(buy.change);
                    // console.log(`Temp GL = ${tmp}`);
                    if (tmp > 0) {
                      //gain
                      sell.gain = tmp;
                    } else {
                      sell.loss = Math.abs(tmp);
                    }

                    sell.comment.push(`Same Day Disposal counted against buy ${buy.uid}`);
                    sell.rule = "Same Day";

                    sell.totalPnl = tmp;
                    sell.taxable = 1;
                    sell.matchedUid = buy.uid;

                    holding.ledger.splice(j, 0, buyCopy);
                    sell.counted = 1;
                    buy.counted = 1;
                    // console.log(JSON.stringify(holding.ledger));

                  }

                }
              }
            }
          }
        } // /iterate through ledger for same day rule disposals

        // Now iterate through for the Bed and Breakfasting rule
        // console.log("Checking for 30 day BNB");
        for (i in holding.ledger) {
          buy = holding.ledger[i];

          if (buy.change > 0 && !buy.counted) { //actually is a buy
            //30 days in ms
            let thirtyDays = 1000 * 60 * 60 * 24 * 30;

            let cutOff = buy.timestamp - thirtyDays;


            // Now need to look for sells between cutoff and buy

            for (j in holding.ledger) {
              sell = holding.ledger[j];
              if (sell.change < 0 && !sell.counted) { //sell
                if (sell.timestamp > cutOff && sell.timestamp < buy.timestamp) {
                  // console.log(`#${buy.uid} bought within 30 days of #${sell.uid}`);

                  if (sell.change + buy.change === 0) { //Trades are the same size
                    sell.counted = 1;
                    sell.comment.push(`30 day BnB rule, counted against Buy #${buy.uid}`);
                    buy.counted = 1;
                    buy.comment.push(`30 day BnB rule, counted against Sell #${sell.uid}`);

                    let tmp = (Number(sell.price) * Math.abs(sell.change)) - (Number(buy.price) * Number(buy.change));

                    if (tmp > 0) {
                      //gain
                      buy.gain = tmp;
                    } else {
                      buy.loss = Math.abs(tmp);
                    }

                    sell.rule = "30 Day BnB";
                    sell.totalPnl = tmp;
                    sell.taxable = 1;
                    sell.matchedUid = buy.uid;

                    // console.log(`Buy #${buy.uid} 30 day BnB rule, counted against Sell #${sell.uid}`);

                  } else if (sell.change + buy.change < 0) { //More shares were sold.
                    // need to split the sell entry to match the buy entry
                    // console.log(`Sell #${sell.uid} being split for 30 day rule to match Buy entry #${buy.uid}`);

                    sellCopy = JSON.parse(JSON.stringify(sell));
                    sellCopy.uid = this.getUID();

                    sell.change = -(buy.change);
                    sellCopy.change = Number(sellCopy.change) - Number(sell.change);
                    sell.counted = 1;
                    buy.counted = 1;
                    buy.comment.push(`30 day BnB rule, counted against Sell #${sellCopy.uid}`);
                    sell.comment.push(`Entry split into #${sellCopy.uid} for 30 day rule matching Buy entry #${buy.uid}`);


                    let tmp = (Number(sell.price) * Math.abs(sell.change)) - (Number(buy.price) * Number(buy.change));

                    if (tmp > 0) {
                      //gain
                      sell.gain = tmp;
                    } else {
                      sell.loss = Math.abs(tmp);
                    }

                    sell.rule = "30 Day BnB";
                    sell.totalPnl = tmp;
                    sell.taxable = 1;
                    sell.matchedUid = buy.uid;

                    sell.comment.push(`30 day BnB rule, counted against Buy #${buy.uid}`);
                    let newPos = Number(j) + 1;
                    holding.ledger.splice(newPos, 0, sellCopy);

                    // console.log(`Buy #${buy.uid} 30 day BnB rule, counted against Sell #${sellCopy.uid}`);

                    break;

                  } else if (sell.change + buy.change > 0) { //More shares were bought.
                    // need to split the buy entry to match the sell entry
                    // console.log(`Buy #${buy.uid} being split for 30 day rule to match Sell entry #${sell.uid}`);

                    buyCopy = JSON.parse(JSON.stringify(buy));
                    buyCopy.uid = this.getUID();

                    buy.change = -(sell.change); // The entry we're counting the sell against
                    buyCopy.change = Number(buyCopy.change) - Number(buy.change); // the remainder
                    sell.counted = 1;
                    buy.counted = 1;
                    buy.comment.push(`Entry split into #${buyCopy.uid} for 30 day rule and matched to Sell entry #${sell.uid}`);
                    sell.comment.push(`30 day BnB rule, counted against Buy #${buy.uid}`);


                    let tmp = (Number(sell.price) * Math.abs(sell.change)) - (Number(buy.price) * Number(buy.change));

                    if (tmp > 0) {
                      //gain
                      sell.gain = tmp;
                    } else {
                      sell.loss = Math.abs(tmp);
                    }

                    sell.rule = "30 Day BnB";
                    sell.totalPnl = tmp;
                    sell.taxable = 1;
                    sell.matchedUid = buy.uid;

                    let newPos = Number(i) + 1;
                    // console.log(`Splicing ${buyCopy.uid} int array pos ${newPos}. Sell Array pos is ${j}`);
                    holding.ledger.splice(newPos, 0, buyCopy);

                    // console.log(`Buy #${buy.uid} 30 day BnB rule, counted against Sell #${buyCopy.uid}`);

                    break;

                  }
                }
              }
            }

          }

        } // /Check for 30day rule
        // Now all splits have been done, check for in tax year and calculate the Section 104 holdings
        for (i in holding.ledger) {
          entry = holding.ledger[i];
          i = Number(i);
          if (entry.change > 0) { //buy
            if (!entry.counted) {
              if (i === 0) {
                entry.s104Total = entry.change;
                entry.s104Price = entry.price;
              } else {
                entry.s104Total = Number(holding.ledger[i - 1].s104Total) + Number(entry.change);

                // let prevValue = holding.ledger[i - 1].s104Total * holding.ledger[i - 1].s104Price;
                // let newValue = Number(entry.change) * Number(entry.price)

                entry.s104Price = ((Number(holding.ledger[i - 1].s104Total) * Number(holding.ledger[i - 1].s104Price)) + (Number(entry.change) * Number(entry.price))) / Number(entry.s104Total);

              }
            } else if (i > 0) {
              entry.s104Total = Number(holding.ledger[i - 1].s104Total);
              entry.s104Price = Number(holding.ledger[i - 1].s104Price);
            }
          } else if (entry.change < 0) {
            if (!entry.counted) {
              // Selling section 104 holding
              if (i === 0) {
                console.log(`Error - no history of holdings for disposal ${entry.uid} of ${holding.name}`);
              } else {
                let tmp = (Math.abs(entry.change) * Number(entry.price)) - (Math.abs(entry.change) * Number(holding.ledger[i - 1].s104Price));
                entry.s104Total = (Number(holding.ledger[i - 1].s104Total) - Math.abs(entry.change));
                if (tmp > 0) {
                  //gain
                  entry.gain = tmp;
                } else {
                  entry.loss = Math.abs(tmp);
                }
                entry.rule = "Section 104";
                entry.totalPnl = tmp;
                entry.taxable = 1;
                entry.matchedUid = buy.uid;

                entry.comment.push(`Gain calculated against Section 104 Holdings`);
              }
            } else if (i > 0) {
              entry.s104Total = Number(holding.ledger[i - 1].s104Total);
              entry.s104Price = Number(holding.ledger[i - 1].s104Price);
            }
          }

        }
        //All PnL calculated, now sum up for the holdings realisedPl

        // for (i in holding.ledger) {
        for (i in holding.ledger) {
          entry = holding.ledger[i];

          // tax year check
          if (entry.timestamp >= this.taxYear.start && entry.timestamp <= this.taxYear.end) {
            entry.inTaxYear = 1;
          }
          if (entry.timestamp > this.taxYear.p30) { // A check that the data goes past the 30 days required to identify bnb trades
            this.taxYear.p30Seen = 1;
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
        //In loop for key in holdings

        this.taxYearData.realisedProfit += holding.tyData.realisedProfit;
        this.taxYearData.realisedLoss += holding.tyData.realisedLoss;
        this.taxYearData.disposals += holding.tyData.disposalCount;

        // Update total stats
        this.realisedPl += Number(holding.realisedPl);
        this.realisedLoss += Number(holding.realisedLoss);
        this.realisedProfit += Number(holding.realisedProfit);
        this.disposalCount += Number(holding.disposalCount);



        //error p30 check
      }
    }
  }
})