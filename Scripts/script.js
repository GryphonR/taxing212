Vue.config.productionTip = false;

var UID = 0;

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
    uploadStatus: { type: "", message: "" },
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

  mounted() {
    this.$nextTick(() => {
      try {
        const raw = JSON.parse(localStorage.getItem("rawData")) || [];
        raw.forEach(f => this.fileList.push(f.name));
      } catch {
        localStorage.removeItem("rawData");
      }
    });
  },

  computed: {
    fyText() {
      let a = String(this.taxYear.target).slice(-2);
      let b = String(this.taxYear.target + 1).slice(-2);
      return `${a}-${b}FY`;
    },

    sortedTaxYears() {
      return [...this.availableTaxYears].sort((a, b) => b - a);
    },

    filteredHoldings() {
      const h = Object.values(this.holdings || {});
      return this.showErrorsOnly ? h.filter(x => this.holdingHasErrors(x)) : h;
    }
  },

  methods: {

    /* ---------------- SAFE HELPERS ---------------- */

    safeParseLS(key) {
      try {
        return JSON.parse(localStorage.getItem(key)) || [];
      } catch {
        localStorage.removeItem(key);
        return [];
      }
    },

    getUID() {
      return UID++;
    },

    formatCurrency(v) {
      return `£${Number(v || 0).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
    },

    getNumber(v) {
      if (v == null || v === "") return 0;
      return Number(String(v).replace(/,/g, ''));
    },

    /* ---------------- TAX YEAR ---------------- */

    setTaxYearBounds(target) {
      const start = new Date(target, 3, 6).getTime();
      const end = new Date(target + 1, 3, 5).getTime();
      const p30 = end + (1000 * 60 * 60 * 24 * 30);

      this.taxYear.start = start;
      this.taxYear.end = end;
      this.taxYear.p30 = p30;
    },

    inTaxYear(ts) {
      return ts >= this.taxYear.start && ts <= this.taxYear.end;
    },

    /* ---------------- FILE HANDLING ---------------- */

    addFileFromBlob(file) {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        this.setUploadStatus("error", "Not a CSV file");
        return;
      }

      const data = this.safeParseLS("rawData");

      if (data.find(f => f.name === file.name)) {
        this.setUploadStatus("error", "File already loaded");
        return;
      }

      const t = this;

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete(results) {
          if (!results.data?.length) {
            t.setUploadStatus("error", "Empty file");
            return;
          }

          const parsed = results.data.map(r => t.normaliseTradeRow(r));
          data.push({ name: file.name, data: parsed });

          localStorage.setItem("rawData", JSON.stringify(data));
          t.fileList.push(file.name);
          t.setUploadStatus("success", "Uploaded");
        }
      });
    },

    /* ---------------- CALCULATION ENTRY ---------------- */

    calculate() {
      if (!this.acceptedDisclaimer) {
        alert("Accept disclaimer");
        return;
      }

      this.setTaxYearBounds(this.taxYear.target);

      const data = this.safeParseLS("rawData");
      const t = this;

      data.forEach(file => {
        file.data.forEach(trade => {
          const type = t.getTradeValue(trade, "action", 0);
          const first = type.includes(" ") ? type.split(" ")[0] : type;

          if (type === "Deposit") return t.newDeposit(trade);
          if (type === "Withdrawal") return t.newWithdrawal(trade);
          if (first === "Dividend") return t.newDividend(trade);
          if (!t.isInstrumentTrade(trade)) return;

          t.newTrade(trade);
        });
      });

      this.sortTrades();
      this.populateLedger();
      this.calculateDisposals();
      this.generateRoundtrips();
      this.buildAvailableTaxYears();
      this.recalculateTaxYearData();

      this.$nextTick(() => this.renderCharts());

      this.calculated = 1;
    },

    /* ---------------- FIXED FUNCTIONS ---------------- */

    buildAvailableTaxYears() {
      const taxYears = {};

      for (const key in this.holdings) {
        this.holdings[key].ledger.forEach(entry => {
          if (!isNaN(entry.timestamp)) {
            taxYears[this.getTaxYearFromTimestamp(entry.timestamp)] = true;
          }
        });
      }

      for (let i = 0; i < this.dividends.length; i++) {
        const d = this.dividends[i];
        if (!isNaN(d.timestamp)) {
          taxYears[this.getTaxYearFromTimestamp(d.timestamp)] = true;
        }
      }

      this.availableTaxYears = Object.keys(taxYears).map(Number);
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

      for (const key in this.holdings) {
        const h = this.holdings[key];

        h.ledger.forEach(entry => {
          if (this.inTaxYear(entry.timestamp)) {
            this.taxYearData.realisedProfit += entry.gain;
            this.taxYearData.realisedLoss += entry.loss;
            if (entry.change < 0) this.taxYearData.disposals++;
          }
        });
      }

      for (let i = 0; i < this.dividends.length; i++) {
        const d = this.dividends[i];
        if (this.inTaxYear(d.timestamp)) {
          this.taxYearData.dividends += d.value;
        }
      }
    }

  }
});
