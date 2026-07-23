import { describe, expect, it } from 'vitest';
import { normaliseTradeRow, parseCsvText } from '../src/lib/parse/csv-normaliser.js';
import { loadFixtureCsv } from './helpers/fixture-loader.js';

describe('parse/csv-normaliser', () => {
  it('maps modern T212 headers onto internal field names', () => {
    const row = normaliseTradeRow({
      Action: 'Market buy',
      Time: '2024-06-01 10:00:00',
      ISIN: 'GB0000000001',
      Ticker: 'TEST',
      Name: 'Test PLC',
      'No. of shares': '10',
      'Price / share': '12.5',
      'Currency (Price / share)': 'GBP',
      'Exchange rate': '1',
      Total: '125',
      'Currency (Total)': 'GBP',
    });

    expect(row.action).toBe('Market buy');
    expect(row.ticker).toBe('TEST');
    expect(row.numberOfShares).toBe('10');
    expect(row.totalGbp).toBe('125');
  });

  it('accepts legacy Total (GBP) headers', () => {
    const row = normaliseTradeRow({
      Action: 'Market sell',
      Time: '2024-06-01 10:00:00',
      Ticker: 'TEST',
      'Total (GBP)': '99.50',
    });

    expect(row.totalGbp).toBe('99.50');
  });

  it('parses fixture CSV files into normalised trade rows', () => {
    const rows = loadFixtureCsv('same-day-rule.csv');
    expect(rows).toHaveLength(3);
    expect(rows[0].ticker).toBe('TEST');
    expect(rows[1].action).toContain('sell');
  });

  it('throws when PapaParse encounters malformed CSV content', () => {
    expect(() => parseCsvText('Action,Time\n"unclosed quote')).toThrow(/CSV parse error/);
  });
});
