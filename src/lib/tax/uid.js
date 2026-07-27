/**
 * @file uid.js
 * @brief Monotonic identifiers for ledger and trade rows.
 */

/** @type {number} */
let uidCounter = 0;

/**
 * Reset the UID counter so repeated calculation runs stay deterministic in tests.
 */
export function resetUidCounter() {
  uidCounter = 0;
}

/**
 * @returns {number} Next unique ledger or trade identifier.
 */
export function getUID() {
  return uidCounter++;
}
