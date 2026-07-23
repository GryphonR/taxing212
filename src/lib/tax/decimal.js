/**
 * @file decimal.js
 * @brief Decimal-safe arithmetic helpers for tax calculations.
 */
import Decimal from 'decimal.js';

/**
 * Add two numeric values using decimal arithmetic.
 * @param {number|string} a
 * @param {number|string} b
 * @returns {number}
 */
export function safeAdd(a, b) {
  return new Decimal(a || 0).plus(b || 0).toNumber();
}

/**
 * Subtract b from a using decimal arithmetic.
 * @param {number|string} a
 * @param {number|string} b
 * @returns {number}
 */
export function safeSub(a, b) {
  return new Decimal(a || 0).minus(b || 0).toNumber();
}

/**
 * Multiply two numeric values using decimal arithmetic.
 * @param {number|string} a
 * @param {number|string} b
 * @returns {number}
 */
export function safeMult(a, b) {
  return new Decimal(a || 0).times(b || 0).toNumber();
}

/**
 * Divide a by b using decimal arithmetic.
 * @param {number|string} a
 * @param {number|string} b
 * @returns {number}
 */
export function safeDiv(a, b) {
  if (Number(b) === 0) {
    return 0;
  }
  return new Decimal(a || 0).div(b).toNumber();
}

/**
 * Parse a T212 numeric cell, stripping thousands separators.
 * @param {string|number|null} data
 * @returns {number}
 */
export function getNumber(data) {
  if (data !== '' && data != null) {
    const cleaned = String(data).replace(/,/g, '');
    return Number(cleaned);
  }
  return Number(data);
}
