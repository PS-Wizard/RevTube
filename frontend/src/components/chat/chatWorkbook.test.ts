import { describe, it, expect } from 'vitest';
import { extractMarkdownTables, sanitizeSheetName, loadXlsx } from './chatWorkbook';

const TWO_TABLES = `## Channel overview

| Channel | Views | Subs |
| --- | ---: | ---: |
| Alpha | 12,400 | 312 |
| Beta | 8,201 | 98 |

Some prose between the tables.

### Top videos

| Video | Views |
| :-- | --: |
| Intro to Shorts | 18,204 |
| **Best thumbnail** \\| part 2 | 9,001 |
`;

describe('extractMarkdownTables', () => {
  it('returns one sheet per table with heading-derived names', () => {
    const tables = extractMarkdownTables(TWO_TABLES);
    expect(tables).toHaveLength(2);
    expect(tables[0].name).toBe('Channel overview');
    expect(tables[0].headers).toEqual(['Channel', 'Views', 'Subs']);
    expect(tables[0].rows[0]).toEqual(['Alpha', '12,400', '312']);
    expect(tables[1].name).toBe('Top videos');
  });

  it('handles alignment variants, escaped pipes, and inline formatting', () => {
    const tables = extractMarkdownTables(TWO_TABLES);
    expect(tables[1].headers).toEqual(['Video', 'Views']);
    // Escaped pipe stays inside the cell; bold markers are stripped.
    expect(tables[1].rows[1]).toEqual(['Best thumbnail | part 2', '9,001']);
  });

  it('ignores tables inside fenced code blocks', () => {
    const md = `Example:\n\`\`\`\n| A | B |\n|---|---|\n| 1 | 2 |\n\`\`\`\n\n| Real | Table |\n|---|---|\n| x | y |\n`;
    const tables = extractMarkdownTables(md);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(['Real', 'Table']);
  });

  it('falls back to Table N without headings and dedupes repeats', () => {
    const md = `| A |\n|---|\n| 1 |\n\n## Same\n\n| B |\n|---|\n| 2 |\n\n## Same\n\n| C |\n|---|\n| 3 |\n`;
    const tables = extractMarkdownTables(md);
    expect(tables.map((t) => t.name)).toEqual(['Table 1', 'Same', 'Same (2)']);
  });

  it('returns [] when there are no tables', () => {
    expect(extractMarkdownTables('Just prose, no pipes here.')).toEqual([]);
    expect(extractMarkdownTables('')).toEqual([]);
  });

  it('pads ragged rows to the header width', () => {
    const tables = extractMarkdownTables('| A | B | C |\n|---|---|---|\n| 1 |\n');
    expect(tables[0].rows[0]).toEqual(['1', '', '']);
  });
});

describe('loadXlsx', () => {
  it('resolves a working xlsx API (CJS default or ESM namespace -- xlsx.mjs ships no default)', async () => {
    const XLSX = await loadXlsx();
    expect(typeof XLSX.utils.aoa_to_sheet).toBe('function');
    expect(typeof XLSX.writeFile).toBe('function');
    // End-to-end sheet build from parser output (no file written).
    const tables = extractMarkdownTables('| A | B |\n|---|---|\n| 1 | 2 |\n');
    const wb = XLSX.utils.book_new();
    for (const t of tables) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([t.headers, ...t.rows]), t.name);
    }
    expect(wb.SheetNames).toEqual(['Table 1']);
  });
});

describe('sanitizeSheetName', () => {  it('strips illegal chars and caps at 31 chars', () => {
    const used = new Set<string>();
    expect(sanitizeSheetName('Sales: Q1/Q2 *final* [draft]?', used, 'Table 1')).toBe('Sales Q1 Q2 final draft');
    expect(sanitizeSheetName('x'.repeat(50), used, 'Table 1')).toHaveLength(31);
    expect(sanitizeSheetName('', used, 'Table 1')).toBe('Table 1');
  });
});
