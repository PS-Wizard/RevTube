// ─────────────────────────────────────────────────────────────────────────────
// Public Audit -- FULL report Excel export
//
// One workbook, one sheet per audit area so an admin gets the whole public audit
// (all channel stats + every category) in a single file:
//   Overview   -- report meta, full channel identity/stats, lifetime aggregates
//   Categories -- Full Audit category scores (each category sums to 100)
//   Criteria   -- per-category criterion breakdown (earned vs available points)
//   Videos     -- per-video public stats + element scores + category scores
//   Elements   -- video sub-audit element roll-up
//   Issues     -- ranked channel-wide issues, one row per affected item
//   Playlists  -- public playlists with size + description
//
// Builder is pure (`buildPublicAuditWorkbook`) so it is unit-testable without a
// DOM; `downloadPublicAuditExcel` lazy-loads `xlsx` through the shared
// `loadXlsx()` helper (Vite resolves `xlsx.mjs`, which ships named exports only
// and no default). No network, no auth.
// ─────────────────────────────────────────────────────────────────────────────
import type * as XLSX from 'xlsx';
import type jsPDF from 'jspdf';
import type { PublicAuditReport } from './publicAuditService';
import { loadXlsx } from '../components/chat/chatWorkbook';
import {
  brandedAutoTable,
  createBrandedDoc,
  exportElementToPdf,
  finalizeBrandedDoc,
  pdfFileName,
  sanitizeForPdf,
} from './pdf/brandedPdf';

const ELEMENTS = ['title', 'description', 'tags', 'keywords', 'thumbnail', 'captions'] as const;
const ELEMENT_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  tags: 'Tags',
  keywords: 'Keywords',
  thumbnail: 'Thumbnail',
  captions: 'Captions',
};

type Row = Record<string, string | number>;

const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const share = (earned: number | null, max: number | null): string => {
  if (earned === null || max === null || max <= 0) return '—';
  return `${Math.round((earned / max) * 100)}%`;
};

const engagementPct = (views: unknown, likes: unknown, comments: unknown): string => {
  const v = num(views);
  if (v === null || v <= 0) return '—';
  const l = num(likes) ?? 0;
  const c = num(comments) ?? 0;
  return `${(((l + c) / v) * 100).toFixed(2)}%`;
};

const slug = (value: string): string =>
  (value || 'channel').replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').slice(0, 40);

// ── Sheet builders ───────────────────────────────────────────────────────────

/** Two-column field/value report sheet (channel identity + full stats + lifetime). */
function overviewRows(report: PublicAuditReport): (string | number)[][] {
  const snap = report.snapshot || {};
  const stats = snap.statistics || {};
  const life = report.channelLifetime;
  return [
    ['Field', 'Value'],
    ['Report ID', report.id],
    ['Channel title', report.channelTitle || ''],
    ['Channel ID', report.channelId || ''],
    ['Channel handle', snap.handle || snap.customUrl || ''],
    ['Country', snap.country || ''],
    ['Channel URL', report.channelId ? `https://www.youtube.com/channel/${report.channelId}` : ''],
    ['Avatar URL', snap.avatarUrl || ''],
    ['Banner URL', snap.bannerUrl || ''],
    ['Channel created', snap.channelPublishedAt || ''],
    ['Channel description', snap.description || ''],
    ['Channel keywords', snap.channelKeywords || ''],
    ['Topics', (snap.topics || []).join(', ')],
    ['Subscribers', stats.subscriberCount ?? ''],
    ['Channel lifetime views', stats.viewCount ?? ''],
    ['Channel uploads', stats.videoCount ?? ''],
    ['Subscriber count hidden', stats.hiddenSubscriberCount ? 'yes' : 'no'],
    ['Videos audited', report.videoCount],
    ['Audited at', report.auditedAt || ''],
    ['Saved at', report.createdAt || ''],
    ['Saved by', report.createdByEmail || ''],
    ['FULL audit score (headline)', report.overall ?? ''],
    ['Video sub-audit score', report.videoAuditOverall ?? ''],
    ['Full audit source', report.fullAudit?.source || ''],
    ['Lifetime views (audited videos)', life?.totalViewsAudited ?? ''],
    ['Lifetime likes (audited videos)', life?.totalLikesAudited ?? ''],
    ['Lifetime comments (audited videos)', life?.totalCommentsAudited ?? ''],
    ['Avg views / audited video', life?.avgViewsPerVideo ?? ''],
    ['Engagement rate (likes+comments / views)', life?.engagementRatePct != null ? `${life.engagementRatePct}%` : ''],
    ['Upload cadence (days between uploads)', life?.uploadCadenceDays ?? ''],
    ['Oldest audited upload', life?.oldestAuditedAt || ''],
    ['Newest audited upload', life?.newestAuditedAt || ''],
    ['Shorts audited', life?.shortsCount ?? ''],
    ['Long-form audited', life?.longformCount ?? ''],
    ['Playlists found', report.playlists?.length ?? 0],
    ['Categories scored', report.fullAudit?.categories.length ?? 0],
  ];
}

