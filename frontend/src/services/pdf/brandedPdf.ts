/**
 * Centralized branded PDF export service -- single source of truth for every PDF
 * the app generates (chat tables, video audits, thumbnail audits, playlist
 * reports, channel comparisons).
 *
 * Every report gets the same chrome:
 *  - Page 1: brand line, report title, subtitle/generated timestamp, rule.
 *  - Every page footer: site URL (branding) + "Page X of Y".
 *
 * Two rendering paths:
 *  - Text tables via `brandedAutoTable` (fast, selectable text). jsPDF's
 *    built-in fonts only cover Latin-1, so `sanitizeForPdf` transliterates
 *    emojis/symbols for this path.
 *  - `exportElementToPdf` snapshots already-rendered DOM with html2canvas, so
 *    emojis, colors, and charts print exactly as seen on screen. Prefer this
 *    path whenever the source is visible in the UI (no server round-trip, no
 *    headless-Chrome infra needed for emoji fidelity).
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CellHookData } from 'jspdf-autotable';
import {
  TUBEKETER_DOMAIN_DISPLAY,
  TUBEKETER_SITE_URL,
} from '@/constants/productUrls';

export const PDF_BRAND_NAME = 'TubeKeter Analytics';

const INK: [number, number, number] = [17, 24, 39];
const MUTED: [number, number, number] = [110, 110, 110];
const FAINT: [number, number, number] = [150, 150, 150];
const HEADER_FILL: [number, number, number] = [17, 24, 39];
const ZEBRA_FILL: [number, number, number] = [248, 250, 252];
const RULE: [number, number, number] = [226, 232, 240];

const MARGIN_X = 40;
const HEADER_BOTTOM = 108;
const FOOTER_TOP = 36;

export interface BrandedReportMeta {
  reportTitle: string;
  reportSubtitle?: string;
}

/** Compact timestamp for filenames: YYYYMMDD_HHMMSS. */
export function pdfTimestamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

export function pdfFileName(base: string): string {
  const safe = base.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'report';
  return `${safe}_${pdfTimestamp()}.pdf`;
}

/** New A4 portrait doc with the branded page-1 header painted. */
export function createBrandedDoc(meta: BrandedReportMeta): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(PDF_BRAND_NAME.toUpperCase(), MARGIN_X, 34);

  doc.setFontSize(20);
  const titleLines = doc.splitTextToSize(meta.reportTitle, pageWidth - MARGIN_X * 2);
  doc.text(titleLines, MARGIN_X, 60);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const subtitle =
    meta.reportSubtitle ?? `Generated ${new Date().toLocaleString()}`;
  doc.text(subtitle, MARGIN_X, 60 + titleLines.length * 24 + 2);

  doc.setDrawColor(...RULE);
  doc.setLineWidth(1);
  doc.line(MARGIN_X, HEADER_BOTTOM - 14, pageWidth - MARGIN_X, HEADER_BOTTOM - 14);

  return doc;
}

/** Stamp the branded footer (site URL + page numbers) on every page. Call last. */
export function finalizeBrandedDoc(doc: jsPDF): void {
  const total = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.75);
    doc.line(MARGIN_X, pageHeight - FOOTER_TOP, pageWidth - MARGIN_X, pageHeight - FOOTER_TOP);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...FAINT);
    doc.text(TUBEKETER_DOMAIN_DISPLAY, MARGIN_X, pageHeight - FOOTER_TOP + 14);
    doc.text(
      `Page ${i} of ${total}`,
      pageWidth - MARGIN_X,
      pageHeight - FOOTER_TOP + 14,
      { align: 'right' },
    );
  }
}

/** Canonical site link for "Generated from <url>" lines inside report bodies. */
export function brandedSourceLine(): string {
  return `Generated from ${TUBEKETER_SITE_URL}`;
}

export interface BrandedTableCellHooks {
  didParseCell?: (data: CellHookData) => void;
  didDrawCell?: (data: CellHookData) => void;
}

export interface BrandedTableOptions {
  head: string[][];
  body: string[][];
  startY?: number;
  fontSize?: number;
  /** Raw autoTable hooks (link overlays, per-cell coloring). */
  cellHooks?: BrandedTableCellHooks;
}

