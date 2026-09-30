// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail Optimizer -- PDF & Excel Export Service
// ─────────────────────────────────────────────────────────────────────────────
import type jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { ThumbnailAudit, OptimizationArea } from '../types/thumbnailOptimizer';
import {
  brandedAutoTable,
  createBrandedDoc,
  finalizeBrandedDoc,
  pdfFileName,
  sanitizeForPdf,
} from './pdf/brandedPdf';

const PRIMARY_BLUE: [number, number, number] = [54, 101, 155];  // #36659b
const TEXT_LINK: [number, number, number] = [37, 99, 235];      // Blue 600

const PDF_MARGIN = 40;
const FIRST_PAGE_Y = 120;
const CONTINUATION_Y = 40;

/**
 * Sort areas by tier priority: Red → Yellow → Grey.
 */
function sortByTier(areas: OptimizationArea[]): OptimizationArea[] {
  const order: Record<string, number> = { Red: 0, Yellow: 1, Grey: 2 };
  return [...areas].sort((a, b) => order[a.tier] - order[b.tier]);
}

/**
 * Draw a detail page for a single audit inside a branded doc.
 * The shared branded header covers branding; this keeps only the
 * video title/URL/context content.
 */
function drawAuditPage(doc: jsPDF, audit: ThumbnailAudit, isFirstPage = false) {
  if (!isFirstPage) doc.addPage();
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - PDF_MARGIN * 2;
  let y = isFirstPage ? FIRST_PAGE_Y : CONTINUATION_Y;

  // Video Title
  doc.setFontSize(14);
  doc.setTextColor(PRIMARY_BLUE[0], PRIMARY_BLUE[1], PRIMARY_BLUE[2]);
  doc.setFont('helvetica', 'bold');
  const titleLines = doc.splitTextToSize(sanitizeForPdf(audit.videoTitle) || 'Untitled', contentWidth);
  doc.text(titleLines, PDF_MARGIN, y);
  y += titleLines.length * 16 + 6;

  // Video URL Link
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.setFont('helvetica', 'normal');
  const labelText = 'Video Source: ';
  doc.text(labelText, PDF_MARGIN, y);
  const labelWidth = doc.getTextWidth(labelText);
  const urlText = sanitizeForPdf(audit.url);
  doc.setTextColor(TEXT_LINK[0], TEXT_LINK[1], TEXT_LINK[2]);
  const urlLines = doc.splitTextToSize(urlText, contentWidth - labelWidth);
  doc.text(urlLines, PDF_MARGIN + labelWidth, y);
  if (audit.url.startsWith('http')) {
    doc.link(PDF_MARGIN + labelWidth, y - 4, doc.getTextWidth(urlLines[0] ?? urlText), 6, { url: audit.url });
  }
  y += (urlLines.length - 1) * 11 + 8;

  // Score line — circular progress is visual-only in UI, so surface Current/Potential numerically in PDF
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(PRIMARY_BLUE[0], PRIMARY_BLUE[1], PRIMARY_BLUE[2]);
  const delta = (audit.expectedScore - audit.currentScore).toFixed(1);
  doc.text(`Score: ${audit.currentScore}/10    Potential: ${audit.expectedScore}/10  (+${delta} uplift)`, PDF_MARGIN, y);
  doc.setFont('helvetica', 'normal');
  y += 10;

  // Context table (shared theme)
  const contextY = brandedAutoTable(doc, {
    startY: y,
    head: [['Niche', 'Audience', 'Brand voice']],
    body: [[
      sanitizeForPdf(audit.niche || 'N/A'),
      sanitizeForPdf(audit.targetAudience || 'N/A'),
      sanitizeForPdf(audit.brandVoice || 'N/A'),
    ]],
    fontSize: 8,
  });

  // Analysis table -- tier coloring needs per-cell hooks, so this stays
  // a raw autoTable call inside the branded doc.
  const sortedAreas = sortByTier(audit.detailedAreas);

  autoTable(doc, {
    startY: contextY + 8,
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    head: [['Tier', 'Psychological Pillar', 'Score', 'Assessment Status', 'Strategic Improvement Plan']],
    body: sortedAreas.map((area) => [
      sanitizeForPdf(area.tier.toUpperCase()),
      sanitizeForPdf(area.area),
      `${area.score}/10`,
      sanitizeForPdf(area.status),
      sanitizeForPdf(area.opportunity),
    ]),
    theme: 'grid',
    headStyles: { fillColor: PRIMARY_BLUE, textColor: [255, 255, 255] },
    styles: { fontSize: 8, cellPadding: 2.5 },
    columnStyles: {
      0: { cellWidth: 20, fontStyle: 'bold', halign: 'center' },
      1: { cellWidth: 40, fontStyle: 'bold' },
      2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 55 },
      4: { cellWidth: 'auto' },
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const rowTier = sortedAreas[data.row.index]?.tier;
        if (data.column.index === 0 || data.column.index === 1) {
          if (rowTier === 'Red') data.cell.styles.textColor = [180, 0, 0];
          if (rowTier === 'Yellow') data.cell.styles.textColor = [180, 100, 0];
        }
      }
    },
  });

  const tableY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? contextY + 40;

  // Strengths
  const strengthY = brandedAutoTable(doc, {
    startY: tableY + 8,
    head: [['Core Strengths & Working Components']],
    body: [[sanitizeForPdf(audit.strengths)]],
    fontSize: 8.5,
  });

  // Opportunities
  brandedAutoTable(doc, {
    startY: strengthY + 6,
    head: [['Critical Opportunities (Optimization Roadmap)']],
    body: [[sanitizeForPdf(audit.opportunities)]],
    fontSize: 8.5,
  });
}

