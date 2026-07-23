import { describe, expect, it } from 'vitest';
import { recalculateForTaxYear } from '../src/lib/calculation-engine.js';
import { getTaxableLedgerEntries, runFixture } from './helpers/fixture-loader.js';

const TAX_YEAR_2023 = 2023;

describe('calculation engine fixtures', () => {
  it('applies the same-day rule when buy and sell occur on one day', () => {
    const result = runFixture('same-day-rule.csv', TAX_YEAR_2023);
    const entries = getTaxableLedgerEntries(result, 'TEST');

    expect(entries).toHaveLength(1);
    expect(entries[0].rule).toBe('Same Day');
    expect(entries[0].gain).toBe(50);
    expect(result.taxYearData.disposals).toBe(1);
    expect(result.taxYearData.realisedProfit).toBe(50);
  });

  it('uses Section 104 pooling for a buy followed by a later sell', () => {
    const result = runFixture('section-104.csv', TAX_YEAR_2023);
    const entries = getTaxableLedgerEntries(result, 'S104');

    expect(entries).toHaveLength(1);
    expect(entries[0].rule).toBe('Section 104');
    expect(entries[0].gain).toBe(100);
    expect(result.taxYearData.realisedProfit).toBe(100);
  });

  it('matches bed and breakfast disposals to a repurchase within 30 days', () => {
    const result = runFixture('bed-and-breakfast.csv', TAX_YEAR_2023);
    const entries = getTaxableLedgerEntries(result, 'BNB');

    expect(entries).toHaveLength(1);
    expect(entries[0].rule).toBe('30 Day BnB');
    // Gain is recorded on totalPnl for the taxable sell leg of a B&B match.
    expect(entries[0].totalPnl).toBe(100);
  });

  it('assigns disposals to the correct UK tax year around 5 April', () => {
    const result = runFixture('tax-year-boundary.csv', TAX_YEAR_2023);
    const entries = getTaxableLedgerEntries(result, 'FY23');

    expect(entries).toHaveLength(2);
    expect(entries[0].inTaxYear).toBe(1);
    expect(entries[1].inTaxYear).toBe(0);
    expect(result.taxYearData.disposals).toBe(1);
    expect(result.taxYearData.realisedProfit).toBe(50);
    expect(result.taxYearData.roundTrips).toHaveLength(1);
  });

  it('applies retrospective stock split corporate actions before matching', () => {
    const result = runFixture('corp-action-split.csv', TAX_YEAR_2023, {
      corpActions: [{
        uid: 'CORP-1',
        type: 'Split',
        date: '2023-06-01',
        ticker: 'SPLIT',
        ratio: 2,
      }],
    });
    const entries = getTaxableLedgerEntries(result, 'SPLIT');

    expect(entries).toHaveLength(1);
    expect(entries[0].rule).toBe('Section 104');
    expect(entries[0].gain).toBe(200);
  });

  it('categorises UK and non-UK dividends', () => {
    const result = runFixture('dividend-split.csv', 2024);

    expect(result.dividends).toHaveLength(2);
    expect(result.dividends[0].isUk).toBe(1);
    expect(result.dividends[1].isUk).toBe(0);
    expect(result.taxYearData.dividends).toBe(65);
    expect(result.dividendDetails.nonUk).toBe(40);
  });

  it('shows the p30 caution when the selected tax year lacks post-year-end data', () => {
    const result = runFixture('section-104.csv', TAX_YEAR_2023);
    const switched = recalculateForTaxYear(result, 2024);

    const cautionMessages = switched.errorList.filter((error) => error.msg.includes('No data seen past the end of the tax year +30 days'));
    expect(cautionMessages).toHaveLength(1);
  });

  it('suppresses the p30 caution when post-year-end data exists', () => {
    const result = runFixture('section-104.csv', TAX_YEAR_2023);
    const cautionMessages = result.errorList.filter((error) => error.msg.includes('No data seen past the end of the tax year +30 days'));
    expect(cautionMessages).toHaveLength(0);
  });
});