/** Shared autoTable theme. Returns the Y coordinate below the table. */
export function brandedAutoTable(doc: jsPDF, opts: BrandedTableOptions): number {
  autoTable(doc, {
    startY: opts.startY ?? HEADER_BOTTOM,
    margin: { left: MARGIN_X, right: MARGIN_X },
    tableWidth: 'auto',
    head: opts.head,
    body: opts.body,
    theme: 'grid',
    showHead: 'everyPage',
    styles: {
      font: 'helvetica',
      fontSize: opts.fontSize ?? 9,
      cellPadding: 6,
      overflow: 'linebreak',
      cellWidth: 'wrap',
      valign: 'top',
      textColor: [...INK],
    },
    headStyles: {
      fillColor: [...HEADER_FILL],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left',
    },
    alternateRowStyles: { fillColor: [...ZEBRA_FILL] },
    didParseCell: opts.cellHooks?.didParseCell,
    didDrawCell: opts.cellHooks?.didDrawCell,
  });
  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } })
    .lastAutoTable?.finalY;
  return typeof finalY === 'number' ? finalY : (opts.startY ?? HEADER_BOTTOM);
}

/**
 * jsPDF's built-in fonts only cover Latin-1, so emojis and symbols outside that
 * range print as garbage. Transliterate common symbols and drop the rest.
 * (Text-table path only -- element snapshots keep originals.)
 */
const PDF_SYMBOL_MAP: Record<string, string> = {
  '→': '->',
  '←': '<-',
  '↑': '^',
  '↓': 'v',
  '↔': '<->',
  '✓': 'v',
  '✔': 'v',
  '✗': 'x',
  '✘': 'x',
  '★': '*',
  '☆': '*',
  '₦': 'NGN ',
  '₹': 'INR ',
  '₵': 'GHS ',
  '₨': 'Rs ',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
};

