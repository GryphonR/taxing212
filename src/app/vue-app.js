/**
 * @file vue-app.js
 * @brief Vue 2 UI layer for taxing212; calculation logic lives in src/lib/.
 */
import Papa from 'papaparse';
import { recalculateForTaxYear, runCalculation } from '../lib/calculation-engine.js';
import {
  hasRequiredTradeHeaders,
  normaliseTradeRow,
} from '../lib/parse/csv-normaliser.js';
import { getDmyString as formatDmyString, getTaxYearBounds } from '../lib/tax/dates.js';
import { buildUkOthersList } from '../lib/tax/uk-others.js';

/**
 * Mount the taxing212 Vue application.
 * @param {import('vue').default} Vue
 */
export function mountApp(Vue) {
  new Vue({
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

              if (!hasRequiredTradeHeaders(results.data)) {
                t.setUploadStatus("error", `${file.name} does not look like a valid Trading 212 history export (missing Action/Time columns).`);
                if (t.$refs.csvFile) t.$refs.csvFile.value = "";
                return;
              }

              file.data = results.data.map(function (row) {
                return normaliseTradeRow(row);
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
          return hasRequiredTradeHeaders(parsedRows);
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
          const bounds = getTaxYearBounds(this.taxYear.target);
          this.taxYear.start = bounds.start;
          this.taxYear.end = bounds.end;
          this.taxYear.p30 = bounds.p30;
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
          const bounds = getTaxYearBounds(targetYear);
          this.taxYear.start = bounds.start;
          this.taxYear.end = bounds.end;
          this.taxYear.p30 = bounds.p30;
        },
        recalculateTaxYearData() {
          const updated = recalculateForTaxYear({
            holdings: this.holdings,
            dividends: this.dividends,
            allRoundTrips: this.allRoundTrips,
            errorList: this.errorList,
            taxYearData: this.taxYearData,
            deposits: this.deposits,
            withdrawals: this.withdrawals,
            availableTaxYears: this.availableTaxYears,
            disposalCount: this.disposalCount,
            realisedProfit: this.realisedProfit,
            realisedLoss: this.realisedLoss,
            realisedPl: this.realisedPl,
            dividendsTotal: this.dividendsTotal,
            dividendDetails: this.dividendDetails,
            taxYear: this.taxYear,
          }, this.taxYear.target);

          this.taxYearData = updated.taxYearData;
          this.errorList = updated.errorList;
          if (updated.taxYear) {
            this.taxYear.start = updated.taxYear.start;
            this.taxYear.end = updated.taxYear.end;
            this.taxYear.p30 = updated.taxYear.p30;
            this.taxYear.p30Seen = updated.taxYear.p30Seen;
          }
        },
        applyCalculationResult(result) {
          this.holdings = result.holdings;
          this.dividends = result.dividends;
          this.deposits = result.deposits;
          this.withdrawals = result.withdrawals;
          this.errorList = result.errorList;
          this.allRoundTrips = result.allRoundTrips;
          this.availableTaxYears = result.availableTaxYears;
          this.taxYearData = result.taxYearData;
          this.disposalCount = result.disposalCount;
          this.realisedProfit = result.realisedProfit;
          this.realisedLoss = result.realisedLoss;
          this.realisedPl = result.realisedPl;
          this.dividendsTotal = result.dividendsTotal;
          this.dividendDetails = result.dividendDetails;
          if (result.taxYear) {
            this.taxYear.target = result.taxYear.target;
            this.taxYear.start = result.taxYear.start;
            this.taxYear.end = result.taxYear.end;
            this.taxYear.p30 = result.taxYear.p30;
            this.taxYear.p30Seen = result.taxYear.p30Seen;
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
        getDmyString(timestamp) {
          return formatDmyString(timestamp);
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
          if (!this.acceptedDisclaimer) {
            alert('Please accept the disclaimer before calculating.');
            return;
          }

          const allRawTrades = [];

          if (localStorage.getItem('rawData') != null) {
            const data = JSON.parse(localStorage.getItem('rawData'));
            for (const file of data) {
              for (const key in file.data) {
                allRawTrades.push(file.data[key]);
              }
            }
          }

          if (allRawTrades.length === 0 && this.manualTrades.length === 0) {
            alert('No trades found - add CSVs or Manual Trades and try again.');
            return;
          }

          const result = runCalculation({
            rawTrades: allRawTrades,
            manualTrades: this.manualTrades,
            corpActions: this.corpActions,
            taxYearTarget: this.taxYear.target,
            ukOthersList: buildUkOthersList(this.divUkOthersList),
          });

          this.applyCalculationResult(result);
          this.calculated = 1;
          this.$nextTick(() => this.renderCharts());
        },
      },
    });
}
