/**
 * @file dates.js
 * @brief UK tax-year and timestamp helpers.
 */
import { DateTime } from 'luxon';

/**
 * Normalise a T212 date string to UTC epoch milliseconds.
 * @param {string|null|undefined} date
 * @returns {number}
 */
export function getTimestamp(date) {
  if (date == null || date === '') {
    return NaN;
  }

  const dateString = String(date).trim();
  const formats = [
    'dd/MM/yyyy HH:mm',
    'dd/MM/yyyy H:mm',
    'yyyy-MM-dd HH:mm:ss',
    'yyyy-MM-dd H:mm:ss',
    'yyyy-MM-dd',
  ];

  for (const format of formats) {
    const parsed = DateTime.fromFormat(dateString, format, { zone: 'utc' });
    if (parsed.isValid) {
      return parsed.toMillis();
    }
  }

  const isoParsed = DateTime.fromISO(dateString, { zone: 'utc' });
  if (isoParsed.isValid) {
    return isoParsed.toMillis();
  }

  return Date.parse(dateString);
}

/**
 * Return true when two UTC timestamps fall on the same calendar day.
 * @param {number} ref
 * @param {number} test
 * @returns {boolean}
 */
export function sameDay(ref, test) {
  const refDate = DateTime.fromMillis(ref);
  const testDate = DateTime.fromMillis(test);

  return refDate.year === testDate.year
    && refDate.month === testDate.month
    && refDate.day === testDate.day;
}

/**
 * Compute UK tax-year bounds for a given start year (e.g. 2023 => 23-24 FY).
 * @param {number} targetYear
 * @returns {{ start: number, end: number, p30: number }}
 */
export function getTaxYearBounds(targetYear) {
  const startYear = Number(targetYear);
  const endYear = startYear + 1;

  // Match the legacy Vue app: local calendar dates for 6 April – 5 April.
  const startDate = new Date(0);
  startDate.setDate(6);
  startDate.setMonth(3);
  startDate.setFullYear(startYear);

  const endDate = new Date(0);
  endDate.setDate(5);
  endDate.setMonth(3);
  endDate.setFullYear(endYear);
  endDate.setHours(23, 59, 59, 999);

  const endPlusThirty = new Date(endDate.getTime());
  endPlusThirty.setDate(endPlusThirty.getDate() + 30);

  return {
    start: startDate.getTime(),
    end: endDate.getTime(),
    p30: endPlusThirty.getTime(),
  };
}

/**
 * Return the UK tax-year start year for a timestamp.
 * @param {number} timestamp
 * @returns {number}
 */
export function getTaxYearFromTimestamp(timestamp) {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  if (month < 3 || (month === 3 && day < 6)) {
    return year - 1;
  }
  return year;
}

/**
 * Return 1 when a timestamp falls inside the configured tax year.
 * @param {number} timestamp
 * @param {{ start: number, end: number }} taxYear
 * @returns {0|1}
 */
export function inTaxYear(timestamp, taxYear) {
  if (timestamp >= taxYear.start && timestamp <= taxYear.end) {
    return 1;
  }
  return 0;
}

/**
 * Format a timestamp as DD-MM-YYYY for reports.
 * @param {number} timestamp
 * @returns {string}
 */
export function getDmyString(timestamp) {
  const date = new Date(timestamp);
  const day = date.getDate() < 10 ? `0${date.getDate()}` : String(date.getDate());
  const month = (date.getMonth() + 1) < 10
    ? `0${date.getMonth() + 1}`
    : String(date.getMonth() + 1);
  return `${day}-${month}-${date.getFullYear()}`;
}