/** Full Audit categories: one row per category with its gap to a perfect score. */
function categoryRows(report: PublicAuditReport): Row[] {
  return (report.fullAudit?.categories || []).map((c) => ({
    Category: c.label,
    Key: c.key,
    Score: c.score,
    Max: c.max,
    'Score %': share(c.score, c.max),
    'Points lost': Math.max(0, c.max - c.score),
    Criteria: c.breakdown.length,
  }));
}

/** Every criterion of every category — the "per category" detail. */
function criteriaRows(report: PublicAuditReport): Row[] {
  const rows: Row[] = [];
  for (const category of report.fullAudit?.categories || []) {
    for (const c of category.breakdown) {
      rows.push({
        Category: category.label,
        Criterion: c.label,
        Key: c.key,
        Earned: c.earned,
        Max: c.max,
        'Score %': share(c.earned, c.max),
        'Points lost': Math.max(0, c.max - c.earned),
      });
    }
  }
  return rows;
}

/** Per-video public stats + video sub-audit element scores + Full Audit categories. */
function videoRows(report: PublicAuditReport): Row[] {
  const elements = new Set<string>();
  const categoryKeys = new Set<string>();
  for (const r of report.results || []) {
    for (const el of r.elements || []) elements.add(el.element);
    for (const c of r.categories || []) categoryKeys.add(c.key);
  }
  const extraElements = [...elements].filter((e) => !(ELEMENTS as readonly string[]).includes(e));

  return (report.results || []).map((r, i) => {
    const stats = r.statistics || {};
    const row: Row = {
      '#': i + 1,
      'Video ID': r.videoId,
      'Video title': r.videoTitle,
      'Video URL': r.videoId ? `https://www.youtube.com/watch?v=${r.videoId}` : '',
      Published: r.publishedAt || '',
      Duration: r.durationLabel || '',
      Definition: r.definition || '',
      Live: r.liveBroadcastContent || '',
      Views: num(stats.viewCount) ?? 0,
      Likes: num(stats.likeCount) ?? 0,
      Comments: num(stats.commentCount) ?? 0,
      'Engagement %': engagementPct(stats.viewCount, stats.likeCount, stats.commentCount),
      'Video sub-audit score': r.total,
      'Projected if fixed': r.projectedTotal ?? r.total,
      'Fix first': r.recommendations?.[0]
        ? `${ELEMENT_LABELS[r.recommendations[0].element] || r.recommendations[0].element} (+${r.recommendations[0].delta})`
        : '',
    };
    for (const key of [...ELEMENTS, ...extraElements]) {
      const el = (r.elements || []).find((e) => e.element === key);
      const label = ELEMENT_LABELS[key] || key;
      if (!el) continue;
      row[`${label} element`] = el.score;
      row[`${label} max`] = el.max;
    }
    for (const key of categoryKeys) {
      const cat = (r.categories || []).find((c) => c.key === key);
      if (!cat) continue;
      row[`${cat.label || key} score`] = cat.score;
      row[`${cat.label || key} max`] = cat.max;
    }
    return row;
  });
}

/** Element roll-up across the audited videos (video sub-audit dimensions). */
function elementRows(report: PublicAuditReport): Row[] {
  const results = report.results || [];
  return ELEMENTS.map((key) => {
    const scored = results
      .map((r) => (r.elements || []).find((e) => e.element === key))
      .filter((el): el is NonNullable<typeof el> => Boolean(el) && (el?.max ?? 0) > 0);
    const avg = scored.length ? scored.reduce((s, el) => s + el.score, 0) / scored.length : null;
    const max = scored.length ? Math.max(...scored.map((el) => el.max)) : null;
    return {
      Element: ELEMENT_LABELS[key],
      'Videos measured': scored.length,
      'Avg score': avg === null ? '' : Number(avg.toFixed(1)),
      'Max points': max ?? '',
      'Avg %': avg === null ? '—' : share(avg, max),
    };
  });
}

