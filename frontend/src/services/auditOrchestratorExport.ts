// ─────────────────────────────────────────────────────────────────────────────
// Full Audit (orchestrator) -- Excel + PDF export service.
//
// One place for the whole persisted run (GET /audit-orchestrator/:id):
//   Excel: Overview / Categories / Criteria / Recommendations / Videos sheets
//   PDF (selectable text): branded report via brandedAutoTable
//   PDF (image): exact on-screen pixels via exportElementToPdf (emoji-safe)
//
// Builders are pure (unit-testable, no DOM); downloads lazy-load `xlsx` and
// use the shared branded-PDF chrome. No network, no auth.
// ─────────────────────────────────────────────────────────────────────────────
import type * as XLSX from 'xlsx';
import type jsPDF from 'jspdf';
import type {
  AuditedVideoItem,
  AuditRunRow,
  AuditSubRunResultRow,
} from './auditOrchestratorService';
import { loadXlsx } from '../components/chat/chatWorkbook';
import {
  brandedAutoTable,
  createBrandedDoc,
  exportElementToPdf,
  finalizeBrandedDoc,
  pdfFileName,
  sanitizeForPdf,
} from './pdf/brandedPdf';

type Row = Record<string, string | number>;

const SUB_RUN_LABELS: Record<string, string> = {
  channelIdentity: 'Channel Identity & Branding',
  video: 'Video Optimization & SEO',
  playlist: 'Playlist Structure & Depth',
  general: 'Cadence & Content Trends',
};

const slug = (value: string): string =>
  (value || 'channel').replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').slice(0, 40);

const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const share = (earned: number | null, max: number | null): string => {
  if (earned === null || max === null || max <= 0) return '—';
  return `${Math.round((earned / max) * 100)}%`;
};

function pdfBaseName(run: AuditRunRow): string {
  const date = (run.completed_at || run.created_at || new Date().toISOString()).slice(0, 10);
  return `FullAudit_${slug(run.channel_title || '')}_${date}`;
}

// ── Sheet builders ───────────────────────────────────────────────────────────

function overviewRows(run: AuditRunRow, subRuns: AuditSubRunResultRow[]): (string | number)[][] {
  const rows: (string | number)[][] = [
    ['Field', 'Value'],
    ['Report ID', run.id],
    ['Channel title', run.channel_title || ''],
    ['Channel ID', run.channel_id || ''],
    ['Channel URL', run.channel_id ? `https://www.youtube.com/channel/${run.channel_id}` : ''],
    ['Overall score', run.overall_score ?? ''],
    ['Grade', run.overall_grade || ''],
    ['Status', run.status || ''],
    ['Thumbnail AI', run.include_thumbnail_ai ? 'yes' : 'no'],
    ['Started', run.started_at || ''],
    ['Completed', run.completed_at || ''],
    ['Saved', run.created_at || ''],
  ];
  for (const s of subRuns) {
    const label = SUB_RUN_LABELS[s.type] || s.type;
    rows.push([`${label} score`, s.score ?? '']);
    rows.push([`${label} status`, s.status || '']);
  }
  return rows;
}

function categoryRows(subRuns: AuditSubRunResultRow[]): Row[] {
  return subRuns.map((s) => {
    const params = s.results?.params || [];
    const max = params.reduce((sum, p) => sum + (Number(p.max) || 0), 0);
    return {
      Category: SUB_RUN_LABELS[s.type] || s.type,
      Key: s.type,
      Score: s.score ?? '',
      Status: s.status || '',
      Criteria: params.length,
      'Max points': max,
    };
  });
}

function criteriaRows(subRuns: AuditSubRunResultRow[]): Row[] {
  const rows: Row[] = [];
  for (const s of subRuns) {
    const label = SUB_RUN_LABELS[s.type] || s.type;
    for (const p of s.results?.params || []) {
      rows.push({
        Category: label,
        Criterion: p.label,
        Key: p.key,
        Earned: p.earned ?? '',
        Max: p.max,
        'Score %': share(num(p.earned), num(p.max)),
        Detail: (p.detail || []).map((d) => `${d.label} ${d.earned}/${d.max}`).join('; '),
      });
    }
  }
  return rows;
}

