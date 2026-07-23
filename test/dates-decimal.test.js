import { describe, expect, it } from 'vitest';
import { getTaxYearBounds, getTimestamp, inTaxYear, sameDay } from '../src/lib/tax/dates.js';
import { safeAdd, safeDiv, safeMult } from '../src/lib/tax/decimal.js';

describe('tax/dates', () => {
  it('parses ISO timestamps used by modern T212 exports', () => {
    const timestamp = getTimestamp('2024-06-01 10:00:00');
    expect(Number.isNaN(timestamp)).toBe(false);
    expect(new Date(timestamp).getUTCFullYear()).toBe(2024);
  });

  it('defines the 2023-24 UK tax year from 6 April 2023 to 5 April 2024', () => {
    const bounds = getTaxYearBounds(2023);
    const start = new Date(bounds.start);
    const end = new Date(bounds.end);

    expect(start.getFullYear()).toBe(2023);
    expect(start.getMonth()).toBe(3);
    expect(start.getDate()).toBe(6);

    expect(end.getFullYear()).toBe(2024);
    expect(end.getMonth()).toBe(3);
    expect(end.getDate()).toBe(5);
  });

  it('treats 5 April as inside the tax year and 6 April as outside', () => {
    const bounds = getTaxYearBounds(2023);
    const lastDay = getTimestamp('2024-04-05 12:00:00');
    const firstDayNextYear = getTimestamp('2024-04-06 12:00:00');

    expect(inTaxYear(lastDay, bounds)).toBe(1);
    expect(inTaxYear(firstDayNextYear, bounds)).toBe(0);
  });

  it('detects two timestamps on the same calendar day', () => {
    const morning = getTimestamp('2024-06-01 09:00:00');
    const afternoon = getTimestamp('2024-06-01 17:00:00');
    expect(sameDay(morning, afternoon)).toBe(true);
  });
});

describe('tax/decimal', () => {
  it('avoids floating-point drift in chained arithmetic', () => {
    const value = safeAdd(0.1, 0.2);
    expect(value).toBe(0.3);
  });

  it('multiplies and divides share quantities safely', () => {
    expect(safeMult(3, 0.1)).toBeCloseTo(0.3, 10);
    expect(safeDiv(10, 4)).toBe(2.5);
  });
});