/** Ranked issues, flattened to one row per affected item (Excel-filterable). */
function issueRows(report: PublicAuditReport): Row[] {
  const rows: Row[] = [];
  for (const issue of report.fullAudit?.issues || []) {
    const base = {
      Issue: issue.label,
      Severity: issue.severity,
      Affected: issue.count,
      'How to fix': issue.hint,
    };
    if (issue.affected.length === 0) {
      rows.push({ ...base, Type: '', Title: '', URL: '' });
      continue;
    }
    for (const item of issue.affected) {
      rows.push({ ...base, Type: item.type, Title: item.title, URL: item.url || '' });
    }
  }
  return rows;
}

/** Public playlists: audit score + top fix per playlist with size + description. */
function playlistRows(report: PublicAuditReport): Row[] {
  const healthById = new Map(
    (report.fullAudit?.health?.playlists ?? []).map((h) => [h.playlistId, h]),
  );
  return (report.playlists || []).map((p, i) => {
    const audit = healthById.get(p.playlistId);
    return {
      '#': i + 1,
      Playlist: p.title,
      'Playlist ID': p.playlistId,
      'Playlist URL': p.playlistId ? `https://www.youtube.com/playlist?list=${p.playlistId}` : '',
      Score: audit?.health ?? '',
      'Top fix': audit?.hint ?? '',
      Videos: num(p.itemCount) ?? '',
      Published: p.publishedAt || '',
      Description: p.description || '',
    };
  });
}

// ── Workbook assembly ────────────────────────────────────────────────────────

type XlsxModule = typeof import('xlsx');

function addSheet(xlsx: XlsxModule, wb: XLSX.WorkBook, name: string, rows: Row[], widths: number[]) {
  const sheet = rows.length > 0 ? xlsx.utils.json_to_sheet(rows) : xlsx.utils.aoa_to_sheet([['No data']]);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  xlsx.utils.book_append_sheet(wb, sheet, name);
}

/**
 * Build the full-report workbook. Order is intentional: summary first, detail
 * after, so the admin can read the top sheet and pivot the rest.
 *
 * `XLSX` comes from the shared `loadXlsx()` helper — never `import * as XLSX`
 * (Vite resolves `xlsx.mjs`, which has named exports only and no default).
 */
export async function buildPublicAuditWorkbook(report: PublicAuditReport): Promise<XLSX.WorkBook> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();

  const overview = XLSX.utils.aoa_to_sheet(overviewRows(report));
  overview['!cols'] = [{ wch: 38 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, overview, 'Overview');

  addSheet(XLSX, wb, 'Categories', categoryRows(report), [26, 12, 8, 8, 10, 12, 10]);
  addSheet(XLSX, wb, 'Criteria', criteriaRows(report), [26, 28, 20, 9, 8, 10, 12, 10]);
  addSheet(XLSX, wb, 'Videos', videoRows(report), [4, 14, 46, 40, 22, 10, 10, 8, 12, 10, 10, 13, 14, 14, 22]);
  addSheet(XLSX, wb, 'Elements', elementRows(report), [14, 16, 11, 11, 9]);
  addSheet(XLSX, wb, 'Issues', issueRows(report), [28, 10, 10, 10, 48, 46, 52]);
  addSheet(XLSX, wb, 'Playlists', playlistRows(report), [4, 40, 24, 48, 8, 40, 8, 22, 60]);
  return wb;
}

/** File name keeps the channel + date so repeated exports never overwrite. */
export function publicAuditFileName(report: PublicAuditReport): string {
  const date = (report.auditedAt || report.createdAt || new Date().toISOString()).slice(0, 10);
  return `RevKeter_PublicAudit_${slug(report.channelTitle || report.channelInput || '')}_${date}.xlsx`;
}

/** Download the full public-audit report as a single .xlsx workbook. */
export async function downloadPublicAuditExcel(report: PublicAuditReport): Promise<void> {
  const XLSX = await loadXlsx();
  XLSX.writeFile(await buildPublicAuditWorkbook(report), publicAuditFileName(report));
}

