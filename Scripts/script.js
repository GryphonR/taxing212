Vue.config.productionTip = false;
// Vue.config.devtools = false;

var UID = 0;

var assetPrototype = {

}

const REQUIRED_T212_FIELDS = {
  action: ["Action"],
  time: ["Time"],
  isin: ["ISIN"],
  ticker: ["Ticker"],
  name: ["Name"],
  numberOfShares: ["No. of shares"],
  pricePerShare: ["Price / share"],
  currencyPricePerShare: ["Currency (Price / share)"],
  exchangeRate: ["Exchange rate"],
  resultGbp: ["Result", "Result (GBP)"],
  totalGbp: ["Total", "Total (GBP)"],
  withholdingTax: ["Withholding tax"],
  withholdingTaxCurrency: ["Currency (Withholding tax)", "Currency (Stamp duty reserve tax)"],
  stampDutyReserveTaxGbp: ["Stamp duty reserve tax", "Stamp duty reserve tax (GBP)"],
  transactionFeeGbp: ["Transaction fee", "Transaction fee (GBP)"],
  finraFeeGbp: ["Finra fee", "Finra fee (GBP)"],
  notes: ["Notes"],
  id: ["ID"],
  frenchTransactionTax: ["French transaction tax"]
};

const app = new Vue({
  el: '#app',
  data: {
    fileList: [],
    errorList: [],
    uploadStatus: {
      type: "",
      message: ""
    },
    acceptedDisclaimer: false,
    isDraggingFile: false,
    activeResultsTab: "dashboard",
    showErrorsOnly: false,
    portfolioChart: null,
    dividendChart: null,
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
      proceeds: 0,
      dividends: 0,
      roundTrips: [],
    },
    allRoundTrips: [],
    availableTaxYears: [],

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
    dividendDetails: {
      uk: 0,
      nonUk: 0,
      taxPaid: 0
    },
    divUkOthersList: {},
    freeShares: [],
    holdings: {},
    rtHolder: ""
  },
  watch: {
    'taxYear.target': function () {
      if (this.calculated) {
        this.recalculateTaxYearData();
        this.$nextTick(() => this.renderCharts());
      }
    }
  },
  mounted: function () {
    //Check Local Storage for data:
    this.$nextTick(function () {
      if (localStorage.getItem("rawData") != null) {
        let tmpFiles = JSON.parse(localStorage.getItem('rawData'));
        for (i in tmpFiles) {
          this.fileList.push(tmpFiles[i].name);
        }
      }
    });
  },
  computed: {
    fyText: function () {
      let a = Number(this.taxYear.target);
      let b = Number(this.taxYear.target) + 1;

      a = String(a).slice(-2);
      b = String(b).slice(-2);
      return (`${a}-${b}FY`);
    },
    sortedTaxYears: function () {
      return this.availableTaxYears.slice().sort(function (a, b) {
        return b - a;
      });
    },
    filteredHoldings: function () {
      const holdings = Object.values(this.holdings || {});
      if (!this.showErrorsOnly) {
        return holdings;
      }
      return holdings.filter(h => this.holdingHasErrors(h));
    },
    divTyUkC: function () { // Sum of uk company dividends in tax year
      let sum = 0;
      for (i in this.dividends) {
        let d = this.dividends[i];
        if (d.inTaxYear && d.ukCompany && d.isUk) {
          sum += d.value;
        }
      }

      // Piggybacking here as this is computed each time a checkbox is changed
      this.divUkOthersUpdate();
      return (sum.toFixed(2));
    },
    divTyUkO: function () { // Sum of UK non company dividends in tax year
      let sum = 0;
      for (i in this.dividends) {
        let d = this.dividends[i];
        if (d.inTaxYear && !d.ukCompany && d.isUk) {
          sum += d.value;
        }
      }
      return (sum.toFixed(2));

    }
  },
  methods: {
    normaliseHeaderName(header) {
      return header == null ? "" : String(header).trim().toLowerCase();
    },
    getFieldByHeader(row, headerOptions) {
      if (row == null) {
        return "";
      }

      for (let i = 0; i < headerOptions.length; i++) {
        let option = headerOptions[i];
        if (option in row && row[option] != null) {
          return row[option];
        }
      }

      let normalisedOptions = headerOptions.map(option => this.normaliseHeaderName(option));
      for (let key in row) {
        if (normalisedOptions.indexOf(this.normaliseHeaderName(key)) >= 0 && row[key] != null) {
          return row[key];
        }
      }

      return "";
    },
    normaliseTradeRow(row) {
      let normalisedTrade = {};

      for (let field in REQUIRED_T212_FIELDS) {
        normalisedTrade[field] = this.getFieldByHeader(row, REQUIRED_T212_FIELDS[field]);
      }

      return normalisedTrade;
    },
    getTradeValue(trade, field, legacyIndex) {
      if (trade != null && typeof trade === "object" && !Array.isArray(trade) && field in trade) {
        return trade[field];
      }

      if (Array.isArray(trade)) {
        return trade[legacyIndex];
      }

      return "";
    },
    setUploadStatus(type, message) {
      this.uploadStatus = {
        type: type,
        message: message
      };
    },
    formatCurrency(value) {
      const num = Number(value || 0);
      return `£${num.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },
    currencyClass(value) {
      return Number(value || 0) < 0 ? 'currency-negative' : 'currency-positive';
    },
    toggleErrorFilter() {
      this.showErrorsOnly = !this.showErrorsOnly;
    },
    holdingHasErrors(inst) {
      if (!inst || !this.errorList.length) {
        return false;
      }
      const uids = new Set((inst.ledger || []).map(entry => Number(entry.uid)));
      return this.errorList.some(error => {
        const linked = Number(error.linkedUid);
        if (!isNaN(linked) && linked > 0 && uids.has(linked)) {
          return true;
        }
        const msg = String(error.msg || "");
        return msg.includes(inst.ticker) || msg.includes(inst.name);
      });
    },
    openFilePicker() {
      this.$refs.csvFile.click();
    },
    onDragOver() {
      this.isDraggingFile = true;
    },
    onDragLeave() {
      this.isDraggingFile = false;
    },
    onFileDrop(event) {
      this.isDraggingFile = false;
      if (!event.dataTransfer || !event.dataTransfer.files || !event.dataTransfer.files.length) {
        return;
      }
      const droppedFile = event.dataTransfer.files[0];
      this.addFileFromBlob(droppedFile);
    },
    addFileFromBlob(localFile) {
      var t = this;
      let data = [];
      if (localStorage.getItem("rawData") != null) {
        data = JSON.parse(localStorage.getItem('rawData'));
      }

      if (!localFile.name.toLowerCase().endsWith(".csv")) {
        this.setUploadStatus("error", `${localFile.name} is not a CSV file. Please upload a Trading 212 CSV export.`);
        if (this.$refs.csvFile) this.$refs.csvFile.value = "";
        return;
      }

      let file = {
        name: localFile.name,
        data: ""
      };

      for (let j in data) {
        if (data[j].name === file.name) {
          this.setUploadStatus("error", `${file.name} is already loaded. Remove it first if you want to upload an updated copy.`);
          if (this.$refs.csvFile) this.$refs.csvFile.value = "";
          return;
        }
      }

      Papa.parse(localFile, {
        header: true,
        skipEmptyLines: true,
        transformHeader: function (header) {
          return header == null ? "" : String(header).trim();
        },
        complete: function (results) {
          if (!results.data || !results.data.length) {
            t.setUploadStatus("error", `${file.name} appears to be empty and was not loaded.`);
            if (t.$refs.csvFile) t.$refs.csvFile.value = "";
            return;
          }

          if (!t.hasRequiredTradeHeaders(results.data)) {
            t.setUploadStatus("error", `${file.name} does not look like a valid Trading 212 history export (missing Action/Time columns).`);
            if (t.$refs.csvFile) t.$refs.csvFile.value = "";
            return;
          }

          file.data = results.data.map(function (row) {
            return t.normaliseTradeRow(row);
          });

          data.push(file);
          localStorage.setItem("rawData", JSON.stringify(data));
          t.fileList.push(file.name);
          t.setUploadStatus("success", `${file.name} uploaded successfully.`);
          if (t.$refs.csvFile) t.$refs.csvFile.value = "";
        },
        error: function () {
          t.setUploadStatus("error", `${file.name} could not be read. Please re-export the file and try again.`);
          if (t.$refs.csvFile) t.$refs.csvFile.value = "";
        }
      });
    },
    renderCharts() {
      if (typeof Chart === "undefined") {
        return;
      }

      const portfolioCanvas = document.getElementById('portfolioChart');
      const dividendCanvas = document.getElementById('dividendChart');
      if (!portfolioCanvas || !dividendCanvas) {
        return;
      }

      const labels = [];
      const values = [];
      for (let key in this.holdings) {
        const h = this.holdings[key];
        if (Number(h.holdings) > 0) {
          const price = (h.ledger || []).length ? Number(h.ledger[h.ledger.length - 1].price || 0) : 0;
          const value = Number(h.holdings || 0) * price;
          if (value > 0) {
            labels.push(h.ticker || h.name);
            values.push(value);
          }
        }
      }

      const monthly = {};
      for (let i = 0; i < this.dividends.length; i++) {
        const d = this.dividends[i];
        if (!d.inTaxYear) continue;
        const dt = new Date(d.timestamp);
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
        monthly[key] = (monthly[key] || 0) + Number(d.value || 0);
      }

      if (this.portfolioChart) this.portfolioChart.destroy();
      if (this.dividendChart) this.dividendChart.destroy();

      this.portfolioChart = new Chart(portfolioCanvas, {
        type: 'pie',
        data: { labels, datasets: [{ data: values }] },
        options: { plugins: { legend: { position: 'bottom' } } }
      });

      this.dividendChart = new Chart(dividendCanvas, {
        type: 'bar',
        data: {
          labels: Object.keys(monthly).sort(),
          datasets: [{ label: 'Dividends (£)', data: Object.keys(monthly).sort().map(k => monthly[k]), backgroundColor: '#40916C' }]
        },
        options: { scales: { y: { beginAtZero: true } } }
      });
    },
    hasRequiredTradeHeaders(parsedRows) {
      if (!parsedRows || !parsedRows.length) {
        return false;
      }

      for (let i = 0; i < parsedRows.length; i++) {
        let row = this.normaliseTradeRow(parsedRows[i]);
        if (row.action !== "" && row.time !== "") {
          return true;
        }
      }

      return false;
    },
    //UI Functions:
    back() {
      this.calculated = 0;
      this.resetCalculations();
    },
    removeFile(fileName) {
      if (!fileName) {
        return;
      }

      this.fileList = this.fileList.filter(name => name !== fileName);
      let data = [];
      if (localStorage.getItem("rawData") != null) {
        data = JSON.parse(localStorage.getItem('rawData'));
      }

      data = data.filter(file => file.name !== fileName);
      if (data.length) {
        localStorage.setItem("rawData", JSON.stringify(data));
      } else {
        localStorage.removeItem("rawData");
      }

      this.setUploadStatus("success", `${fileName} removed.`);
    },
    clearFiles() {
      this.fileList = [];
      this.setUploadStatus("", "");
      if (localStorage.getItem("rawData") != null) {
        localStorage.removeItem("rawData");
      }
    },
    resetCalculations() {
      this.setTaxYearBounds(this.taxYear.target);
      this.taxYear.p30Seen = 0;
      this.errorList = [];
      this.purchaseValue = 0;
      this.realisedPl = 0;
      this.disposalCount = 0;
      this.realisedProfit = 0;
      this.realisedLoss = 0;
      this.deposits = [];
      this.withdrawals = [];
      this.dividends = [];
      this.dividendsTotal = 0;
      dividendDetails = {
        uk: 0,
        nonUk: 0,
        taxPaid: 0
      };
      this.freeShares = [];
      this.holdings = {};
      this.taxYearData = {
        realisedProfit: 0,
        realisedLoss: 0,
        disposals: 0,
        costs: 0,
        proceeds: 0,
        dividends: 0,
        roundTrips: []
      };
      this.allRoundTrips = [];
      this.availableTaxYears = [];
    },
    setTaxYearBounds(targetYear) {
      let a = Number(targetYear);
      let b = Number(targetYear) + 1;

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
      let endPlusThirty = new Date(endDate.getTime());
      endPlusThirty.setDate(endPlusThirty.getDate() + 30);

      this.taxYear.start = startDate.getTime();
      this.taxYear.end = endDate.getTime();
      this.taxYear.p30 = endPlusThirty.getTime();
    },
    getTaxYearFromTimestamp(timestamp) {
      let date = new Date(timestamp);
      let year = date.getUTCFullYear();
      let month = date.getUTCMonth();
      let day = date.getUTCDate();

      if (month < 3 || (month === 3 && day < 6)) {
        return year - 1;
      }
      return year;
    },
    buildAvailableTaxYears() {
      let taxYears = {};

      for (let ticker in this.holdings) {
        let ledger = this.holdings[ticker].ledger;
        for (let i = 0; i < ledger.length; i++) {
          if (!isNaN(ledger[i].timestamp)) {
            taxYears[this.getTaxYearFromTimestamp(ledger[i].timestamp)] = true;
          }
        }
      }

      for (let i = 0; i < this.dividends.length; i++) {
        if (!isNaN(this.dividends[i].timestamp)) {
          taxYears[this.getTaxYearFromTimestamp(this.dividends[i].timestamp)] = true;
        }
      }

      this.availableTaxYears = Object.keys(taxYears).map(Number).sort(function (a, b) { return a - b; });

      if (this.availableTaxYears.length && this.availableTaxYears.indexOf(this.taxYear.target) < 0) {
        this.taxYear.target = this.availableTaxYears[this.availableTaxYears.length - 1];
      }
    },
    recalculateTaxYearData() {
      this.setTaxYearBounds(this.taxYear.target);
      this.taxYearData = {
        realisedProfit: 0,
        realisedLoss: 0,
        disposals: 0,
        costs: 0,
        proceeds: 0,
        dividends: 0,
        roundTrips: []
      };

      for (let key in this.holdings) {
        let holding = this.holdings[key];
        holding.tyData = {
          disposalCount: 0,
          realisedLoss: 0,
          realisedProfit: 0
        };

        for (let i = 0; i < holding.ledger.length; i++) {
          let entry = holding.ledger[i];
          entry.inTaxYear = this.inTaxYear(entry.timestamp);

          if (entry.inTaxYear) {
            holding.tyData.realisedProfit += entry.gain;
            holding.tyData.realisedLoss += entry.loss;
            if (entry.change < 0) {
              holding.tyData.disposalCount++;
            }
          }
        }

        this.taxYearData.realisedProfit += holding.tyData.realisedProfit;
        this.taxYearData.realisedLoss += holding.tyData.realisedLoss;
        this.taxYearData.disposals += holding.tyData.disposalCount;
      }

      for (let i = 0; i < this.dividends.length; i++) {
        let div = this.dividends[i];
        div.inTaxYear = this.inTaxYear(div.timestamp);
        if (div.inTaxYear) {
          this.taxYearData.dividends += div.value;
        }
      }

      for (let i = 0; i < this.allRoundTrips.length; i++) {
        let trip = this.allRoundTrips[i];
        if (this.inTaxYear(trip.timestamp)) {
          this.taxYearData.roundTrips.push(trip);
          this.taxYearData.proceeds += Number(trip.proceeds);
          this.taxYearData.costs += Number(trip.cost);
        }
      }
    },
    calculateUnrealisedGain(holding) {
      if (!holding || !holding.ledger || !holding.ledger.length || holding.holdings <= 0) {
        return 0;
      }

      let latestPrice = 0;
      let s104Price = 0;

      for (let i = holding.ledger.length - 1; i >= 0; i--) {
        let entry = holding.ledger[i];
        if (!latestPrice && !isNaN(entry.price) && entry.price > 0) {
          latestPrice = Number(entry.price);
        }
        if (!s104Price && !isNaN(entry.s104Price) && entry.s104Price > 0) {
          s104Price = Number(entry.s104Price);
        }
        if (latestPrice && s104Price) {
          break;
        }
      }

      if (!latestPrice || !s104Price) {
        return 0;
      }

      return (holding.holdings * (latestPrice - s104Price));
    },
    totalUnrealisedGain() {
      let total = 0;
      for (let key in this.holdings) {
        total += this.calculateUnrealisedGain(this.holdings[key]);
      }
      return total;
    },
    //Housekeeping Methods:
    uiAllHoldings(state) {
      for (i in this.holdings) {
        this.holdings[i].uiExpand = state;
      }
    },
    divUkOthersUpdate() {
      tmp = [];
      for (i in this.dividends) {
        let d = this.dividends[i];
        if (!d.ukCompany) {
          tmp.push(d.name);
        }
      }
      this.divUkOthersList = tmp;
      localStorage.setItem("UKOthers", JSON.stringify(tmp));

      //Now propogate change to any other dividends from same Company
      // TODO. Breaks because different divs from same company show different status
      // for (i in this.dividends) {
      //   let d = this.dividends[i];
      //   if (d.isUk) {
      //     d.ukCompany = !this.divUkOthersCheck(d.name);
      //   }
      // }

    },
    divUkOthersCheck(name) {
      let found = 0;
      for (i in this.divUkOthersList) {
        let e = this.divUkOthersList[i];
        if (e === name) {
          found = 1; // Dividend is already in list
        }
      }
      return found;
    },
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
    getIdLink(uid) {
      let text = "";
      text = isNaN(uid) ? "" : `<a href="#${uid}">${uid}</a>`;
      return text;
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
    inTaxYear(timestamp) {
      this.setTaxYearBounds(this.taxYear.target);
      // tax year check
      if (timestamp >= this.taxYear.start && timestamp <= this.taxYear.end) {
        return 1;
      } else {
        return 0;
      }
    },
    //Date must be formatted as YYYY-MMM-DD optionally YYY-MM-DDTHH:MM:SS
    getTimestamp(date) { // Takes in a datestring returns UTC Seconds
      if (date == null || date === "") {
        return NaN;
      }

      // Trading 212 exports can use UK style dates (DD/MM/YYYY HH:mm)
      // or ISO style timestamps depending on account type / export version.
      const dateString = String(date).trim();
      const formats = [
        "dd/MM/yyyy HH:mm",
        "dd/MM/yyyy H:mm",
        "yyyy-MM-dd HH:mm:ss",
        "yyyy-MM-dd H:mm:ss",
        "yyyy-MM-dd"
      ];

      for (let i = 0; i < formats.length; i++) {
        let parsed = luxon.DateTime.fromFormat(dateString, formats[i], { zone: "utc" });
        if (parsed.isValid) {
          return parsed.toMillis();
        }
      }

      let isoParsed = luxon.DateTime.fromISO(dateString, { zone: "utc" });
      if (isoParsed.isValid) {
        return isoParsed.toMillis();
      }

      let timestamp = Date.parse(dateString);
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

      for (i in this.holdings) {
        let holding = this.holdings[i];

        for (j in holding.ledger) {
          let entry = holding.ledger[j];
          j = Number(j);
          if (entry.taxable) {
            let trip = {};
            //Add to Round Trips
            if (entry.rule === "Section 104") {
              trip.dateBought = "";
              trip.cost = (holding.ledger[j - 1].s104Price * Math.abs(entry.change)).toFixed(2);
            } else {
              let buy = this.getLedgerFromUid(entry.matchedUid);
              trip.dateBought = this.getDmyString(buy.timestamp);
              trip.cost = (buy.price * Math.abs(entry.change)).toFixed(2);
            }

            trip.dateSold = this.getDmyString(entry.timestamp);
            trip.timestamp = entry.timestamp;
            trip.asset = holding.ticker;
            trip.name = holding.name;
            trip.amount = Math.abs(entry.change);
            trip.proceeds = (entry.price * Math.abs(entry.change)).toFixed(2);
            trip.gainLoss = (entry.gain - entry.loss).toFixed(2);
            trip.note = entry.rule;

            this.allRoundTrips.push(trip);
          }
        }
      }
      // Now sort trips by date
      this.allRoundTrips.sort(function (a, b) {
        return a.timestamp - b.timestamp;
      });
    },
    downloadRoundTrips() {
      let csv = "";
      csv = csv + `Date Sold, Date Aquired, Asset, Amount, Cost (GBP), Proceeds (GBP), Gain/Loss (GBP), Notes \n`;

      for (i in this.taxYearData.roundTrips) {
        let rt = this.taxYearData.roundTrips[i];
        csv = csv + `${rt.dateSold},${rt.dateBought},${rt.asset},${rt.amount},${rt.cost},${rt.proceeds},${rt.gainLoss},${rt.note}\n`;
      }

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
          link.setAttribute("download", `Trading212 Round Trips Report ${this.fyText} ${this.getDmyString(new Date())}.csv`);
          link.style.visibility = 'hidden';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      }
    },
    // Calculation Methods:
    addFile() {
      var localFile = this.$refs.csvFile.files[0];
      if (!localFile) {
        this.setUploadStatus("error", "No file selected. Please choose a CSV export file.");
        return;
      }
      this.addFileFromBlob(localFile);
    },
    calculate() {
      t = this

      if (!this.acceptedDisclaimer) {
        alert("Please accept the disclaimer before calculating.");
        return;
      }

      let data = [];
      if (localStorage.getItem("rawData") != null) {
        data = JSON.parse(localStorage.getItem('rawData'));

        for (file in data) {
          for (key in data[file].data) {
            trade = data[file].data[key];

            let type = t.getTradeValue(trade, "action", 0);

            let firstword = type.substr(0, type.indexOf(" ")); // reduce to first word only - makes finding different kinds of dividends far easier

            if (type == "Deposit") { //Account Action
              t.newDeposit(trade);
            } else if (type == "Withdrawal") { // Accont Action
              t.newWithdrawal(trade);
            } else if (firstword == "Dividend") {
              t.newDividend(trade);
            } else if (!t.isInstrumentTrade(trade)) {
              continue;
            } else { // Specific Holding Action
              t.newTrade(trade);
            }
          }
        }

        t.sortTrades(); // Organises trades by time
        t.populateLedger();
        t.calculateDisposals();
        t.generateRoundtrips();
        t.buildAvailableTaxYears();
        t.recalculateTaxYearData();
        t.$nextTick(() => t.renderCharts());

        t.calculating = 0;
        t.calculated = 1;
      } else {
        alert("No Files loaded - add your data and try again.");
      }
    },
    isInstrumentTrade(trade) {
      const action = this.getTradeValue(trade, "action", 0);
      if (action == null || action === "") {
        return false;
      }

      const actionLower = String(action).toLowerCase();
      if (!actionLower.includes("buy") && !actionLower.includes("sell")) {
        return false;
      }

      const ticker = this.getTradeValue(trade, "ticker", 3);
      const isin = this.getTradeValue(trade, "isin", 2);
      return ticker !== "" || isin !== "";
    },
    newDeposit(trade) {
      t = this;
      // //special case for free shares:
      // if (this.getTradeValue(trade, "notes", 17) == "Free Shares Promotion") {
      //   // t.addFreeShare(trade);
      //   return;
      // }
      let temp = {
        uid: this.getUID(),
        timestamp: this.getTimestamp(this.getTradeValue(trade, "time", 1)),
        dateString: this.getTradeValue(trade, "time", 1),
        value: this.getTradeValue(trade, "totalGbp", 10)
      };
      // console.log(JSON.stringify(temp));
      if (this.getTradeValue(trade, "notes", 17) == "Free Shares Promotion") {
        this.freeShares.push(temp);
      } else {
        this.deposits.push(temp);
      }
    },
    newWithdrawal(trade) {
      let temp = {
        uid: this.getUID(),
        timestamp: this.getTimestamp(this.getTradeValue(trade, "time", 1)),
        dateString: this.getTradeValue(trade, "time", 1),
        value: this.getTradeValue(trade, "totalGbp", 10)
      };
      this.withdrawals.push(temp);
    },
    newDividend(trade) {
      let temp = {
        uid: this.getUID(),
        ticker: this.getTradeValue(trade, "ticker", 3),
        name: this.getTradeValue(trade, "name", 4),
        timestamp: this.getTimestamp(this.getTradeValue(trade, "time", 1)),
        dateString: this.getTradeValue(trade, "time", 1),
        value: Number(this.getTradeValue(trade, "totalGbp", 10)),
        isUk: this.getTradeValue(trade, "currencyPricePerShare", 7) === "GBX" ? 1 : 0,
        taxCurrency: this.getTradeValue(trade, "currencyPricePerShare", 7),
        taxPaid: this.getTradeValue(trade, "withholdingTax", 11),
        taxPaidGBP: 0,
        exchangeRate: 0,
        ukCompany: 1, // As against fund. This has to be manual user input... maybe checkboxes?
        inTaxYear: this.inTaxYear(this.getTimestamp(this.getTradeValue(trade, "time", 1)))
      };

      //Get UK Others list from Local Storage if it exists
      if (localStorage.getItem("UKOthers") != null) {
        this.divUkOthersList = JSON.parse(localStorage.getItem('UKOthers'));
      }

      // if not UK dividend, calculate any tax paid in GBP. Annoyingly T212 don't provide
      // exchange rate data, but can be calculated from dividend price per share and GBP paid.
      if (!temp.isUk) {
        if (temp.inTaxYear) this.dividendDetails.nonUk += temp.value;
        if (this.getNumber(this.getTradeValue(trade, "withholdingTax", 11)) > 0) { // Tax has been paid
          //Calculate exchange rate: return per share * shares - tax paid / GBP div paid.
          let exRate = ((this.getNumber(this.getTradeValue(trade, "numberOfShares", 5)) * this.getNumber(this.getTradeValue(trade, "pricePerShare", 6))) - this.getNumber(this.getTradeValue(trade, "withholdingTax", 11))) / this.getNumber(this.getTradeValue(trade, "totalGbp", 10));
          console.log(`Exchange Rate: ${exRate} for ${temp.name}`);
          console.log(`rps: ${this.getTradeValue(trade, "numberOfShares", 5)}, numShare: ${this.getTradeValue(trade, "pricePerShare", 6)}, tax: ${this.getTradeValue(trade, "withholdingTax", 11)}, paid: ${this.getTradeValue(trade, "totalGbp", 10)}`);
          temp.taxPaidGBP = this.getNumber(this.getTradeValue(trade, "withholdingTax", 11)) * exRate;
          temp.exchangeRate = exRate;
          if (temp.inTaxYear) this.dividendDetails.taxPaid += temp.taxPaidGBP;
        }
      } else { //uk
        temp.ukCompany = !this.divUkOthersCheck(temp.name);
      }

      //If in tax year, add to tax year data
      if (temp.inTaxYear) {
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
      ticker = this.getTradeValue(trade, "ticker", 3);
      name = this.getTradeValue(trade, "name", 4);
      isin = this.getTradeValue(trade, "isin", 2);

      if (this.getTradeValue(trade, "action", 0).toLowerCase().includes("buy")) {
        // if (trade[0] == "Market buy" || trade[0] == "Limit buy") {
        rawTradeType = "Buy";
      }

      let temp = {
        uid: this.getUID(),
        timestamp: this.getTimestamp(this.getTradeValue(trade, "time", 1)),
        dateString: this.getTradeValue(trade, "time", 1),
        orderType: this.getTradeValue(trade, "action", 0),
        rawType: rawTradeType,
        value: this.getNumber(this.getTradeValue(trade, "totalGbp", 10)),
        // isin: trade[2],
        number: this.getNumber(this.getTradeValue(trade, "numberOfShares", 5)),
        price: this.getNumber(this.getTradeValue(trade, "pricePerShare", 6)),
        priceGBP: this.getNumber(this.getTradeValue(trade, "pricePerShare", 6)) / this.getNumber(this.getTradeValue(trade, "exchangeRate", 8)), // Price / exchange rate
        exchangeRate: this.getNumber(this.getTradeValue(trade, "exchangeRate", 8)),
        result: this.getNumber(this.getTradeValue(trade, "resultGbp", 9)),
        total: this.getNumber(this.getTradeValue(trade, "totalGbp", 10)),
        withholdingTax: this.getNumber(this.getTradeValue(trade, "withholdingTax", 11)),
        wthTaxCurrency: this.getTradeValue(trade, "withholdingTaxCurrency", 12),
        stampDuty: this.getNumber(this.getTradeValue(trade, "stampDutyReserveTaxGbp", 14)),
        transactionFee: this.getNumber(this.getTradeValue(trade, "transactionFeeGbp", 15)),
        finraFee: this.getNumber(this.getTradeValue(trade, "finraFeeGbp", 16)),
        notes: this.getTradeValue(trade, "notes", 17),
        t212ID: this.getTradeValue(trade, "id", 18),
        frenchTransactionTax: this.getNumber(this.getTradeValue(trade, "frenchTransactionTax", 19)),
        wasFree: false,
        inLedger: 0,

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
          tradeCount: 0,
          trades: [],
          ledger: [],
          disposals: [],
          tyData: {
            disposalCount: 0,
            realisedLoss: 0,
            realisedProfit: 0
          },
          uiExpand: 0
        };
      }

      this.holdings[ticker].trades.push(temp);

      if (temp.rawType == "Buy") {
        //Calculate average share price
        if (!isNaN(temp.number)) this.holdings[ticker].holdings += temp.number;
        this.holdings[ticker].tradeCount++;
      } else {
        if (!isNaN(temp.number)) this.holdings[ticker].holdings -= temp.number;
        this.holdings[ticker].disposalCount++;
        this.holdings[ticker].tradeCount++;
      }

    },
    // Added function to clean commas out of number before parsing. Decimal points MUST be . not ,
    getNumber(data) {
      console.log(`Incoming data: ${data}`);
      if (data != "" && data != null) {
        let cleaned = String(data).replace(/,/g, '');
        console.log(`Cleaned Data: ${cleaned}`);
        return (Number(cleaned));
      } else {
        return Number(data);
      }
    },
    sortTrades() {
      // if csv files aren't in chronological order, trades won't be, but
      // following calculations rely on them being in order
      for (i in this.holdings) {
        let holding = this.holdings[i];
        holding.trades.sort(function (a, b) {
          return a.timestamp - b.timestamp;
        });
      }

      //Sort dividends
      this.dividends.sort(function (a, b) {
        return a.timestamp - b.timestamp;
      });

      // lets sort holdings by first trade date too:
      this.holdings = Object.fromEntries(Object.entries(this.holdings).sort(([, a], [, b]) => a.trades[0].timestamp - b.trades[0].timestamp));

    },
    populateLedger() {
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
        exchangeRate: 0,
        tradeCount: 0, // Count of trades combined into one entry in accordance with same day rule
        tradeIDs: [], // ID's of trades combined into one entry in accordance with same day rule
        comment: [],
        counted: 0, // Has this ledger entry already been accounted for in tax calculations.
        gain: 0,
        loss: 0,
        totalPnl: 0,
        s104Total: 0,
        s104Price: 0,
        taxable: 0,
        matchedUid: "", //UID of the buy or sell this entry is counted against
        rule: "", // "Same Day", "30 day BnB" or "Section 104"
        inTaxYear: 0, // Bool, is trade in selected tax year
        sdltPaid: 0 // True or false if SDLT was paid on a buy
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
                    buy.comment.push(`30 day BnB rule, counted against Sell #${sell.uid}`);
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
              entry.comment.push('Added to Section 104 holdings.');
            } else if (i > 0) {
              entry.s104Total = Number(holding.ledger[i - 1].s104Total);
              entry.s104Price = Number(holding.ledger[i - 1].s104Price);
            }
          } else if (entry.change < 0) {
            if (!entry.counted) {
              // Selling section 104 holding
              if (i === 0) {
                console.log(`Error - no history of holdings for disposal #${entry.uid} of ${holding.name}`);
                this.errorList.push({
                  msg: `Error - no history of holdings for disposal #${entry.uid} of ${holding.name}.`,
                  linkedUid: entry.uid
                });
              } else if (Number(Math.abs(entry.change).toFixed(2)) > Number((holding.ledger[i - 1].s104Total).toFixed(2))) { // Only compare to two significant figures, fractional shares cause some confusion otherwise.
                this.errorList.push({
                  msg: `Error - Sale exceeds S401 Holdings for disposal ${entry.uid} of ${holding.name}.`,
                  linkedUid: entry.uid
                });
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
                entry.s104Price = holding.ledger[i - 1].s104Price;

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
          // if (entry.timestamp >= this.taxYear.start && entry.timestamp <= this.taxYear.end) {
          //   entry.inTaxYear = 1;
          // }
          entry.inTaxYear = this.inTaxYear(entry.timestamp);

          if (entry.timestamp > this.taxYear.p30) { // A check that the data goes past the 30 days required to identify bnb trades
            this.taxYear.p30Seen = 1;
            // let d1 = new Date();
            // let d2 = new Date();
            // d1.setTime(entry.timestamp);
            // d2.setTime(this.taxYear.p30);
            // console.log(`P30 Seen @${entry.uid}, ${d1}, ${d2}`)
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

      }
      //error p30 check
      if (!this.taxYear.p30Seen) {
        console.log(`Caution - No data seen past the end of the tax year +30 days. This period is required for the 30 day BnB calculations if applicable`)
        this.errorList.push({
          msg: `Caution - No data seen past the end of the tax year +30 days. This period is required for the 30 day BnB calculations if applicable`,
          linkedUid: ""
        });
      }
    }
  }
})