function recommendationRows(subRuns: AuditSubRunResultRow[]): Row[] {
  const rows: Row[] = [];
  for (const s of subRuns) {
    const label = SUB_RUN_LABELS[s.type] || s.type;
    for (const r of s.results?.recommendations || []) {
      rows.push({
        Category: label,
        Severity: r.severity,
        Param: r.paramKey,
        Message: r.message,
        'Impact gain': r.impactGain ?? '',
        'Impact penalty': r.impactPenalty ?? '',
      });
    }
  }
  return rows;
}

function videosOf(subRuns: AuditSubRunResultRow[]): AuditedVideoItem[] {
  const sub = subRuns.find((s) => s.type === 'video');
  const list = sub?.results?.meta?.videos;
  return Array.isArray(list) ? list : [];
}

function videoRows(subRuns: AuditSubRunResultRow[]): Row[] {
  return videosOf(subRuns).map((v, i) => ({
    '#': i + 1,
    'Video ID': v.videoId,
    Title: v.title,
    'Video URL': v.url || (v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : ''),
    Published: v.publishedAt || '',
    Views: v.viewCount ?? '',
    Likes: v.likeCount ?? '',
    Comments: v.commentCount ?? '',
    Score: v.score ?? '',
    'Projected if fixed': v.projectedTotal ?? v.score ?? '',
  }));
}

// ── Workbook assembly ────────────────────────────────────────────────────────

type XlsxModule = typeof import('xlsx');

function addSheet(xlsx: XlsxModule, wb: XLSX.WorkBook, name: string, rows: Row[], widths: number[]) {
  const sheet = rows.length > 0 ? xlsx.utils.json_to_sheet(rows) : xlsx.utils.aoa_to_sheet([['No data']]);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  xlsx.utils.book_append_sheet(wb, sheet, name);
}

/** Build the full-report workbook (pure — unit-testable, never writes a file). */
export async function buildFullAuditWorkbook(
  run: AuditRunRow,
  subRuns: AuditSubRunResultRow[],
): Promise<XLSX.WorkBook> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();

  const overview = XLSX.utils.aoa_to_sheet(overviewRows(run, subRuns));
  overview['!cols'] = [{ wch: 30 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, overview, 'Overview');

  addSheet(XLSX, wb, 'Categories', categoryRows(subRuns), [32, 16, 8, 12, 10, 12]);
  addSheet(XLSX, wb, 'Criteria', criteriaRows(subRuns), [32, 34, 22, 9, 8, 10, 60]);
  addSheet(XLSX, wb, 'Recommendations', recommendationRows(subRuns), [32, 10, 22, 80, 12, 14]);
  addSheet(XLSX, wb, 'Videos', videoRows(subRuns), [4, 14, 46, 42, 22, 10, 10, 10, 8, 14]);
  return wb;
}

/** File name keeps the channel + date so repeated exports never overwrite. */
export function fullAuditFileName(run: AuditRunRow): string {
  const date = (run.completed_at || run.created_at || new Date().toISOString()).slice(0, 10);
  return `RevKeter_FullAudit_${slug(run.channel_title || '')}_${date}.xlsx`;
}

/** Download the FULL run report as a single .xlsx workbook. */
export async function downloadFullAuditExcel(run: AuditRunRow, subRuns: AuditSubRunResultRow[]): Promise<void> {
  const XLSX = await loadXlsx();
  XLSX.writeFile(await buildFullAuditWorkbook(run, subRuns), fullAuditFileName(run));
}

// ── Selectable-text PDF ──────────────────────────────────────────────────────

const PDF_MARGIN = 40;
const PDF_FIRST_Y = 120;
const PDF_NEXT_Y = 40;

function pdfSection(doc: jsPDF, title: string, y: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y > pageHeight - 120) {
    doc.addPage();
    y = PDF_NEXT_Y;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(54, 101, 155);
  doc.text(sanitizeForPdf(title), PDF_MARGIN, y);
  return y + 14;
}