// ── PDF export (selectable text + per-video + image) ──────────────────────────
// Mirrors `services/videoAuditExport.ts`: selectable-text tables via
// `brandedAutoTable` (copyable, Latin-1 sanitized), and a non-selectable image
// path via `exportElementToPdf` (exact on-screen pixels via html2canvas).

const PDF_MARGIN = 40;
const PDF_FIRST_Y = 120;
const PDF_NEXT_Y = 40;

type PublicAuditVideo = PublicAuditReport['results'][number];

function pdfSlug(value: string): string {
  return (value || 'channel').replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').slice(0, 40);
}

function pdfBaseName(report: PublicAuditReport): string {
  const date = (report.auditedAt || report.createdAt || new Date().toISOString()).slice(0, 10);
  return `ChannelAudit_${pdfSlug(report.channelTitle || report.channelInput || '')}_${date}`;
}

function elementCell(video: PublicAuditVideo, key: string): string {
  const el = (video.elements || []).find((e) => e.element === key);
  if (!el || (el.max ?? 0) <= 0) return '—';
  return `${el.score.toFixed(0)}/${el.max.toFixed(0)}`;
}

/** Section heading inside the doc body. Returns the Y below the heading. */
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

/** One video page for the per-video PDF (same shape as the video-audit PDF). */
function drawVideoPdfPage(doc: jsPDF, video: PublicAuditVideo, channelTitle: string, isFirstPage: boolean): void {
  if (!isFirstPage) doc.addPage();
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - PDF_MARGIN * 2;
  let y = isFirstPage ? PDF_FIRST_Y : PDF_NEXT_Y;

  doc.setFontSize(14);
  doc.setTextColor(54, 101, 155);
  doc.setFont('helvetica', 'bold');
  const title = doc.splitTextToSize(sanitizeForPdf(video.videoTitle) || 'Untitled video', contentWidth);
  doc.text(title, PDF_MARGIN, y);
  y += title.length * 18 + 4;

  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.setFont('helvetica', 'normal');
  const meta: string[] = [
    `Channel: ${sanitizeForPdf(channelTitle) || '—'}`,
    `Video ID: ${sanitizeForPdf(video.videoId)}`,
    `Watch: https://www.youtube.com/watch?v=${video.videoId}`,
    `Overall Score: ${Number(video.total ?? 0).toFixed(1)} / 100`,
  ];
  if ((video.projectedTotal ?? video.total) > video.total) {
    meta.push(`Projected if fixed: ${Number(video.projectedTotal).toFixed(1)} / 100 (+${((video.projectedTotal ?? 0) - (video.total ?? 0)).toFixed(0)})`);
  }
  for (const line of meta) {
    for (const wrapped of doc.splitTextToSize(line, contentWidth)) {
      doc.text(wrapped, PDF_MARGIN, y);
      y += 12;
    }
  }

  const endY = brandedAutoTable(doc, {
    startY: y + 4,
    head: [['Element', 'Score', 'Max', 'Criteria Breakdown']],
    body: ELEMENTS.map((key) => {
      const es = (video.elements || []).find((e) => e.element === key);
      const notes = (es?.breakdown ?? [])
        .map((b) => `${b.criterion}: ${Number(b.earned ?? 0).toFixed(0)}/${Number(b.max ?? 0).toFixed(0)}`)
        .join('\n');
      return [
        sanitizeForPdf(ELEMENT_LABELS[key] || key),
        es ? Number(es.score ?? 0).toFixed(1) : '—',
        es ? Number(es.max ?? 0).toFixed(0) : '—',
        sanitizeForPdf(notes),
      ];
    }),
    fontSize: 8,
  });

  const recs = video.recommendations || [];
  if (recs.length > 0) {
    const ry = pdfSection(doc, 'Recommended fixes', endY + 18);
    const rows = recs.map((r) => [
      sanitizeForPdf(ELEMENT_LABELS[r.element] || r.element),
      `+${Number(r.delta ?? 0).toFixed(0)} pts -> ${Number(r.projected ?? 0).toFixed(0)}`,
    ]);
    brandedAutoTable(doc, {
      startY: ry,
      head: [['Fix', 'Expected uplift']],
      body: rows,
      fontSize: 8,
    });
  }
}

