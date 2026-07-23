/**
 * @file csv-normaliser.js
 * @brief Trading 212 CSV row normalisation helpers.
 */
import Papa from 'papaparse';
import { REQUIRED_T212_FIELDS } from '../config/t212-fields.js';

/**
 * Lower-case and trim a CSV header for fuzzy matching.
 * @param {string|null|undefined} header
 * @returns {string}
 */
export function normaliseHeaderName(header) {
  return header == null ? '' : String(header).trim().toLowerCase();
}

/**
 * Read the first matching value for a list of possible header names.
 * @param {Record<string, unknown>} row
 * @param {string[]} headerOptions
 * @returns {unknown}
 */
export function getFieldByHeader(row, headerOptions) {
  if (row == null) {
    return '';
  }

  for (const option of headerOptions) {
    if (option in row && row[option] != null) {
      return row[option];
    }
  }

  const normalisedOptions = headerOptions.map((option) => normaliseHeaderName(option));
  for (const key in row) {
    if (normalisedOptions.indexOf(normaliseHeaderName(key)) >= 0 && row[key] != null) {
      return row[key];
    }
  }

  return '';
}

/**
 * Map a raw CSV row object onto the internal trade field schema.
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function normaliseTradeRow(row) {
  const normalisedTrade = {};

  for (const field in REQUIRED_T212_FIELDS) {
    normalisedTrade[field] = getFieldByHeader(row, REQUIRED_T212_FIELDS[field]);
  }

  return normalisedTrade;
}

/**
 * Read a field from either a normalised object or a legacy array row.
 * @param {Record<string, unknown>|unknown[]} trade
 * @param {string} field
 * @param {number} legacyIndex
 * @returns {unknown}
 */
export function getTradeValue(trade, field, legacyIndex) {
  if (trade != null && typeof trade === 'object' && !Array.isArray(trade) && field in trade) {
    return trade[field];
  }

  if (Array.isArray(trade)) {
    return trade[legacyIndex];
  }

  return '';
}

/**
 * Parse CSV text into normalised trade row objects.
 * @param {string} csvText
 * @returns {Record<string, unknown>[]}
 */
export function parseCsvText(csvText) {
  const result = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
  });

  if (result.errors.length > 0) {
    throw new Error(`CSV parse error: ${result.errors[0].message}`);
  }

  return result.data.map((row) => normaliseTradeRow(row));
}

/**
 * Return true when parsed rows contain at least one trade-like record.
 * @param {Record<string, unknown>[]} parsedRows
 * @returns {boolean}
 */
export function hasRequiredTradeHeaders(parsedRows) {
  if (!parsedRows || !parsedRows.length) {
    return false;
  }

  for (const row of parsedRows) {
    const normalised = normaliseTradeRow(row);
    if (normalised.action !== '' && normalised.time !== '') {
      return true;
    }
  }

  return false;
}
