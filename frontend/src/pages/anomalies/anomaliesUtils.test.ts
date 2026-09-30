import { describe, expect, it } from 'vitest';
import { ANOMALY_PAGE_SIZES, pageWindow } from './anomaliesUtils';

describe('pageWindow', () => {
  it('lists every page when there are 7 or fewer', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(7, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('windows around the current page with ellipses', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, '…', 20]);
    expect(pageWindow(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20]);
    expect(pageWindow(20, 20)).toEqual([1, '…', 19, 20]);
  });

  it('exposes 10/25/50 page sizes with 10 first', () => {
    expect([...ANOMALY_PAGE_SIZES]).toEqual([10, 25, 50]);
  });
});