/** Download a single audited video as a selectable-text PDF (this video only). */
export function downloadPublicAuditVideoPdf(video: PublicAuditVideo, channelTitle: string): void {
  const doc = createBrandedDoc({
    reportTitle: 'Channel Audit — Video Report',
    reportSubtitle: sanitizeForPdf(video.videoTitle) || 'Individual video audit',
  });
  drawVideoPdfPage(doc, video, channelTitle, true);
  finalizeBrandedDoc(doc);
  doc.save(pdfFileName(`Channel_Audit_Video_${pdfSlug(video.videoTitle || video.videoId)}`));
}

/** One-row workbook for a single audited video (pure — unit-testable, no DOM). */
export async function buildPublicAuditVideoWorkbook(
  video: PublicAuditVideo,
  channelTitle: string,
  channelId?: string | null,
): Promise<XLSX.WorkBook> {
  const XLSX = await loadXlsx();
  const stats = video.statistics || {};
  const wb = XLSX.utils.book_new();
  const rows: Row[] = [
    {
      Channel: channelTitle || '',
      'Video ID': video.videoId,
      'Video title': video.videoTitle,
      'Video URL': video.videoId ? `https://www.youtube.com/watch?v=${video.videoId}` : '',
      Published: video.publishedAt || '',
      Duration: video.durationLabel || '',
      Views: num(stats.viewCount) ?? 0,
      Likes: num(stats.likeCount) ?? 0,
      Comments: num(stats.commentCount) ?? 0,
      'Engagement %': engagementPct(stats.viewCount, stats.likeCount, stats.commentCount),
      Score: video.total,
      'Projected if fixed': video.projectedTotal ?? video.total,
      'Fix first': video.recommendations?.[0]
        ? `${ELEMENT_LABELS[video.recommendations[0].element] || video.recommendations[0].element} (+${video.recommendations[0].delta})`
        : '',
      ...(channelId ? { 'Channel URL': `https://www.youtube.com/channel/${channelId}` } : {}),
    },
  ];
  for (const key of ELEMENTS) {
    const el = (video.elements || []).find((e) => e.element === key);
    if (!el) continue;
    rows[0][`${ELEMENT_LABELS[key]} score`] = el.score;
    rows[0][`${ELEMENT_LABELS[key]} max`] = el.max;
  }
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = [{ wch: 24 }, { wch: 14 }, { wch: 46 }, { wch: 42 }, { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 13 }, { wch: 8 }, { wch: 14 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, sheet, 'Video');
  return wb;
}

/** Download a single audited video as a one-row Excel file (this video only). */
export async function downloadPublicAuditVideoExcel(
  video: PublicAuditVideo,
  channelTitle: string,
  report?: Pick<PublicAuditReport, 'channelId'> | null,
): Promise<void> {
  const XLSX = await loadXlsx();
  XLSX.writeFile(
    await buildPublicAuditVideoWorkbook(video, channelTitle, report?.channelId),
    `ChannelAudit_Video_${pdfSlug(video.videoTitle || video.videoId)}.xlsx`,
  );
}

/** Download the FULL channel-audit report as a selectable-text PDF. */
export function downloadPublicAuditPdf(report: PublicAuditReport): void {
  const doc = createBrandedDoc({
    reportTitle: 'Channel Audit Report',
    reportSubtitle: `${sanitizeForPdf(report.channelTitle || report.channelInput || 'Channel')} — ${report.videoCount} video(s) audited`,
  });
  const snap = report.snapshot || {};
  const stats = snap.statistics || {};
  const life = report.channelLifetime;
  let y = PDF_FIRST_Y;

  // 1. Channel overview
  y = pdfSection(doc, 'Channel overview', y);
  const overviewBody: string[][] = [
    ['Channel', sanitizeForPdf(report.channelTitle || '')],
    ['Handle', sanitizeForPdf(snap.handle || snap.customUrl || '')],
    ['Country', sanitizeForPdf(snap.country || '')],
    ['Subscribers', sanitizeForPdf(stats.subscriberCount ?? '—')],
    ['Lifetime views', sanitizeForPdf(stats.viewCount ?? '—')],
    ['Uploads', sanitizeForPdf(stats.videoCount ?? '—')],
    ['Overall score', `${report.overall ?? '—'} / 100`],
    ['Videos audited', String(report.videoCount)],
    ['Avg views / video', life?.avgViewsPerVideo != null ? String(life.avgViewsPerVideo) : '—'],
    ['Engagement rate', life?.engagementRatePct != null ? `${life.engagementRatePct}%` : '—'],
    ['Upload cadence', life?.uploadCadenceDays != null ? `~${life.uploadCadenceDays} days` : '—'],
    ['Shorts / Long-form', life ? `${life.shortsCount} / ${life.longformCount}` : '—'],
    ['Playlists found', String(report.playlists?.length ?? 0)],
  ];
  y = brandedAutoTable(doc, { startY: y, head: [['Field', 'Value']], body: overviewBody, fontSize: 9 });

  // 2. Category scores
  const categories = report.fullAudit?.categories || [];
  if (categories.length > 0) {
    y = pdfSection(doc, 'Category scores', y + 18);
    y = brandedAutoTable(doc, {
      startY: y,
      head: [['Category', 'Score', 'Max', 'Top criteria']],
      body: categories.map((c) => [
        sanitizeForPdf(c.label),
        String(c.score),
        String(c.max),
        sanitizeForPdf((c.breakdown || []).slice(0, 3).map((b) => `${b.label} ${b.earned}/${b.max}`).join('\n')),
      ]),
      fontSize: 8,
    });
  }

  // 3. Issues
  const issues = report.fullAudit?.issues || [];
  if (issues.length > 0) {
    y = pdfSection(doc, 'Top opportunities', y + 18);
    y = brandedAutoTable(doc, {
      startY: y,
      head: [['Issue', 'Severity', 'How to fix']],
      body: issues.slice(0, 8).map((i) => [sanitizeForPdf(i.label), sanitizeForPdf(i.severity), sanitizeForPdf(i.hint)]),
      fontSize: 8,
    });
  }

  // 4. Videos (full detail per video)
  const videos = report.results || [];
  if (videos.length > 0) {
    y = pdfSection(doc, `Audited videos (${videos.length})`, y + 18);
    y = brandedAutoTable(doc, {
      startY: y,
      head: [['#', 'Video', 'Score', 'Proj.', 'Views', 'Eng.%', 'Title', 'Desc.', 'Tags', 'Keyw.', 'Thumb', 'Capt.']],
      body: videos.map((v, i) => {
        const st = v.statistics || {};
        return [
          String(i + 1),
          sanitizeForPdf((v.videoTitle || v.videoId).slice(0, 60)),
          String(v.total ?? '—'),
          String(v.projectedTotal ?? v.total ?? '—'),
          sanitizeForPdf(st.viewCount ?? '—'),
          engagementPct(st.viewCount, st.likeCount, st.commentCount),
          elementCell(v, 'title'),
          elementCell(v, 'description'),
          elementCell(v, 'tags'),
          elementCell(v, 'keywords'),
          elementCell(v, 'thumbnail'),
          elementCell(v, 'captions'),
        ];
      }),
      fontSize: 7,
    });
  }

  // 5. Playlists
  const playlists = report.playlists || [];
  if (playlists.length > 0) {
    const playlistHealth = new Map(
      (report.fullAudit?.health?.playlists ?? []).map((h) => [h.playlistId, h.health]),
    );
    y = pdfSection(doc, `Playlists (${playlists.length})`, y + 18);
    brandedAutoTable(doc, {
      startY: y,
      head: [['#', 'Playlist', 'Score', 'Videos', 'Published']],
      body: playlists.map((p, i) => [
        String(i + 1),
        sanitizeForPdf((p.title || p.playlistId).slice(0, 60)),
        playlistHealth.has(p.playlistId) ? String(playlistHealth.get(p.playlistId)) : '—',
        p.itemCount != null ? String(p.itemCount) : '—',
        sanitizeForPdf(p.publishedAt || '—'),
      ]),
      fontSize: 8,
    });
  }

  finalizeBrandedDoc(doc);
  doc.save(pdfFileName(pdfBaseName(report)));
}

/**
 * Download the report area as a NON-selectable image PDF (exact on-screen
 * pixels). Pass a ref to the rendered report element (e.g. the hero + tables
 * wrapper). Text is rasterized, so nothing stays copyable.
 */
export async function exportPublicAuditImagePdf(element: HTMLElement, report: PublicAuditReport): Promise<void> {
  await exportElementToPdf(element, {
    reportTitle: 'Channel Audit Report',
    reportSubtitle: `${sanitizeForPdf(report.channelTitle || report.channelInput || 'Channel')} — ${report.videoCount} video(s) audited`,
    filename: pdfFileName(`${pdfBaseName(report)}_image`),
  });
}
