# AGENTS.md

## Cursor Cloud specific instructions

Taxing212 is a **fully static, client-side web app** (a UK Capital Gains Tax calculator for Trading 212). On `main` there is no build system, package manager, or backend — just `index.html`, `Scripts/script.js`, and `Styles/style.css`.

### Running the app
- Serve the repo root with any static file server, then open the app. Matching the committed `.vscode/launch.json`, use port 8000:
  - `python3 -m http.server 8000` → open `http://127.0.0.1:8000/index.html`
- There is **no build step** and **no `npm run dev`** on `main`.

### Important caveats
- **Internet is required at runtime.** `index.html` loads Vue, Chart.js, PapaParse, Luxon, SheetJS (xlsx), and decimal.js from public CDNs (jsdelivr / cdnjs). The app will not function offline.
- **State persists in `localStorage`** (uploaded CSV data under `rawData`, plus `corpActions`/`UKOthers`). To start truly fresh use the in-app "Clear Files" button or clear the browser's local storage; a plain reload keeps previously loaded files.
- Input is a **Trading 212 history CSV export**. Required headers include `Action` and `Time` (plus `ISIN`/`Ticker`, `No. of shares`, `Price / share`, `Total`, etc.). `Action` values containing `buy`/`sell` are treated as trades; rows starting with `Dividend`, and `Deposit`/`Withdrawal`, are handled separately.
- The pink **"No data seen past the end of the tax year +30 days"** banner is an expected informational caution (needed for the 30-day bed-&-breakfast rule), not an error, when the loaded history does not extend ~30 days beyond the selected tax year end.
- The Portfolio Allocation pie chart renders empty when all holdings have been fully sold (zero remaining shares) — this is expected, not a broken chart.

### Lint / test / build
- No linter, tests, or build are configured on `main`.
- A Vitest test harness exists only on the unmerged branch `cursor/phase1-vitest-harness-0b26` (adds `package.json`, `vitest.config.js`, `src/`, `test/`). If that branch is merged, install with `npm install` and run tests with `npm test` / `npx vitest`.
