    Vue.config.productionTip = false;
    // Vue.config.devtools = false;

    var UID = 0;

    var assetPrototype = {}

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
        activeStep: 1,
        activeInputTab: 'csv',
        manualTradeForm: { date: '', action: 'Buy', ticker: '', name: '', shares: '', price: '' },
        manualTrades: [],
        corpActionForm: { type: 'Split', date: '', ticker: '', ratio: '', newTicker: '', newName: '' },
        corpActions: [],
        acceptedDisclaimer: false,
        isDraggingFile: false,
        activeResultsTab: "dashboard",
        showErrorsOnly: false,
        uiRoundTripsExpand: false,
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
            for (let i in tmpFiles) {
              this.fileList.push(tmpFiles[i].name);
            }
          }
          if (localStorage.getItem("manualTrades") != null) {
            this.manualTrades = JSON.parse(localStorage.getItem("manualTrades"));
          }
          if (localStorage.getItem("corpActions") != null) {
            this.corpActions = JSON.parse(localStorage.getItem("corpActions"));
          }
        });

        // Set up the Intersection Observer to dynamically highlight the stepper
        this.$nextTick(() => {
          const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
                if (entry.target.id === 'step1') this.activeStep = 1;
                if (entry.target.id === 'step2') this.activeStep = 2;
                if (entry.target.id === 'step3') this.activeStep = 3;
              }
            });
          }, { threshold: 0.5 });
          
          if(document.getElementById('step1')) observer.observe(document.getElementById('step1'));
          if(document.getElementById('step2')) observer.observe(document.getElementById('step2'));
          if(document.getElementById('step3')) observer.observe(document.getElementById('step3'));
        });
      },
      computed: {
        availableTickers: function() {
          let tickers = new Map();
          
          if (this.fileList.length > 0 && localStorage.getItem("rawData") != null) {
            let data = JSON.parse(localStorage.getItem('rawData'));
            for (let file of data) {
              for (let trade of file.data) {
                if (trade.ticker && !tickers.has(trade.ticker)) {
                  tickers.set(trade.ticker, trade.name);
                }
              }
            }
          }
          
          for (let mt of this.manualTrades) {
            if (mt.ticker && !tickers.has(mt.ticker)) {
              tickers.set(mt.ticker, mt.name);
            }
          }
          
          return Array.from(tickers, ([ticker, name]) => ({ ticker, name })).sort((a, b) => a.ticker.localeCompare(b.ticker));
        },
        fyText: function () {
          let a = Number(this.taxYear.target);
          let b = Number(this.taxYear.target) + 1;

          a = String(a).slice(-2);
          b = String(b).slice(-2);
          return (`${a}-${b}FY`);
        },
        isManualTradeValid: function () {
          return this.manualTradeForm.date && this.manualTradeForm.ticker && this.manualTradeForm.shares !== '';
        },
        isCorpActionValid: function () {
          if (!this.corpActionForm.date || !this.corpActionForm.ticker) return false;
          if (this.corpActionForm.type === 'Split' && !this.corpActionForm.ratio) return false;
          if (this.corpActionForm.type === 'Rename' && !this.corpActionForm.newTicker) return false;
          return true;
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

        }
      },
      methods: {
        safeAdd(a, b) { return new Decimal(a || 0).plus(b || 0).toNumber(); },
        safeSub(a, b) { return new Decimal(a || 0).minus(b || 0).toNumber(); },
        safeMult(a, b) { return new Decimal(a || 0).times(b || 0).toNumber(); },
        safeDiv(a, b) { if (Number(b) === 0) return 0; return new Decimal(a || 0).div(b).toNumber(); },
        autoFillManualName() {
          let found = this.availableTickers.find(t => t.ticker === this.manualTradeForm.ticker);
          if (found && !this.manualTradeForm.name) {
            this.manualTradeForm.name = found.name;
          }
        },
        addManualTrade() {
          if (!this.manualTradeForm.date || !this.manualTradeForm.ticker || !this.manualTradeForm.shares) return;
          this.manualTrades.push({ uid: 'MANUAL-' + Date.now(), ...this.manualTradeForm });
          localStorage.setItem('manualTrades', JSON.stringify(this.manualTrades));
          this.manualTradeForm = { date: '', action: 'Buy', ticker: '', name: '', shares: '', price: '' };
        },
        removeManualTrade(uid) {
          this.manualTrades = this.manualTrades.filter(m => m.uid !== uid);
          localStorage.setItem('manualTrades', JSON.stringify(this.manualTrades));
        },
        addCorpAction() {
          if (!this.corpActionForm.date || !this.corpActionForm.ticker) return;
          this.corpActions.push({ uid: 'CORP-' + Date.now(), ...this.corpActionForm });
          localStorage.setItem('corpActions', JSON.stringify(this.corpActions));
          this.corpActionForm = { type: 'Split', date: '', ticker: '', ratio: '', newTicker: '', newName: '' };
        },
        removeCorpAction(uid) {
          this.corpActions = this.corpActions.filter(c => c.uid !== uid);
          localStorage.setItem('corpActions', JSON.stringify(this.corpActions));
        },
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
          this.dividendDetails = {
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
          this.uiRoundTripsExpand = false;
        },
        setTaxYearBounds(targetYear) {
          const bounds = TaxMath.getTaxYearBounds(targetYear);
          this.taxYear.start = bounds.start;
          this.taxYear.end = bounds.end;
          this.taxYear.p30 = bounds.p30;
        },
        getTaxYearFromTimestamp(timestamp) {
          return TaxMath.getTaxYearFromTimestamp(timestamp);
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
          
          // Reset p30Seen flag and remove old p30 warning for each tax year selection
          this.taxYear.p30Seen = 0;
          this.errorList = this.errorList.filter(error => !error.msg.includes("No data seen past the end of the tax year +30 days"));
          
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

              // Check for p30 data during recalculation
              if (entry.timestamp > this.taxYear.p30) {
                this.taxYear.p30Seen = 1;
              }

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
            
            // Check for p30 data during recalculation
            if (div.timestamp > this.taxYear.p30) {
              this.taxYear.p30Seen = 1;
            }
            
            if (div.inTaxYear) {
              this.taxYearData.dividends += div.value;
            }
          }

          const foreignDividends = TaxMath.recalculateForeignDividendDetails(
            this.dividends,
            (timestamp) => this.inTaxYear(timestamp)
          );
          this.dividendDetails.nonUk = foreignDividends.nonUk;
          this.dividendDetails.taxPaid = foreignDividends.taxPaid;

          for (let i = 0; i < this.allRoundTrips.length; i++) {
            let trip = this.allRoundTrips[i];
            if (this.inTaxYear(trip.timestamp)) {
              this.taxYearData.roundTrips.push(trip);
              this.taxYearData.proceeds += Number(trip.proceeds);
              this.taxYearData.costs += Number(trip.cost);
            }
          }

          // Only add warning if no p30 data was found
          if (!this.taxYear.p30Seen) {
            console.log(`Caution - No data seen past the end of the tax year +30 days. This period is required for the 30 day BnB calculations if applicable`);
            this.errorList.push({
              msg: `Caution - No data seen past the end of the tax year +30 days. This period is required for the 30 day BnB calculations if applicable`,
              linkedUid: ""
            });
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
        goToError(uid) {
          uid = Number(uid);
          for (let key in this.holdings) {
            let holding = this.holdings[key];
            if (holding.ledger && holding.ledger.some(entry => entry.uid === uid)) {
              holding.uiExpand = 1; // Expand the hidden holding section
              
              // Wait for the DOM to update (removes display: none), then scroll
              this.$nextTick(() => {
                const el = document.getElementById(uid);
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  
                  // Briefly highlight the ID span to draw the user's eye
                  const originalColor = el.style.backgroundColor;
                  el.style.backgroundColor = '#fef08a'; // Soft yellow warning highlight
                  el.style.transition = 'background-color 1.5s ease';
                  setTimeout(() => {
                    el.style.backgroundColor = originalColor;
                  }, 1500);
                }
              });
              break;
            }
          }
        },
        getUID() {
          return UID++;
        },
        sameDay(ref, test) {
          return TaxMath.sameDay(ref, test);
        },
        inTaxYear(timestamp) {
          this.setTaxYearBounds(this.taxYear.target);
          return TaxMath.inTaxYear(timestamp, this.taxYear) ? 1 : 0;
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
          for (let i in this.holdings) {
            let holding = this.holdings[i];

            for (let j in holding.ledger) {
              let entry = holding.ledger[j];
              if (entry.uid === uid) {
                return (entry);
              }
            }
          }
        },
        generateRoundtrips() {
          for (let i in this.holdings) {
            let holding = this.holdings[i];

            for (let j in holding.ledger) {
              let entry = holding.ledger[j];
              j = Number(j);
              if (entry.taxable) {
                let trip = {};
                //Add to Round Trips
                if (entry.rule === "Section 104") {
                  trip.dateBought = "";
                  trip.cost = this.safeMult(holding.ledger[j - 1].s104Price, Math.abs(entry.change)).toFixed(2);
                } else {
                  let buy = this.getLedgerFromUid(entry.matchedUid);
                  trip.dateBought = this.getDmyString(buy.timestamp);
                  trip.cost = this.safeMult(buy.price, Math.abs(entry.change)).toFixed(2);
                }

                trip.dateSold = this.getDmyString(entry.timestamp);
                trip.timestamp = entry.timestamp;
                trip.asset = holding.ticker;
                trip.name = holding.name;
                trip.amount = Math.abs(entry.change);
                trip.proceeds = this.safeMult(entry.price, Math.abs(entry.change)).toFixed(2);
                trip.gainLoss = this.safeSub(entry.gain, entry.loss).toFixed(2);
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

          for (let i in this.taxYearData.roundTrips) {
            let rt = this.taxYearData.roundTrips[i];
            csv = csv + `${rt.dateSold},${rt.dateBought},${rt.asset},${rt.amount},${rt.cost},${rt.proceeds},${rt.gainLoss},${rt.note}\n`;
          }

          var blob = new Blob([csv], {
            type: 'text/csv;charset=utf-8;'
          });
          if (navigator.msSaveBlob) { // IE 10+
            navigator.msSaveBlob(blob, filename);
          } else {
            var link = document.createElement("a");
            if (link.download !== undefined) { // feature detection
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
        downloadFullSummary() {
          if (typeof XLSX === 'undefined') {
            alert('Export library is still loading, please try again in a moment.');
            return;
          }

          const wb = XLSX.utils.book_new();

          // 1. Summary Sheet
          const summaryData = [
            ["Category", "Tax Year " + this.fyText, "All Time"],
            ["Disposal Count", this.taxYearData.disposals, this.disposalCount],
            ["Disposal Proceeds (£)", this.taxYearData.proceeds.toFixed(2), ""],
            ["Total Acquisition Costs (£)", this.taxYearData.costs.toFixed(2), ""],
            ["Total Realised Profit (£)", this.taxYearData.realisedProfit.toFixed(2), this.realisedProfit.toFixed(2)],
            ["Total Realised Loss (£)", this.taxYearData.realisedLoss.toFixed(2), this.realisedLoss.toFixed(2)],
            ["Combined P/L (£)", (this.taxYearData.realisedProfit - this.taxYearData.realisedLoss).toFixed(2), (this.realisedProfit - this.realisedLoss).toFixed(2)],
            ["Dividends Received (£)", this.taxYearData.dividends.toFixed(2), this.dividendsTotal.toFixed(2)],
            ["Unrealised Capital Gain (£)", "", this.totalUnrealisedGain().toFixed(2)]
          ];
          const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
          XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

          // 2. Round Trips Sheet
          const rtData = this.taxYearData.roundTrips.map(t => ({
            "Date Sold": t.dateSold,
            "Date Acquired": t.dateBought,
            "Asset": t.asset,
            "Amount": Number(t.amount).toFixed(2),
            "Cost (£)": t.cost,
            "Proceeds (£)": t.proceeds,
            "P/L (£)": t.gainLoss,
            "Notes": t.note
          }));
          if(rtData.length === 0) rtData.push({"Date Sold": "No round trips for this tax year"});
          const wsRT = XLSX.utils.json_to_sheet(rtData);
          XLSX.utils.book_append_sheet(wb, wsRT, "Round Trips");

          // 3. Dividends Sheet
          const divData = this.dividends.filter(d => d.inTaxYear).map(d => ({
            "Date": this.getDmyString(d.timestamp),
            "Name": d.name,
            "Ticker": d.ticker,
            "Value (£)": d.value.toFixed(2),
            "UK Company": d.isUk && d.ukCompany ? "Yes" : "No",
            "Other UK": d.isUk && !d.ukCompany ? "Yes" : "No",
            "Foreign": !d.isUk ? "Yes" : "No",
            "Tax Paid (£)": !d.isUk ? d.taxPaidGBP.toFixed(2) : "0.00"
          }));
          if(divData.length === 0) divData.push({"Date": "No dividends for this tax year"});
          const wsDiv = XLSX.utils.json_to_sheet(divData);
          XLSX.utils.book_append_sheet(wb, wsDiv, "Dividends");

          // 4. Holdings Sheet
          const hData = [];
          for (let key in this.holdings) {
            let h = this.holdings[key];
            hData.push({
              "Asset": h.name,
              "Ticker": h.ticker,
              "Open Position": h.holdings.toFixed(2),
              "Trade Count": h.tradeCount,
              "Total P/L (£)": h.realisedPl.toFixed(2),
              "Tax Year P/L (£)": (h.tyData.realisedProfit - h.tyData.realisedLoss).toFixed(2),
              "Tax Year Disposals": h.tyData.disposalCount
            });
          }
          if(hData.length === 0) hData.push({"Asset": "No holdings found"});
          const wsH = XLSX.utils.json_to_sheet(hData);
          XLSX.utils.book_append_sheet(wb, wsH, "Holdings");

          // Export the Excel file
          XLSX.writeFile(wb, `Taxing212_Full_Summary_${this.fyText}.xlsx`);
        },
        // Calculation Methods:
        addFile() {
          var files = this.$refs.csvFile.files;
          if (!files || files.length === 0) {
            this.setUploadStatus("error", "No file selected. Please choose a CSV export file.");
            return;
          }
          
          for (let i = 0; i < files.length; i++) {
            this.addFileFromBlob(files[i]);
          }
        },
        calculate() {
          let t = this;

          if (!this.acceptedDisclaimer) {
            alert("Please accept the disclaimer before calculating.");
            return;
          }

          let allRawTrades = [];

          if (localStorage.getItem("rawData") != null) {
            let data = JSON.parse(localStorage.getItem('rawData'));
            for (let file in data) {
              for (let key in data[file].data) {
                allRawTrades.push(data[file].data[key]);
              }
            }
          }

          for (let mt of this.manualTrades) {
             allRawTrades.push({
                action: mt.action,
                time: mt.date.replace('T', ' '),
                isin: "",
                ticker: mt.ticker,
                name: mt.name || mt.ticker,
                numberOfShares: mt.shares,
                pricePerShare: mt.price,
                currencyPricePerShare: "GBP",
                exchangeRate: 1,
                resultGbp: 0,
                totalGbp: this.safeMult(mt.shares, mt.price),
                withholdingTax: 0,
                withholdingTaxCurrency: "GBP",
                stampDutyReserveTaxGbp: 0,
                transactionFeeGbp: 0,
                finraFeeGbp: 0,
                notes: "Manual Transfer",
                id: mt.uid,
                frenchTransactionTax: 0
             });
          }

          if (allRawTrades.length === 0) {
            alert("No trades found - add CSVs or Manual Trades and try again.");
            return;
          }

          // Apply Corporate Actions
          for (let action of this.corpActions) {
             let actionTime = new Date(action.date).getTime();
             for (let trade of allRawTrades) {
                let tradeTime = this.getTimestamp(t.getTradeValue(trade, "time", 1));
                let ticker = t.getTradeValue(trade, "ticker", 3);
                
                if (tradeTime < actionTime && ticker === action.ticker) {
                   if (action.type === 'Split') {
                      trade.numberOfShares = this.safeMult(trade.numberOfShares, action.ratio);
                      trade.pricePerShare = this.safeDiv(trade.pricePerShare, action.ratio);
                   } else if (action.type === 'Rename') {
                      trade.ticker = action.newTicker;
                      trade.name = action.newName || trade.name;
                   }
                }
             }
          }

          for (let trade of allRawTrades) {
            let type = t.getTradeValue(trade, "action", 0);
            let firstword = type.substr(0, type.indexOf(" "));

            if (type == "Deposit") { 
              t.newDeposit(trade);
            } else if (type == "Withdrawal") { 
              t.newWithdrawal(trade);
            } else if (firstword == "Dividend") {
              t.newDividend(trade);
            } else if (!t.isInstrumentTrade(trade)) {
              continue;
            } else { 
              t.newTrade(trade);
            }
          }

          t.sortTrades(); 
          t.populateLedger();
          t.calculateDisposals();
          t.generateRoundtrips();
          t.buildAvailableTaxYears();
          t.recalculateTaxYearData();

          t.calculating = 0;
          t.calculated = 1;

          t.$nextTick(() => t.renderCharts());
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
          let t = this;
          let temp = {
            uid: this.getUID(),
            timestamp: this.getTimestamp(this.getTradeValue(trade, "time", 1)),
            dateString: this.getTradeValue(trade, "time", 1),
            value: this.getTradeValue(trade, "totalGbp", 10)
          };
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
            ukCompany: 1, 
            inTaxYear: this.inTaxYear(this.getTimestamp(this.getTradeValue(trade, "time", 1)))
          };

          if (localStorage.getItem("UKOthers") != null) {
            this.divUkOthersList = JSON.parse(localStorage.getItem('UKOthers'));
          }

          if (!temp.isUk) {
            if (temp.inTaxYear) this.dividendDetails.nonUk += temp.value;
            if (this.getNumber(this.getTradeValue(trade, "withholdingTax", 11)) > 0) {
              let exRate = ((this.getNumber(this.getTradeValue(trade, "numberOfShares", 5)) * this.getNumber(this.getTradeValue(trade, "pricePerShare", 6))) - this.getNumber(this.getTradeValue(trade, "withholdingTax", 11))) / this.getNumber(this.getTradeValue(trade, "withholdingTax", 11));
              temp.taxPaidGBP = this.getNumber(this.getTradeValue(trade, "withholdingTax", 11)) * exRate;
              temp.exchangeRate = exRate;
              if (temp.inTaxYear) this.dividendDetails.taxPaid += temp.taxPaidGBP;
            }
          } else { 
            temp.ukCompany = !this.divUkOthersCheck(temp.name);
          }

          if (temp.inTaxYear) {
            this.taxYearData.dividends += temp.value;
          }
          if (temp.timestamp > this.taxYear.p30) {
            this.taxYear.p30Seen = 1;
          }
          this.dividendsTotal += temp.value;
          this.dividends.push(temp);
        },
        newTrade(trade) {
          let rawTradeType = "Sell";
          let ticker = this.getTradeValue(trade, "ticker", 3);
          let name = this.getTradeValue(trade, "name", 4);
          let isin = this.getTradeValue(trade, "isin", 2);

          if (this.getTradeValue(trade, "action", 0).toLowerCase().includes("buy")) {
            rawTradeType = "Buy";
          }

          const numberOfShares = this.getNumber(this.getTradeValue(trade, "numberOfShares", 5));
          const pricePerShare = this.getNumber(this.getTradeValue(trade, "pricePerShare", 6));
          const exchangeRate = this.getNumber(this.getTradeValue(trade, "exchangeRate", 8)) || 1;
          const totalGbp = this.getNumber(this.getTradeValue(trade, "totalGbp", 10));
          const stampDuty = this.getNumber(this.getTradeValue(trade, "stampDutyReserveTaxGbp", 14));
          const transactionFee = this.getNumber(this.getTradeValue(trade, "transactionFeeGbp", 15));
          const finraFee = this.getNumber(this.getTradeValue(trade, "finraFeeGbp", 16));
          const frenchTransactionTax = this.getNumber(this.getTradeValue(trade, "frenchTransactionTax", 19));
          const priceGBP = TaxMath.effectivePricePerShare(
            rawTradeType,
            numberOfShares,
            pricePerShare,
            exchangeRate,
            totalGbp,
            {
              stampDuty: stampDuty,
              transactionFee: transactionFee,
              finraFee: finraFee,
              frenchTransactionTax: frenchTransactionTax
            }
          );

          let temp = {
            uid: this.getUID(),
            timestamp: this.getTimestamp(this.getTradeValue(trade, "time", 1)),
            dateString: this.getTradeValue(trade, "time", 1),
            orderType: this.getTradeValue(trade, "action", 0),
            rawType: rawTradeType,
            value: totalGbp,
            number: numberOfShares,
            price: pricePerShare,
            priceGBP: priceGBP,
            exchangeRate: exchangeRate,
            result: this.getNumber(this.getTradeValue(trade, "resultGbp", 9)),
            total: totalGbp,
            withholdingTax: this.getNumber(this.getTradeValue(trade, "withholdingTax", 11)),
            wthTaxCurrency: this.getTradeValue(trade, "withholdingTaxCurrency", 12),
            stampDuty: stampDuty,
            transactionFee: transactionFee,
            finraFee: finraFee,
            notes: this.getTradeValue(trade, "notes", 17),
            t212ID: this.getTradeValue(trade, "id", 18),
            frenchTransactionTax: frenchTransactionTax,
            wasFree: false,
            inLedger: 0,
          };

          if (!(ticker in this.holdings)) {
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
            if (!isNaN(temp.number)) this.holdings[ticker].holdings += temp.number;
            this.holdings[ticker].tradeCount++;
          } else {
            if (!isNaN(temp.number)) this.holdings[ticker].holdings -= temp.number;
            this.holdings[ticker].disposalCount++;
            this.holdings[ticker].tradeCount++;
          }
        },
        getNumber(data) {
          if (data != "" && data != null) {
            let cleaned = String(data).replace(/,/g, '');
            return (Number(cleaned));
          } else {
            return Number(data);
          }
        },
        sortTrades() {
          for (let i in this.holdings) {
            let holding = this.holdings[i];
            holding.trades.sort(function (a, b) {
              return a.timestamp - b.timestamp;
            });
          }

          this.dividends.sort(function (a, b) {
            return a.timestamp - b.timestamp;
          });

          this.holdings = Object.fromEntries(Object.entries(this.holdings).sort(([, a], [, b]) => a.trades[0].timestamp - b.trades[0].timestamp));
        },
        populateLedger() {
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
            matchedUid: "", 
            rule: "", 
            inTaxYear: 0, 
            sdltPaid: 0 
          }

          for (let key in this.holdings) { 
            var holding = this.holdings[key]; 
            for (let tradeKey in holding.trades) { 
              var t = holding.trades[tradeKey];

              if (!t.inLedger) { 
                let temp = JSON.parse(JSON.stringify(ledgerProto));
                temp.uid = this.getUID();
                temp.timestamp = t.timestamp;
                temp.change = t.rawType == "Buy" ? t.number : -t.number;
                temp.price = t.priceGBP;
                temp.tradeCount = 1;
                temp.tradeIDs.push(t.uid);
                holding.ledger.push(temp);
                t.inLedger = 1; 
              }

              let ledgerIndex = holding.ledger.length - 1; 
              let currTradeType = t.rawType;

              for (let i in holding.trades) {
                let compTrade = holding.trades[i];
                if (!compTrade.inLedger) { 
                  if (compTrade.rawType === currTradeType) { 
                    if (this.sameDay(t.timestamp, compTrade.timestamp)) {
                      holding.ledger[ledgerIndex].tradeIDs.push(compTrade.uid);
                      holding.ledger[ledgerIndex].tradeCount++;

                      let newTradeChange = compTrade.rawType == "Buy" ? compTrade.number : -compTrade.number;
                      holding.ledger[ledgerIndex].change = this.safeAdd(holding.ledger[ledgerIndex].change, newTradeChange);
                      holding.ledger[ledgerIndex].price = TaxMath.mergeSameDayPrice(
                        this.safeSub(holding.ledger[ledgerIndex].change, newTradeChange),
                        holding.ledger[ledgerIndex].price,
                        newTradeChange,
                        compTrade.priceGBP
                      );

                      compTrade.inLedger = 1; 
                      if (holding.ledger[ledgerIndex].tradeCount > 2) holding.ledger[ledgerIndex].comment.pop();
                      holding.ledger[ledgerIndex].comment.push(`${holding.ledger[ledgerIndex].tradeCount} trades merged for Same Day Rule.`);
                    }
                  }
                }
              }
            }
          }
        },
        calculateDisposals() {
          for (let key in this.holdings) { 
            var holding = this.holdings[key];

            for (let i in holding.ledger) {
              let sell = holding.ledger[i];

              if (sell.change < 0 && !sell.counted) { 
                for (let j in holding.ledger) {
                  let buy = holding.ledger[j];
                  if (this.sameDay(sell.timestamp, buy.timestamp) && buy.change > 0 && !buy.counted) {
                    if ((sell.change + buy.change) === 0) {
                      let tmp = this.safeSub(this.safeMult(Math.abs(sell.change), sell.price), this.safeMult(buy.change, buy.price));
                      if (tmp > 0) {
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
                      if (Math.abs(sell.change) > buy.change) { 
                        sell.comment.push(`Entry split for sameday rule matching Buy entry #${buy.uid}`);
                        let sellCopy = JSON.parse(JSON.stringify(sell));
                        sellCopy.uid = this.getUID();
                        sell.change = -buy.change;
                        sellCopy.change = this.safeSub(sellCopy.change, sell.change);

                        holding.ledger.splice(i, 0, sellCopy);

                        let tmp = this.safeSub(this.safeMult(Math.abs(sell.change), sell.price), this.safeMult(buy.change, buy.price));
                        if (tmp > 0) {
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
                        buy.comment.push(`Entry split for sameday rule matching Sell entry #${sell.uid}`);
                        let buyCopy = JSON.parse(JSON.stringify(buy));
                        buyCopy.uid = this.getUID();
                        buy.change = Math.abs(sell.change);
                        buyCopy.change = this.safeSub(buyCopy.change, buy.change);

                        let tmp = this.safeSub(this.safeMult(Math.abs(sell.change), sell.price), this.safeMult(buy.change, buy.price));
                        if (tmp > 0) {
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
                      }
                    }
                  }
                }
              }
            }

            for (let i in holding.ledger) {
              let buy = holding.ledger[i];

              if (buy.change > 0 && !buy.counted) { 
                for (let j in holding.ledger) {
                  let sell = holding.ledger[j];
                  if (sell.change < 0 && !sell.counted) { 
                    if (TaxMath.isWithinBedAndBreakfastWindow(sell.timestamp, buy.timestamp)) {
                      if (sell.change + buy.change === 0) { 
                        sell.counted = 1;
                        sell.comment.push(`30 day BnB rule, counted against Buy #${buy.uid}`);
                        buy.counted = 1;
                        buy.comment.push(`30 day BnB rule, counted against Sell #${sell.uid}`);

                        let tmp = this.safeSub(this.safeMult(Math.abs(sell.change), sell.price), this.safeMult(buy.change, buy.price));

                        if (tmp > 0) {
                          buy.gain = tmp;
                        } else {
                          buy.loss = Math.abs(tmp);
                        }

                        sell.rule = "30 Day BnB";
                        sell.totalPnl = tmp;
                        sell.taxable = 1;
                        sell.matchedUid = buy.uid;

                      } else if (sell.change + buy.change < 0) { 
                        let sellCopy = JSON.parse(JSON.stringify(sell));
                        sellCopy.uid = this.getUID();

                        sell.change = -buy.change;
                        sellCopy.change = this.safeSub(sellCopy.change, sell.change);
                        sell.counted = 1;
                        buy.counted = 1;
                        buy.comment.push(`30 day BnB rule, counted against Sell #${sell.uid}`);
                        sell.comment.push(`Entry split into #${sellCopy.uid} for 30 day rule matching Buy entry #${buy.uid}`);

                        let tmp = this.safeSub(this.safeMult(Math.abs(sell.change), sell.price), this.safeMult(buy.change, buy.price));

                        if (tmp > 0) {
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
                        break;

                      } else if (sell.change + buy.change > 0) { 
                        let buyCopy = JSON.parse(JSON.stringify(buy));
                        buyCopy.uid = this.getUID();

                        buy.change = -(sell.change); 
                        buyCopy.change = this.safeSub(buyCopy.change, buy.change); 
                        sell.counted = 1;
                        buy.counted = 1;
                        buy.comment.push(`Entry split into #${buyCopy.uid} for 30 day rule and matched to Sell entry #${sell.uid}`);
                        sell.comment.push(`30 day BnB rule, counted against Buy #${buy.uid}`);

                        let tmp = this.safeSub(this.safeMult(Math.abs(sell.change), sell.price), this.safeMult(buy.change, buy.price));

                        if (tmp > 0) {
                          sell.gain = tmp;
                        } else {
                          sell.loss = Math.abs(tmp);
                        }

                        sell.rule = "30 Day BnB";
                        sell.totalPnl = tmp;
                        sell.taxable = 1;
                        sell.matchedUid = buy.uid;

                        let newPos = Number(i) + 1;
                        holding.ledger.splice(newPos, 0, buyCopy);
                        break;
                      }
                    }
                  }
                }
              }
            } 

            for (let i in holding.ledger) {
              let entry = holding.ledger[i];
              i = Number(i);
              if (entry.change > 0) { 
                if (!entry.counted) {
                  if (i === 0) {
                    entry.s104Total = entry.change;
                    entry.s104Price = entry.price;
                  } else {
                    entry.s104Total = this.safeAdd(holding.ledger[i - 1].s104Total, entry.change);
                    let totalCost = this.safeAdd(this.safeMult(holding.ledger[i - 1].s104Total, holding.ledger[i - 1].s104Price), this.safeMult(entry.change, entry.price));
                    entry.s104Price = this.safeDiv(totalCost, entry.s104Total);
                  }
                  entry.comment.push('Added to Section 104 holdings.');
                } else if (i > 0) {
                  entry.s104Total = Number(holding.ledger[i - 1].s104Total);
                  entry.s104Price = Number(holding.ledger[i - 1].s104Price);
                }
              } else if (entry.change < 0) {
                if (!entry.counted) {
                  if (i === 0) {
                    console.log(`Error - no history of holdings for disposal #${entry.uid} of ${holding.name}`);
                    this.errorList.push({
                      msg: `Error - no history of holdings for disposal #${entry.uid} of ${holding.name}.`,
                      linkedUid: entry.uid
                    });
                  } else if (Number(Math.abs(entry.change).toFixed(2)) > Number((holding.ledger[i - 1].s104Total).toFixed(2))) { 
                    this.errorList.push({
                      msg: `Error - Sale exceeds S401 Holdings for disposal ${entry.uid} of ${holding.name}.`,
                      linkedUid: entry.uid
                    });
                  } else {
                    let tmp = this.safeSub(this.safeMult(Math.abs(entry.change), entry.price), this.safeMult(Math.abs(entry.change), holding.ledger[i - 1].s104Price));
                    entry.s104Total = this.safeSub(holding.ledger[i - 1].s104Total, Math.abs(entry.change));
                    if (tmp > 0) {
                      entry.gain = tmp;
                    } else {
                      entry.loss = Math.abs(tmp);
                    }
                    entry.rule = "Section 104";
                    entry.totalPnl = tmp;
                    entry.taxable = 1;
                    entry.matchedUid = "Section 104";
                    entry.s104Price = holding.ledger[i - 1].s104Price;
                    entry.comment.push(`Gain calculated against Section 104 Holdings`);
                  }
                } else if (i > 0) {
                  entry.s104Total = Number(holding.ledger[i - 1].s104Total);
                  entry.s104Price = Number(holding.ledger[i - 1].s104Price);
                }
              }
            }

            for (let i in holding.ledger) {
              let entry = holding.ledger[i];
              entry.inTaxYear = this.inTaxYear(entry.timestamp);

              if (entry.timestamp > this.taxYear.p30) { 
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

            this.taxYearData.realisedProfit += holding.tyData.realisedProfit;
            this.taxYearData.realisedLoss += holding.tyData.realisedLoss;
            this.taxYearData.disposals += holding.tyData.disposalCount;

            this.realisedPl += Number(holding.realisedPl);
            this.realisedLoss += Number(holding.realisedLoss);
            this.realisedProfit += Number(holding.realisedProfit);
            this.disposalCount += Number(holding.disposalCount);
          }

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