/**
 * Export full report PDF with summary + per-audit detail pages.
 */
export function downloadPDF(audits: ThumbnailAudit[]): void {
  const doc = createBrandedDoc({
    reportTitle: 'Thumbnail Analysis Report',
    reportSubtitle: `Elite Thumbnail Portfolio Analytics Summary — ${audits.length} video(s)`,
  });

  // Summary strategy line (shared header already covers the title block)
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.setFont('helvetica', 'normal');
  doc.text(
    sanitizeForPdf('Priority Strategy: Fix Red (Critical) first, then Yellow (Refinement).'),
    PDF_MARGIN,
    FIRST_PAGE_Y,
  );

  brandedAutoTable(doc, {
    startY: FIRST_PAGE_Y + 10,
    head: [['Video Title', 'Base Score', 'Potential', 'Executive Verdict']],
    body: audits.map((a) => [
      sanitizeForPdf(a.videoTitle),
      `${a.currentScore}/10`,
      `${a.expectedScore}/10`,
      sanitizeForPdf(a.reviewSummary),
    ]),
    fontSize: 9,
  });

  audits.forEach((audit) => {
    drawAuditPage(doc, audit);
  });

  finalizeBrandedDoc(doc);
  doc.save(pdfFileName('Thumbnail_Analysis_Report'));
}

/**
 * Export individual audit as a single-page PDF.
 */
export function downloadIndividualPDF(audit: ThumbnailAudit): void {
  const doc = createBrandedDoc({
    reportTitle: 'Thumbnail Analysis Report',
    reportSubtitle: sanitizeForPdf(audit.videoTitle) || 'Individual audit',
  });
  drawAuditPage(doc, audit, true);
  finalizeBrandedDoc(doc);
  const safeTitle = (audit.videoTitle || 'audit').replace(/[^a-z0-9]/gi, '_').substring(0, 25);
  doc.save(pdfFileName(`Thumbnail_Audit_${safeTitle}`));
}

/**
 * Export all audit data to an Excel (.xlsx) workbook.
 * Sheet 1: Summary -- one row per video with overview scores and context.
 * Sheet 2: Detailed Areas -- one row per analysis area per video.
 */
