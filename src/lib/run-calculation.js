/**
 * @file run-calculation.js
 * @brief Public entry point for the taxing212 calculation engine.
 */
export { runCalculation, recalculateForTaxYear, resetUidCounter } from './calculation-engine.js';
export { parseCsvText, normaliseTradeRow, hasRequiredTradeHeaders } from './parse/csv-normaliser.js';
export { getTaxYearBounds, getTimestamp, inTaxYear } from './tax/dates.js';
export { REQUIRED_T212_FIELDS } from './config/t212-fields.js';
