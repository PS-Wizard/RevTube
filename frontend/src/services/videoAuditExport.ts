// ─────────────────────────────────────────────────────────────────────────────
// Video Audit -- PDF & Excel Export Service
// ─────────────────────────────────────────────────────────────────────────────
import type jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import type { VideoAuditVideoResult } from '../types/videoAudit';
import {
  brandedAutoTable,
  createBrandedDoc,
  finalizeBrandedDoc,
  pdfFileName,
  sanitizeForPdf,
} from './pdf/brandedPdf';

const PRIMARY_BLUE: [number, number, number] = [54, 101, 155];
const PDF_MARGIN = 40;
const FIRST_PAGE_Y = 120;
const CONTINUATION_Y = 40;
const ELEMENTS = ['title', 'description', 'tags', 'keywords', 'thumbnail', 'captions'] as const;
const CATEGORY_COLUMNS = [
  { key: 'discoverability', label: 'Discoverability' },
  { key: 'contentQuality', label: 'Content Quality' },
  { key: 'visualHook', label: 'Visual Hook' },
] as const;

function elementScore(result: VideoAuditVideoResult, el: string) {
  return result.elements.find((e) => e.element === el);
}

function safeTitle(title: string): string {
  return (title || 'audit').replace(/[^a-z0-9]/gi, '_').substring(0, 25);
}

function drawAuditPage(doc: jsPDF, result: VideoAuditVideoResult, isFirstPage = false) {
  if (!isFirstPage) doc.addPage();
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - PDF_MARGIN * 2;
  let y = isFirstPage ? FIRST_PAGE_Y : CONTINUATION_Y;

  doc.setFontSize(14);
  doc.setTextColor(PRIMARY_BLUE[0], PRIMARY_BLUE[1], PRIMARY_BLUE[2]);
  doc.setFont('helvetica', 'bold');
  const title = doc.splitTextToSize(sanitizeForPdf(result.videoTitle) || 'Untitled', contentWidth);
  doc.text(title, PDF_MARGIN, y);
  y += title.length * 18 + 4;

  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.setFont('helvetica', 'normal');
  doc.text(`Video ID: ${sanitizeForPdf(result.videoId)}`, PDF_MARGIN, y);
  y += 7;
  doc.text(`Overall Score: ${result.total.toFixed(1)} / 100`, PDF_MARGIN, y);
  y += 7;
  if (result.projectedTotal > result.total) {
    doc.setTextColor(54, 101, 155);
    doc.text(`Projected if fixed: ${result.projectedTotal.toFixed(1)} / 100 (+${(result.projectedTotal - result.total).toFixed(0)})`, PDF_MARGIN, y);
    doc.setTextColor(60, 60, 60);
    y += 7;
  }

  brandedAutoTable(doc, {
    startY: y + 4,
    head: [['Element', 'Score', 'Max', 'Criteria Breakdown']],
    body: ELEMENTS.map((el) => {
      const es = elementScore(result, el);
      const notes = (es?.breakdown ?? [])
        .map((b) => `${b.criterion}: ${b.earned.toFixed(0)}/${b.max.toFixed(0)}${b.note ? ` (${b.note})` : ''}`)
        .join('\n');
      return [
        sanitizeForPdf(el[0].toUpperCase() + el.slice(1)),
        es?.score.toFixed(1) ?? '0',
        es?.max.toFixed(0) ?? '0',
        sanitizeForPdf(notes),
      ];
    }),
    fontSize: 8,
  });
}

export function downloadIndividualPDF(result: VideoAuditVideoResult): void {
  const doc = createBrandedDoc({
    reportTitle: 'Video Audit Report',
    reportSubtitle: sanitizeForPdf(result.videoTitle) || 'Individual audit',
  });
  drawAuditPage(doc, result, true);
  finalizeBrandedDoc(doc);
  doc.save(pdfFileName(`Video_Audit_${safeTitle(result.videoTitle)}`));
}

export function downloadBatchPDF(results: VideoAuditVideoResult[]): void {
  if (results.length === 0) return;
  const doc = createBrandedDoc({
    reportTitle: 'Video Audit Report',
    reportSubtitle: `Batch audit — ${results.length} video(s)`,
  });
  results.forEach((r, idx) => {
    drawAuditPage(doc, r, idx === 0);
  });
  finalizeBrandedDoc(doc);
  doc.save(pdfFileName('Video_Audit_Batch'));
}

function summaryRows(results: VideoAuditVideoResult[]) {
  return results.map((r, i) => {
    const row: Record<string, string | number> = {
      '#': i + 1,
      'Video ID': r.videoId,
      'Video Title': r.videoTitle,
      'Total': r.total.toFixed(1),
      'Projected if fixed': (r.projectedTotal ?? r.total).toFixed(1),
    };
    ELEMENTS.forEach((el) => {
      const es = elementScore(r, el);
      row[el[0].toUpperCase() + el.slice(1)] = es?.score.toFixed(1) ?? '0';
    });
    CATEGORY_COLUMNS.forEach((cat) => {
      const cs = (r.categories ?? []).find((c) => c.key === cat.key);
      row[cat.label] = cs?.score.toFixed(1) ?? '0';
    });
    return row;
  });
}

export function downloadExcel(results: VideoAuditVideoResult[]): void {
  const wb = XLSX.utils.book_new();
  const rows = summaryRows(results);
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = [{ wch: 4 }, { wch: 14 }, { wch: 40 }, { wch: 8 }, { wch: 14 }, ...ELEMENTS.map(() => ({ wch: 10 })), ...CATEGORY_COLUMNS.map(() => ({ wch: 12 }))];
  XLSX.utils.book_append_sheet(wb, sheet, 'Video Audit');
  XLSX.writeFile(wb, `RevKeter_VideoAudit_${Date.now()}.xlsx`);
}

export function downloadCSV(results: VideoAuditVideoResult[]): void {
  const rows = summaryRows(results);
  const sheet = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(sheet);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `RevKeter_VideoAudit_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