export const sanitizeForPdf = (text: unknown): string =>
  String(text ?? '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\u200D|\uFE0E|\uFE0F/g, '')
    .replace(
      /[→←↑↓↔✓✔✗✘★☆₦₹₵₨“”‘’]/g,
      (ch) => PDF_SYMBOL_MAP[ch] ?? '',
    )
    .replace(/[^\u0020-\u007E\u00A0-\u00FF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ¡-ÿ]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

export interface ElementPdfOptions extends BrandedReportMeta {
  filename: string;
}

// ── Modern color sanitizer (html2canvas compat) ──────────────────────────────
// html2canvas cannot parse modern color functions (oklch/oklab/lab/lch,
// color-mix(), …) emitted by Tailwind v4 + shadcn theme tokens — it throws
// "Attempting to parse an unsupported color function" and aborts the render,
// so image PDFs lose emojis AND everything else. Before snapshotting, walk the
// LIVE subtree and inline-resolve those values to legacy rgb()/hex via a
// canvas 2d context (which normalizes any CSS color to sRGB), then restore.
// Stylesheet rules are untouched; only inline overrides are added + removed.

/** True when a computed CSS value contains a color fn html2canvas can't parse. */
export function hasModernColorSyntax(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false;
  return /(oklch|oklab|(?<![a-zA-Z-])lch|(?<![a-zA-Z-])lab|color-mix|color-contrast|(?<![a-zA-Z-])color(?=\s*\()|device-cmyk|light-dark)\s*\(/i.test(value);
}

const MODERN_FN_NAMES = ['oklch', 'oklab', 'lch', 'lab', 'color-mix', 'color-contrast', 'color', 'device-cmyk', 'light-dark', 'gray'];

/**
 * Replace every modern color fn in `input` (balanced parens, so nested
 * `var()` calls survive) with `resolve(fn)`. Unresolvable fns are left as-is.
 * Pure — the DOM/canvas resolver is injected, so this is unit-testable.
 */
export function replaceModernColorFns(
  input: string,
  resolve: (fn: string) => string | null,
): string {
  if (!hasModernColorSyntax(input)) return input;
  const lower = input.toLowerCase();
  let out = '';
  let i = 0;
  while (i < input.length) {
    let matched: string | null = null;
    for (const name of MODERN_FN_NAMES) {
      if (lower.startsWith(name, i)) {
        const prev = i === 0 ? '' : lower[i - 1];
        // Bare names (lab/lch/color) must not match inside words (e.g. "collab(").
        if ((name === 'lab' || name === 'lch' || name === 'color') && /[a-zA-Z-]/.test(prev)) continue;
        let j = i + name.length;
        while (j < input.length && /\s/.test(input[j])) j++;
        if (input[j] !== '(') continue;
        // Consume balanced parens.
        let depth = 0;
        let k = j;
        while (k < input.length) {
          if (input[k] === '(') depth++;
          else if (input[k] === ')') {
            depth--;
            if (depth === 0) break;
          }
          k++;
        }
        if (depth !== 0) break; // unbalanced — bail, keep the rest as-is
        matched = input.slice(i, k + 1);
        i = k + 1;
        break;
      }
    }
    if (matched) {
      out += resolve(matched) ?? matched;
    } else {
      out += input[i];
      i++;
    }
  }
  return out;
}

/** Resolve any CSS color to legacy sRGB via canvas (null when unavailable). */
function resolveColorViaCanvas(fn: string): string | null {
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#000000';
    ctx.fillStyle = fn;
    const out = String(ctx.fillStyle || '');
    if (!out || hasModernColorSyntax(out)) return null;
    return out;
  } catch {
    return null;
  }
}

const SANITIZE_COLOR_PROPS = [
  'color',
  'background-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'caret-color',
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
  'lighting-color',
];
const SANITIZE_SHADOW_PROPS = ['box-shadow', 'text-shadow'];

/**
 * Inline-resolve modern color fns across a live subtree so html2canvas only
 * ever sees legacy syntax. Returns a restore() that puts every touched inline
 * style back (always call it in a finally). No-op without a DOM.
 */
export function sanitizeElementColorsForCanvas(root: Element): () => void {
  const noop = () => {};
  try {
    if (typeof document === 'undefined' || !root || typeof root.querySelectorAll !== 'function') return noop;
    const view = root.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : null);
    if (!view || typeof view.getComputedStyle !== 'function') return noop;
    const els: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
    const undo: { el: Element; prop: string; prev: string }[] = [];
    const styled = (el: Element): CSSStyleDeclaration | null => {
      const s = (el as unknown as { style?: CSSStyleDeclaration }).style;
      return s && typeof s.setProperty === 'function' ? s : null;
    };
    for (const el of els) {
      const inline = styled(el);
      if (!inline) continue;
      let cs: CSSStyleDeclaration;
      try {
        cs = view.getComputedStyle(el);
      } catch {
        continue;
      }
      for (const prop of SANITIZE_COLOR_PROPS) {
        const v = cs.getPropertyValue(prop);
        if (!v || !hasModernColorSyntax(v)) continue;
        const resolved = resolveColorViaCanvas(v);
        if (!resolved) continue;
        undo.push({ el, prop, prev: inline.getPropertyValue(prop) });
        inline.setProperty(prop, resolved);
      }
      for (const prop of SANITIZE_SHADOW_PROPS) {
        const v = cs.getPropertyValue(prop);
        if (!v || v === 'none' || !hasModernColorSyntax(v)) continue;
        const fixed = replaceModernColorFns(v, resolveColorViaCanvas);
        if (fixed === v) continue;
        undo.push({ el, prop, prev: inline.getPropertyValue(prop) });
        inline.setProperty(prop, fixed);
      }
    }
    return () => {
      for (const { el, prop, prev } of undo) {
        try {
          const inline = styled(el);
          if (!inline) continue;
          if (prev) inline.setProperty(prop, prev);
          else inline.removeProperty(prop);
        } catch {
          /* restore is best-effort */
        }
      }
    };
  } catch {
    return noop;
  }
}

/**
 * Export a rendered DOM element to a branded, paginated PDF. The browser rasterizes
 * the element, so emojis, colors, and styling print exactly as seen on screen.
 */
export async function exportElementToPdf(
  element: HTMLElement,
  opts: ElementPdfOptions,
): Promise<void> {
  const [{ default: html2canvas }] = await Promise.all([import('html2canvas')]);
  // Modern color fns (oklch/color-mix/…) abort the render — inline-resolve
  // them first, always restoring afterwards so the live UI never changes.
  const restoreColors = sanitizeElementColorsForCanvas(element);
  try {
  const canvas = await html2canvas(element, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
  });

  const doc = createBrandedDoc({
    reportTitle: opts.reportTitle,
    reportSubtitle: opts.reportSubtitle,
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN_X * 2;
  const pxPerPt = canvas.width / contentWidth;

  let sourceY = 0;
  let pageIndex = 0;
  while (sourceY < canvas.height) {
    const topPad = pageIndex === 0 ? HEADER_BOTTOM : MARGIN_X;
    if (pageIndex > 0) doc.addPage();
    const availPt = pageHeight - topPad - FOOTER_TOP - 8;
    const slicePx = Math.floor(availPt * pxPerPt);
    const takePx = Math.min(slicePx, canvas.height - sourceY);

    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = takePx;
    const ctx = slice.getContext('2d');
    if (!ctx) break;
    // White backing so transparent regions never turn black in the PDF.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, sourceY, canvas.width, takePx, 0, 0, canvas.width, takePx);

    const slicePt = takePx / pxPerPt;
    doc.addImage(
      slice.toDataURL('image/png'),
      'PNG',
      MARGIN_X,
      topPad,
      contentWidth,
      slicePt,
    );
    sourceY += takePx;
    pageIndex += 1;
  }

  finalizeBrandedDoc(doc);
  doc.save(opts.filename);
  } finally {
    restoreColors();
  }
}