export function downloadExcel(audits: ThumbnailAudit[]): void {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Summary ──────────────────────────────────────────────────────
  const summaryRows = audits.map((a, i) => ({
    '#': i + 1,
    'Video URL': a.url,
    'Video Title': a.videoTitle,
    'Niche': a.niche || '',
    'Target Audience': a.targetAudience || '',
    'Brand Voice': a.brandVoice || '',
    'Current Score': a.currentScore,
    'Expected Score': a.expectedScore,
    'Review Summary': a.reviewSummary,
    'Strengths': a.strengths,
    'Opportunities': a.opportunities,
  }));
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);

  // Column widths for summary
  summarySheet['!cols'] = [
    { wch: 4 },   // #
    { wch: 50 },  // Video URL
    { wch: 40 },  // Video Title
    { wch: 18 },  // Niche
    { wch: 22 },  // Target Audience
    { wch: 22 },  // Brand Voice
    { wch: 14 },  // Current Score
    { wch: 14 },  // Expected Score
    { wch: 50 },  // Review Summary
    { wch: 40 },  // Strengths
    { wch: 40 },  // Opportunities
  ];

  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  // ── Sheet 2: Detailed Areas ────────────────────────────────────────────────
  const detailRows: Record<string, string | number>[] = [];
  audits.forEach((a) => {
    a.detailedAreas.forEach((area) => {
      detailRows.push({
        'Video Title': a.videoTitle,
        'Video URL': a.url,
        'Tier': area.tier,
        'Pillar': area.area,
        'Score': area.score,
        'Assessment': area.status,
        'Improvement Plan': area.opportunity,
      });
    });
  });

  if (detailRows.length > 0) {
    const detailSheet = XLSX.utils.json_to_sheet(detailRows);
    detailSheet['!cols'] = [
      { wch: 40 },  // Video Title
      { wch: 50 },  // Video URL
      { wch: 8 },   // Tier
      { wch: 30 },  // Pillar
      { wch: 8 },   // Score
      { wch: 30 },  // Assessment
      { wch: 60 },  // Improvement Plan
    ];
    XLSX.utils.book_append_sheet(wb, detailSheet, 'Detailed Areas');
  }

  // ── Sheet 3: Tally -- score distribution summary ──────────────────────────
  const tallyRows = audits.map((a) => {
    const redCount = a.detailedAreas.filter((x) => x.tier === 'Red').length;
    const yellowCount = a.detailedAreas.filter((x) => x.tier === 'Yellow').length;
    const greyCount = a.detailedAreas.filter((x) => x.tier === 'Grey').length;
    return {
      'Video Title': a.videoTitle,
      'Overall Score': a.currentScore,
      'Critical (Red)': redCount,
      'Improvement (Yellow)': yellowCount,
      'Polish (Grey)': greyCount,
      'Total Areas': a.detailedAreas.length,
    };
  });
  const tallySheet = XLSX.utils.json_to_sheet(tallyRows);
  tallySheet['!cols'] = [
    { wch: 40 },  // Video Title
    { wch: 14 },  // Overall Score
    { wch: 16 },  // Critical (Red)
    { wch: 20 },  // Improvement (Yellow)
    { wch: 14 },  // Polish (Grey)
    { wch: 14 },  // Total Areas
  ];
  XLSX.utils.book_append_sheet(wb, tallySheet, 'Tally');

  // ── Save ──────────────────────────────────────────────────────────────────
  XLSX.writeFile(wb, `RevKeter_Thumbnail_Analysis_${Date.now()}.xlsx`);
}

/**
 * Export all audit data to a CSV file.
 * Flattens each video's detailed areas into one row per area.
 */
export function downloadCSV(audits: ThumbnailAudit[]): void {
  const rows = audits.flatMap((a) =>
    a.detailedAreas.map((area) => ({
      'Video URL': a.url,
      'Video Title': a.videoTitle,
      'Niche': a.niche || '',
      'Target Audience': a.targetAudience || '',
      'Brand Voice': a.brandVoice || '',
      'Overall Score': a.currentScore,
      'Expected Score': a.expectedScore,
      'Review Summary': a.reviewSummary,
      'Strengths': a.strengths,
      'Opportunities': a.opportunities,
      'Tier': area.tier,
      'Pillar': area.area,
      'Pillar Score': area.score,
      'Assessment': area.status,
      'Improvement Plan': area.opportunity,
    })),
  );

  if (rows.length === 0) return;

  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `RevKeter_Thumbnail_Analysis_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
