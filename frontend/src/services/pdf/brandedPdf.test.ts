// brandedPdf — modern-color sanitizer tests (pure helpers only; the DOM walk
// is guarded and needs a real browser canvas, so it stays out of unit tests).

import { describe, it, expect } from 'vitest';
import { hasModernColorSyntax, replaceModernColorFns, sanitizeElementColorsForCanvas } from './brandedPdf';

describe('hasModernColorSyntax', () => {
  it('flags oklch/oklab/lab/lch/color-mix and friends', () => {
    expect(hasModernColorSyntax('oklch(0.5 0.1 30)')).toBe(true);
    expect(hasModernColorSyntax('OKLCH(0.5 0.1 30)')).toBe(true);
    expect(hasModernColorSyntax('oklab(0.5 0.1 30)')).toBe(true);
    expect(hasModernColorSyntax('lab(50% 20 30)')).toBe(true);
    expect(hasModernColorSyntax('lch(50% 20 30)')).toBe(true);
    expect(hasModernColorSyntax('color-mix(in srgb, red 50%, blue)')).toBe(true);
    expect(hasModernColorSyntax('color(display-p3 1 0 0)')).toBe(true);
    expect(hasModernColorSyntax('0 1px 0 oklch(0.5 0.1 30)')).toBe(true);
  });

  it('passes legacy syntax and non-colors through', () => {
    expect(hasModernColorSyntax('#fff')).toBe(false);
    expect(hasModernColorSyntax('rgb(255, 0, 0)')).toBe(false);
    expect(hasModernColorSyntax('rgba(0,0,0,0.5)')).toBe(false);
    expect(hasModernColorSyntax('red')).toBe(false);
    expect(hasModernColorSyntax('none')).toBe(false);
    expect(hasModernColorSyntax('')).toBe(false);
    expect(hasModernColorSyntax(null)).toBe(false);
    expect(hasModernColorSyntax(undefined)).toBe(false);
    expect(hasModernColorSyntax(42)).toBe(false);
    // Must not match inside words.
    expect(hasModernColorSyntax('collab(x)')).toBe(false);
  });
});

describe('replaceModernColorFns', () => {
  const resolve = (fn: string): string | null => {
    if (fn.startsWith('oklch')) return 'rgb(100, 100, 100)';
    if (fn.startsWith('color-mix')) return 'rgb(200, 200, 200)';
    return null;
  };

  it('replaces whole-value modern colors', () => {
    expect(replaceModernColorFns('oklch(0.5 0.1 30)', resolve)).toBe('rgb(100, 100, 100)');
  });

  it('replaces nested color-mix with var() inside shadows, keeps the rest', () => {
    const shadow = '0 1px 0 color-mix(in srgb, var(--rt-color-text) 4%, transparent)';
    expect(replaceModernColorFns(shadow, resolve)).toBe('0 1px 0 rgb(200, 200, 200)');
  });

  it('leaves unresolvable fns and legacy values untouched', () => {
    expect(replaceModernColorFns('lab(50% 20 30)', resolve)).toBe('lab(50% 20 30)');
    expect(replaceModernColorFns('1px solid #fff', resolve)).toBe('1px solid #fff');
    expect(replaceModernColorFns('none', resolve)).toBe('none');
  });
});

describe('sanitizeElementColorsForCanvas', () => {
  it('is a no-op without a DOM', () => {
    const restore = sanitizeElementColorsForCanvas({} as Element);
    expect(() => restore()).not.toThrow();
  });
});
