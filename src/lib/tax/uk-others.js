/**
 * @file uk-others.js
 * @brief Normalise UK "other" dividend name lists for the tax engine.
 */

/**
 * @param {unknown} divUkOthersList
 * @returns {Record<string, boolean>}
 */
export function buildUkOthersList(divUkOthersList) {
  const ukOthersList = {};

  if (Array.isArray(divUkOthersList)) {
    for (const name of divUkOthersList) {
      ukOthersList[name] = true;
    }
  } else if (divUkOthersList && typeof divUkOthersList === 'object') {
    for (const name in divUkOthersList) {
      ukOthersList[name] = true;
    }
  }

  if (typeof localStorage !== 'undefined' && localStorage.getItem('UKOthers') != null) {
    try {
      const parsed = JSON.parse(localStorage.getItem('UKOthers'));
      if (Array.isArray(parsed)) {
        for (const name of parsed) {
          ukOthersList[name] = true;
        }
      }
    } catch {
      // Ignore invalid persisted UKOthers data.
    }
  }

  return ukOthersList;
}
