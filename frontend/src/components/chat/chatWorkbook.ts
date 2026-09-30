/**
 * Message-level workbook export for chat.
 *
 * When one assistant response holds several markdown tables, this turns all
 * of them into a single .xlsx file (one sheet per table). Parsing runs on
 * the markdown source (no DOM needed), so sheet data matches what
 * react-markdown renders and the logic is unit-testable in the node env.
 */

export interface WorkbookTable {
  /** Sheet name, already sanitized + deduped. */
  name: string;
  headers: string[];
  rows: string[][];
}

const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const HEADING_RE = /^\s*#{1,6}\s+(.*\S)\s*$/;
/** Delimiter row: |---|---|, |:---|---:|, or single-column |---|. */
const DELIMITER_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function splitCells(line: string): string[] {
  // Split on unescaped pipes, then drop the empties from outer pipes.
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  const trimmed = cells.map((c) => c.trim());
  if (trimmed.length > 0 && trimmed[0] === '') trimmed.shift();
  if (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
  return trimmed;
}

function cleanCell(cell: string): string {
  // Unescape pipes + strip light inline formatting so sheets hold plain text.
  return cell
    .replace(/\\\|/g, '|')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(`|\*|_)(.*?)\1/g, '$2')
    .trim();
}

/** Excel sheet names: max 31 chars, none of []:*?/\ -- plus dedupe. */
export function sanitizeSheetName(raw: string, used: Set<string>, fallback: string): string {
  let name = (raw || '')
    .replace(/[#*`_~[\]()]/g, '')
    .replace(/[\[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
    .trim();
  if (!name) name = fallback;
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let i = 2;
  while (used.has(`${name} (${i})`.slice(0, 31))) i++;
  const deduped = `${name} (${i})`.slice(0, 31);
  used.add(deduped);
  return deduped;
}

/**
 * Pull every GFM pipe table out of markdown source. The sheet name is the
 * nearest preceding heading, else "Table N". Tables inside fenced code
 * blocks are ignored (they are examples, not data).
 */
export function extractMarkdownTables(markdown: string): WorkbookTable[] {
  const lines = String(markdown || '').split('\n');
  const tables: WorkbookTable[] = [];
  const usedNames = new Set<string>();
  let inFence = false;
  let lastHeading: string | null = null;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      i++;
      continue;
    }
    if (inFence) {
      i++;
      continue;
    }
    const heading = line.match(HEADING_RE);
    if (heading) {
      lastHeading = heading[1];
      i++;
      continue;
    }
    const trimmed = line.trim();
    const next = (lines[i + 1] || '').trim();
    if (trimmed.includes('|') && DELIMITER_RE.test(next)) {
      const headers = splitCells(trimmed).map(cleanCell);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length) {
        const body = lines[i].trim();
        if (!body.includes('|') || FENCE_RE.test(lines[i])) break;
        // A heading ends the table too.
        if (HEADING_RE.test(lines[i])) break;
        rows.push(splitCells(body).map(cleanCell));
        i++;
      }
      const width = Math.max(headers.length, ...rows.map((r) => r.length));
      const pad = (r: string[]) => [...r, ...Array(Math.max(width - r.length, 0)).fill('')];
      tables.push({
        name: sanitizeSheetName(lastHeading || '', usedNames, `Table ${tables.length + 1}`),
        headers: pad(headers),
        rows: rows.map(pad),
      });
      continue;
    }
    // Note: headings stay valid until the next heading, so multi-table
    // sections sharing one heading label each table sensibly.
    i++;
  }
  return tables.filter((t) => t.headers.some((h) => h) || t.rows.length > 0);
}

const timestamp = (): string => {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
};

/** Resolve the xlsx API regardless of packaging: CJS builds expose it as
 *  `default`, while xlsx.mjs (which Vite prefers via the `module` field)
 *  has named exports only and NO default -- destructuring `default` yields
 *  undefined and `XLSX.utils` throws. */
export async function loadXlsx(): Promise<typeof import('xlsx')> {
  const mod = (await import('xlsx')) as unknown as { default?: typeof import('xlsx') } & typeof import('xlsx');
  const api = mod.default ?? mod;
  if (!api?.utils?.aoa_to_sheet || typeof api?.writeFile !== 'function') {
    throw new Error('Spreadsheet library failed to load.');
  }
  return api;
}

/** One workbook, one sheet per table. xlsx is lazy-loaded to stay out of the initial chunk. */
export async function downloadTablesWorkbook(tables: WorkbookTable[], baseName = 'chat-tables'): Promise<string> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  for (const table of tables) {
    const ws = XLSX.utils.aoa_to_sheet([table.headers, ...table.rows]);
    ws['!cols'] = table.headers.map((_, col) => ({
      wch: Math.min(
        Math.max(table.headers[col]?.length ?? 0, ...table.rows.map((row) => row[col]?.length ?? 0)) + 2,
        48,
      ),
    }));
    XLSX.utils.book_append_sheet(wb, ws, table.name);
  }
  const filename = `${baseName}_${timestamp()}.xlsx`;
  XLSX.writeFile(wb, filename);
  return filename;
}
