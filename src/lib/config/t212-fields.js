/**
 * @file t212-fields.js
 * @brief Column header aliases for Trading 212 CSV exports.
 *
 * Maps internal field names to one or more possible T212 header labels so the
 * parser survives column-order changes between export versions.
 */
export const REQUIRED_T212_FIELDS = {
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
  frenchTransactionTax: ["French transaction tax"],
};
