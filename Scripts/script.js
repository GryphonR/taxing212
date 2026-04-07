// KEY FIX 1: Portfolio Chart - Fallback to Section 104 price
// Location: renderCharts() method, lines 328-341
// BEFORE:
const price = (h.ledger || []).length ? Number(h.ledger[h.ledger.length - 1].price || 0) : 0;

// AFTER:
let price = 0;
if (h.ledger && h.ledger.length) {
  const lastEntry = h.ledger[h.ledger.length - 1];
  price = Number(lastEntry.price || 0);
  // If no market price, try Section 104 price as fallback
  if (price <= 0) {
    price = Number(lastEntry.s104Price || 0);
  }
}

// KEY FIX 2: Monthly Dividend Chart - Set inTaxYear before filtering
// Location: renderCharts() method, lines 343-351
// BEFORE:
for (let i = 0; i < this.dividends.length; i++) {
  const d = this.dividends[i];
  if (!d.inTaxYear) continue;

// AFTER:
for (let i = 0; i < this.dividends.length; i++) {
  const d = this.dividends[i];
  // Ensure inTaxYear is set
  d.inTaxYear = this.inTaxYear(d.timestamp);
  if (!d.inTaxYear) continue;

// KEY FIX 3: Chart responsiveness and color palette
// Add colors to portfolio chart and enable responsive mode on both:
portfolioChartInstance = new Chart(portfolioCanvas, {
  type: 'pie',
  data: { labels, datasets: [{ data: values, backgroundColor: [
    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40',
    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'
  ]}] },
  options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
});

dividendChartInstance = new Chart(dividendCanvas, {
  type: 'bar',
  data: {
    labels: Object.keys(monthly).sort(),
    datasets: [{ label: 'Dividends (£)', data: Object.keys(monthly).sort().map(k => monthly[k]), backgroundColor: '#40916C' }]
  },
  options: { responsive: true, scales: { y: { beginAtZero: true } } }
});