/** Download the FULL run report as a selectable-text PDF. */
export function downloadFullAuditPdf(run: AuditRunRow, subRuns: AuditSubRunResultRow[]): void {
  const doc = createBrandedDoc({
    reportTitle: 'Full Channel Audit Report',
    reportSubtitle: `${sanitizeForPdf(run.channel_title || 'Channel')} — overall ${run.overall_score ?? '—'}/100`,
  });
  let y = PDF_FIRST_Y;

  y = pdfSection(doc, 'Run overview', y);
  y = brandedAutoTable(doc, {
    startY: y,
    head: [['Field', 'Value']],
    body: [
      ['Channel', sanitizeForPdf(run.channel_title || '')],
      ['Overall score', `${run.overall_score ?? '—'} / 100${run.overall_grade ? ` (${sanitizeForPdf(run.overall_grade)})` : ''}`],
      ['Status', sanitizeForPdf(run.status || '')],
      ['Thumbnail AI', run.include_thumbnail_ai ? 'yes' : 'no'],
      ['Completed', sanitizeForPdf(run.completed_at || run.created_at || '')],
      ...subRuns.map((s): string[] => [
        sanitizeForPdf(SUB_RUN_LABELS[s.type] || s.type),
        `${s.score ?? '—'} (${sanitizeForPdf(s.status || '')})`,
      ]),
    ],
    fontSize: 9,
  });

  const withParams = subRuns.filter((s) => (s.results?.params || []).length > 0);
  if (withParams.length > 0) {
    y = pdfSection(doc, 'Criteria breakdown', y + 18);
    const body: string[][] = [];
    for (const s of withParams) {
      for (const p of s.results?.params || []) {
        body.push([
          sanitizeForPdf(SUB_RUN_LABELS[s.type] || s.type),
          sanitizeForPdf(p.label),
          p.earned != null ? String(p.earned) : '—',
          String(p.max),
        ]);
      }
    }
    y = brandedAutoTable(doc, {
      startY: y,
      head: [['Category', 'Criterion', 'Earned', 'Max']],
      body,
      fontSize: 8,
    });
  }

  const recs = subRuns.flatMap((s) =>
    (s.results?.recommendations || []).map((r) => ({ cat: SUB_RUN_LABELS[s.type] || s.type, r })),
  );
  if (recs.length > 0) {
    y = pdfSection(doc, `Top recommendations (${recs.length})`, y + 18);
    y = brandedAutoTable(doc, {
      startY: y,
      head: [['Category', 'Severity', 'Recommendation']],
      body: recs.slice(0, 40).map(({ cat, r }) => [
        sanitizeForPdf(cat),
        sanitizeForPdf(r.severity),
        sanitizeForPdf(r.message).slice(0, 300),
      ]),
      fontSize: 8,
    });
  }

  const videos = videosOf(subRuns);
  if (videos.length > 0) {
    y = pdfSection(doc, `Audited videos (${videos.length})`, y + 18);
    brandedAutoTable(doc, {
      startY: y,
      head: [['#', 'Video', 'Score', 'Views', 'Published']],
      body: videos.map((v, i) => [
        String(i + 1),
        sanitizeForPdf((v.title || v.videoId).slice(0, 60)),
        v.score != null ? String(v.score) : '—',
        v.viewCount != null ? String(v.viewCount) : '—',
        sanitizeForPdf(v.publishedAt || '—'),
      ]),
      fontSize: 7,
    });
  }

  finalizeBrandedDoc(doc);
  doc.save(pdfFileName(pdfBaseName(run)));
}

/**
 * Download the report area as a NON-selectable image PDF (exact on-screen
 * pixels, emoji-safe). Pass a ref to the rendered report element.
 */
export async function exportFullAuditImagePdf(element: HTMLElement, run: AuditRunRow): Promise<void> {
  await exportElementToPdf(element, {
    reportTitle: 'Full Channel Audit Report',
    reportSubtitle: `${sanitizeForPdf(run.channel_title || 'Channel')} — overall ${run.overall_score ?? '—'}/100`,
    filename: pdfFileName(`${pdfBaseName(run)}_image`),
  });
}
