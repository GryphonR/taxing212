Vue.config.productionTip = false;
// Vue.config.devtools = false;

var UID = 0;

// Store chart instances completely outside of Vue's reactivity system
// to prevent Vue from wrapping the deep Chart.js objects, which
// can cause chart blanking/crashing.
var portfolioChartInstance = null;
var dividendChartInstance = null;

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
    showErrorsOnly: false,
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
        for (let i in tmpFiles) {
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
      for (let i in this.dividends) {
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
      for (let i in this.dividends) {
        let d = this.dividends[i];
        if (d.inTaxYear && !d.ukCompany && d.isUk) {
          sum += d.value;
        }
      }
      return (sum.toFixed(2));
    },
    hasOpenPositions: function() {
      for (let key in this.holdings) {
        if (Number(this.holdings[key].holdings) > 0) return true;
      }
      return false;
    },
    hasDividendsInTaxYear: function() {
      return this.dividends.some(d => d.inTaxYear);
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
      
      // Loop through all dropped files
      const files = event.dataTransfer.files;
      for (let i = 0; i < files.length; i++) {
        this.addFileFromBlob(files[i]);
      }
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

      // 1. Prepare Portfolio Data
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

      // 2. Prepare Dividend Data
      const monthly = {};
      for (let i = 0; i < this.dividends.length; i++) {
        const d = this.dividends[i];
        if (!d.inTaxYear) continue;
        const dt = new Date(d.timestamp);
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
        monthly[key] = (monthly[key] || 0) + Number(d.value || 0);
      }

      // Destroy old charts to prevent duplicate canvases or memory leaks
      if (portfolioChartInstance) {
        portfolioChartInstance.destroy();
        portfolioChartInstance = null;
      }
      if (dividendChartInstance) {
        dividendChartInstance.destroy();
        dividendChartInstance = null;
      }

      // Initialize Portfolio Chart
      if (portfolioCanvas && labels.length > 0) {
        portfolioChartInstance = new Chart(portfolioCanvas, {
          type: 'pie',
          data: { labels, datasets: [{ data: values }] },
          options: { plugins: { legend: { position: 'bottom' } } }
        });
      }

      // Initialize Dividend Chart
      if (dividendCanvas && Object.keys(monthly).length > 0) {
        dividendChartInstance = new Chart(dividendCanvas, {
          type: 'bar',
          data: {
            labels: Object.keys(monthly).sort(),
            datasets: [{ label: 'Dividends (£)', data: Object.keys(monthly).sort().map(k => monthly[k]), backgroundColor: '#40916C' }]
          },
          options: { scales: { y: { beginAtZero: true } } }
        });
      }
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
      let dividendDetails = {
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
      for (let i in this.holdings) {
        this.holdings[i].uiExpand = state;
      }
    },
    divUkOthersUpdate() {
      let tmp = [];
      for (let i in this.dividends) {
        let d = this.dividends[i];
        if (!d.ukCompany) {
          tmp.push(d.name);
        }
      }
      this.divUkOthersList = tmp;
      localStorage.setItem("UKOthers", JSON.stringify(tmp));
    },
    divUkOthersCheck(name) {
      let found = 0;
      for (let i in this.divUkOthersList) {
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
    getTimestamp(date) { // Takes in a da
