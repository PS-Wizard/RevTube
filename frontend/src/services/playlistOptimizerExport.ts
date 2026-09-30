// ─────────────────────────────────────────────────────────────────────────────
// Playlist Optimizer -- Export utilities (JSON, CSV, PDF, ZIP, YAML)
// ─────────────────────────────────────────────────────────────────────────────
import * as XLSX from 'xlsx';
import { analysisToYaml } from '../utils/yaml';
import {
  brandedAutoTable,
  createBrandedDoc,
  finalizeBrandedDoc,
  pdfFileName,
  sanitizeForPdf,
} from '@/services/pdf/brandedPdf';
import type {
  AnalysisResult,
  FilterConfig,
  PlaylistRecommendation,
  Video,
} from '../types/playlistOptimizer';

// ── Utility: escape CSV fields ─────────────────────────────────────────────
function escapeCsv(str: string): string {
  if (!str) return '""';
  const escaped = String(str).replace(/"/g, '""');
  return `"${escaped}"`;
}

// ── Utility: normalize text ────────────────────────────────────────────────
function normalizeText(str: string): string {
  if (typeof str !== 'string') return str;
  return str.replace(/ /g, ' ').replace(/Â/g, '').normalize('NFC');
}

// ── Utility: safe text with normalization ──────────────────────────────────
function safeCsv(value: any): string {
  return escapeCsv(normalizeText(String(value ?? '')));
}

// ═══════════════════════════════════════════════════════════════════════════
// JSON Export
// ═══════════════════════════════════════════════════════════════════════════
export function downloadJSON(result: AnalysisResult, filename?: string) {
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  downloadBlob(blob, filename || `TubeStrategist_Analysis_${dateStamp()}.json`);
}

// ═══════════════════════════════════════════════════════════════════════════
// YAML Export
// ═══════════════════════════════════════════════════════════════════════════
export function downloadYaml(result: AnalysisResult, filename?: string) {
  const blob = new Blob([analysisToYaml(result)], {
    type: 'application/x-yaml',
  });
  downloadBlob(blob, filename || `TubeStrategist_Analysis_${dateStamp()}.yaml`);
}

// ═══════════════════════════════════════════════════════════════════════════
// CSV Export
// ═══════════════════════════════════════════════════════════════════════════
export function generateCSV(result: AnalysisResult, viewMode: string, allVideos: Video[] = []): string {
  const safe = result.playlists || [];
  const getMeta = (v: Video | undefined, keys: string[]): string | null => {
    if (!v?.customMetadata) return null;
    for (const k of keys) {
      const foundKey = Object.keys(v.customMetadata).find(key => key.toLowerCase() === k.toLowerCase());
      if (foundKey && v.customMetadata[foundKey]) return String(v.customMetadata[foundKey]);
    }
    return null;
  };

  let csvContent = '';

  if (viewMode === 'videos_only') {
    const headers = ['Type', 'Playlist Name', 'Target Playlists', 'Playlists Title', 'YouTube Title', 'Video ID', 'Video URL'];
    const rows: string[] = [];

    safe.forEach(p => {
      const type = p.currentTitle ? 'Optimized Existing' : 'New Opportunity';
      const originalInfo = p.currentTitle ? `${p.currentTitle} (${p.currentUrl || ''})` : '';
      if (!p.videos?.length) {
        rows.push(`${safeCsv(type)},${safeCsv(p.title)},${safeCsv(originalInfo)},${safeCsv('-')},"No videos", "", ""`);
      } else {
        p.videos.forEach(pv => {
          const v = allVideos.find(av => av.id === pv.id);
          rows.push([
            safeCsv(type),
            safeCsv(p.title),
            safeCsv(originalInfo),
            safeCsv(getMeta(v, ['playlists', 'playlist', 'playlists title', 'playlist_title', 'playlistname']) || '-'),
            safeCsv(pv.title),
            safeCsv(pv.videoId || v?.videoId || pv.id),
            safeCsv(v?.url || ''),
          ].join(','));
        });
      }
    });

    csvContent = '﻿' + [headers.join(','), ...rows].join('\n');
  } else if (viewMode === 'criteria_output') {
    const headers = ['Type', 'Playlist Name', 'Topic', 'Criteria', 'Goal', 'Audience', 'Include Themes', 'Exclude Themes'];
    const rows: string[] = [];

    safe.forEach(p => {
      const type = p.currentTitle ? 'Optimized Existing' : 'New Opportunity';
      rows.push([
        safeCsv(type),
        safeCsv(p.title),
        safeCsv(p.topic || ''),
        safeCsv(p.criteria || ''),
        safeCsv(p.goal || ''),
        safeCsv(p.audience || ''),
        safeCsv(p.includeThemes || ''),
        safeCsv(p.excludeThemes || ''),
      ].join(','));
    });

    csvContent = '﻿' + [headers.join(','), ...rows].join('\n');
  } else if (viewMode === 'audit') {
    const { audit } = result;
    const rows: string[][] = [
      ['Metric', 'Value'],
      ['Strategy Score', String(audit.channelScore)],
      ['Metadata Health Score', String(audit.contentHealthScore)],
      ['Audience Persona', safeCsv(audit.audiencePersona)],
      ['Primary Niche', safeCsv(audit.primaryNiche)],
      ['Metadata Analysis', safeCsv(audit.metadataAnalysis)],
      ['Strengths', safeCsv((audit.contentStrengths || []).join('; '))],
      ['Weaknesses', safeCsv((audit.contentWeaknesses || []).join('; '))],
      ['Opportunities', safeCsv((audit.missedOpportunities || []).join('; '))],
    ];

    csvContent = '﻿' + rows.map(r => r.join(',')).join('\n');
  } else {
    // Strategy / Action Plan
    const headers = ['#', 'Type', 'Playlist Title', 'Virality Score', 'Reach Prediction',
      'Description', 'Keywords', 'Tags', 'Included Videos'];
    const rows: string[] = [];

    safe.forEach((p, idx) => {
      const type = p.currentTitle ? 'Optimized Existing' : 'New Opportunity';
      const videosStr = (p.videos || []).map(pv => {
        const v = allVideos.find(av => av.id === pv.id);
        return v ? `${pv.title} (${v.url || ''})` : pv.title;
      }).join('\n');

      rows.push([
        String(idx + 1),
        safeCsv(type),
        safeCsv(p.title),
        safeCsv(String(p.viralityScore)),
        safeCsv(p.predictedReach),
        safeCsv(p.description),
        safeCsv((p.keywords || []).join(', ')),
        safeCsv((p.tags || []).join(', ')),
        safeCsv(videosStr),
      ].join(','));
    });

    csvContent = '﻿' + [headers.join(','), ...rows].join('\n');
  }

  return csvContent;
}

export function downloadCSV(result: AnalysisResult, viewMode: string, allVideos?: Video[], filename?: string) {
  const csv = generateCSV(result, viewMode, allVideos);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename || `TubeStrategist_${viewMode}_${dateStamp()}.csv`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PDF Export
// ═══════════════════════════════════════════════════════════════════════════
export function generatePDF(
  result: AnalysisResult,
  allVideos: Video[],
  viewMode: 'detailed' | 'simple' | 'videos_only' | 'audit' | 'criteria_output' = 'detailed',
  _filterConfig?: FilterConfig,
): Blob | null {
  // Branded A4 (pt units): shared page-1 header replaces the local band below.
  const reportTitles: Record<typeof viewMode, string> = {
    detailed: 'Playlist Strategy Report',
    simple: 'Playlist Action Plan',
    videos_only: 'Playlist Action List',
    audit: 'Content Audit & Health Check',
    criteria_output: 'Playlist Criteria Output',
  };
  const doc = createBrandedDoc({
    reportTitle: reportTitles[viewMode],
    reportSubtitle: `Professional YouTube Content Strategy & Optimization Report | Generated on: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`,
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40; // mirrors branded chrome (MARGIN_X)
  const contentWidth = pageWidth - marginX * 2;
  let yPos = 124; // just below the shared branded header

  const ensureSpace = (needed: number) => {
    if (yPos + needed > pageHeight - 60) {
      doc.addPage();
      yPos = marginX;
    }
  };

  // ── AUDIT VIEW ──────────────────────────────────────────────────────────
  if (viewMode === 'audit') {
    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text(`Strategy Score: ${result.audit.channelScore}/100`, marginX, yPos);
    doc.text(`Metadata Health: ${result.audit.contentHealthScore}/100`, pageWidth / 2, yPos);
    yPos += 20;

    const renderList = (title: string, items: string[], color: [number, number, number]) => {
      ensureSpace(30);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...color);
      doc.text(title, marginX, yPos);
      yPos += 8;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(0);
      (items || []).forEach(item => {
        const lines = doc.splitTextToSize(`- ${sanitizeForPdf(item)}`, contentWidth - 8);
        ensureSpace(lines.length * 6 + 2);
        doc.text(lines, marginX + 8, yPos);
        yPos += lines.length * 6;
      });
      yPos += 6;
    };

    renderList('Strengths', result.audit.contentStrengths, [34, 197, 94]);
    renderList('Weaknesses', result.audit.contentWeaknesses, [239, 68, 68]);
    renderList('Missed Opportunities', result.audit.missedOpportunities, [59, 130, 246]);

    ensureSpace(40);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(50);
    doc.text('Playlist & Metadata Quality Critique', marginX, yPos);
    yPos += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(80);
    const metaLines = doc.splitTextToSize(sanitizeForPdf(result.audit.metadataAnalysis || ''), contentWidth);
    doc.text(metaLines, marginX, yPos);

    finalizeBrandedDoc(doc);
    return doc.output('blob');
  }

  // ── CRITERIA OUTPUT VIEW ────────────────────────────────────────────────
  if (viewMode === 'criteria_output') {
    const criteriaRows = (result.playlists || []).map(p => [
      sanitizeForPdf(p.currentTitle ? 'Optimized Existing' : 'New Opportunity'),
      sanitizeForPdf(p.title),
      sanitizeForPdf(p.topic || '-'),
      sanitizeForPdf(p.criteria || '-'),
      sanitizeForPdf(p.goal || '-'),
      sanitizeForPdf(p.audience || '-'),
      sanitizeForPdf(p.includeThemes || '-'),
      sanitizeForPdf(p.excludeThemes || '-'),
    ]);

    brandedAutoTable(doc, {
      startY: yPos,
      head: [['Type', 'Playlist Name', 'Topic', 'Criteria', 'Goal', 'Audience', 'Include Themes', 'Exclude Themes']],
      body: criteriaRows,
      fontSize: 7,
    });

    finalizeBrandedDoc(doc);
    return doc.output('blob');
  }

  // ── EXECUTIVE SUMMARY (Detailed/Simple) ─────────────────────────────────
  if (result.summary && viewMode !== 'videos_only') {
    doc.setFontSize(16);
    doc.setTextColor(0);
    doc.text(viewMode === 'simple' ? 'Action Plan Summary' : 'Executive Summary', marginX, yPos);
    yPos += 10;
    doc.setFontSize(11);
    doc.setTextColor(60);
    const summaryLines = doc.splitTextToSize(sanitizeForPdf(result.summary || 'No summary available.'), contentWidth);
    doc.text(summaryLines, marginX, yPos);
    yPos += (summaryLines.length * 6) + 12;
  }

  // ── Render Playlists ────────────────────────────────────────────────────
  const renderPlaylists = (playlists: typeof result.playlists, typeLabel: string) => {
    if (!playlists?.length) return;

    ensureSpace(30);
    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.text(`--- ${typeLabel} ---`, marginX, yPos);
    yPos += 14;

    playlists.forEach((playlist, index) => {
      ensureSpace(60);

      doc.setDrawColor(200);
      doc.line(marginX, yPos, pageWidth - marginX, yPos);
      yPos += 14;

      doc.setFontSize(14);
      doc.setTextColor(0);
      doc.setFont('helvetica', 'bold');

      if (playlist.currentTitle) {
        doc.text(`Playlist ${index + 1} (Optimized)`, marginX, yPos);
        yPos += 8;
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.setFont('helvetica', 'normal');
        const origLines = doc.splitTextToSize(`Original: ${sanitizeForPdf(playlist.currentTitle)}`, contentWidth);
        doc.text(origLines, marginX, yPos);
        yPos += origLines.length * 6 + 4;
        doc.setFontSize(14);
        doc.setTextColor(0);
        doc.setFont('helvetica', 'bold');
        const titleLines = doc.splitTextToSize(`New Title: ${sanitizeForPdf(playlist.title)}`, contentWidth);
        doc.text(titleLines, marginX, yPos);
        yPos += titleLines.length * 8;
      } else {
        const titleLines = doc.splitTextToSize(`Playlist ${index + 1}: ${sanitizeForPdf(playlist.title)}`, contentWidth);
        doc.text(titleLines, marginX, yPos);
        yPos += titleLines.length * 8;
      }
      yPos += 4;

      if (viewMode !== 'videos_only') {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(220, 38, 38);
        doc.text(`Virality Score: ${playlist.viralityScore}/100`, marginX, yPos);
        doc.setTextColor(80);
        doc.text(`Predicted Reach: ${sanitizeForPdf(playlist.predictedReach)}`, marginX + 160, yPos);
        yPos += 10;

        if (viewMode === 'detailed') {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.setTextColor(50);
          doc.text('Why this playlist?', marginX, yPos);
          yPos += 6;
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(10);
          doc.setTextColor(80);
          const whyLines = doc.splitTextToSize(sanitizeForPdf(playlist.why || ''), contentWidth);
          doc.text(whyLines, marginX, yPos);
          yPos += (whyLines.length * 5) + 6;

          doc.setFont('helvetica', 'bold');
          doc.setTextColor(50);
          doc.setFontSize(10);
          doc.text('Strategy & Reasoning', marginX, yPos);
          yPos += 6;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.setTextColor(80);
          const reasoningLines = doc.splitTextToSize(sanitizeForPdf(playlist.reasoning || ''), contentWidth);
          doc.text(reasoningLines, marginX, yPos);
          yPos += (reasoningLines.length * 5) + 6;
        }

        const details = [
          ['Description', sanitizeForPdf(playlist.description)],
          ['Keywords', sanitizeForPdf((playlist.keywords || []).join(', '))],
          ['Tags', sanitizeForPdf((playlist.tags || []).join(' '))],
        ];

        yPos = brandedAutoTable(doc, { head: [], body: details, startY: yPos }) + 6;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(0);
      ensureSpace(20);
      doc.text('Included Videos:', marginX, yPos);
      yPos += 6;

      const videoRows = (playlist.videos || []).map(pv => {
        const video = allVideos.find(v => v.id === pv.id);
        const displayId = video?.videoId || pv.id;
        if (viewMode === 'videos_only') {
          return [sanitizeForPdf(pv.title), sanitizeForPdf(displayId), sanitizeForPdf(video?.url || '')];
        }
        return [sanitizeForPdf(pv.title), sanitizeForPdf(video?.url || '')];
      });

      const headers = viewMode === 'videos_only' ? [['Title', 'ID', 'URL']] : [['Title', 'URL']];
      yPos = brandedAutoTable(doc, { head: headers, body: videoRows, startY: yPos }) + 18;
    });
  };

  const safePlaylists = result.playlists || [];
  const optimized = safePlaylists.filter(p => p.currentTitle);
  const newOps = safePlaylists.filter(p => !p.currentTitle);

  if (optimized.length > 0) renderPlaylists(optimized, 'Optimized Existing Playlists');
  if (newOps.length > 0) renderPlaylists(newOps, 'New Strategic Opportunities');
  if (optimized.length === 0 && newOps.length === 0) {
    renderPlaylists(safePlaylists, 'Strategic Playlists');
  }

  finalizeBrandedDoc(doc);
  return doc.output('blob');
}

export function downloadPDF(
  result: AnalysisResult,
  viewMode: 'detailed' | 'simple' | 'videos_only' | 'audit' | 'criteria_output' = 'detailed',
  allVideos?: Video[],
  filterConfig?: FilterConfig,
  filename?: string,
) {
  const blob = generatePDF(result, allVideos || [], viewMode, filterConfig);
  if (blob) {
    downloadBlob(blob, filename || pdfFileName(`TubeStrategist_${viewMode}`));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ZIP Export
// ═══════════════════════════════════════════════════════════════════════════
export async function downloadMasterZip(
  result: AnalysisResult,
  allVideos: Video[],
  filterConfig?: FilterConfig,
  filename?: string,
) {
  try {
    // Dynamic import so jszip is only loaded when needed
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    const modes: Array<{ key: string; folder: string }> = [
      { key: 'audit', folder: '2_Playlists_Audit' },
      { key: 'detailed', folder: '3_Playlists_Strategy' },
      { key: 'simple', folder: '4_Playlists_Action_Plan' },
      { key: 'videos_only', folder: '5_Playlists_Action_List' },
      { key: 'criteria_output', folder: '6_Playlist_Criteria_Output' },
    ];

    for (const mode of modes) {
      const folder = zip.folder(mode.folder);
      if (!folder) continue;

      // JSON
      const jsonName = `Playlist_${mode.key.charAt(0).toUpperCase() + mode.key.slice(1)}.json`;
      folder.file(jsonName, JSON.stringify(result, null, 2));

      // CSV
      const csv = generateCSV(result, mode.key, allVideos);
      const csvName = `Playlist_${mode.key.charAt(0).toUpperCase() + mode.key.slice(1)}.csv`;
      folder.file(csvName, csv);

      // PDF
      try {
        const pdfMode = mode.key as 'audit' | 'detailed' | 'simple' | 'videos_only' | 'criteria_output';
        const pdf = generatePDF(result, allVideos, pdfMode, filterConfig);
        if (pdf) {
          const pdfName = `Playlist_${mode.key.charAt(0).toUpperCase() + mode.key.slice(1)}.pdf`;
          folder.file(pdfName, pdf);
        }
      } catch (err) {
        console.warn(`[PlaylistOptimizerExport] PDF generation failed for ${mode.key}:`, err);
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
    downloadBlob(content, filename || `TubeStrategist_Master_${dateStamp()}.zip`);
  } catch (err) {
    console.error('[PlaylistOptimizerExport] ZIP generation failed:', err);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Single Playlist Export (per-accordion download menu)
// ═══════════════════════════════════════════════════════════════════════════
function singlePlaylistResult(
  result: AnalysisResult,
  playlist: PlaylistRecommendation,
): AnalysisResult {
  return {
    ...result,
    playlists: [playlist],
    unassignedVideos: [],
    summary: `Playlist: ${playlist.title}`,
  };
}

export function downloadSingleCSV(
  result: AnalysisResult,
  playlist: PlaylistRecommendation,
  viewMode: string,
  allVideos: Video[] = [],
  filename?: string,
) {
  const single = singlePlaylistResult(result, playlist);
  downloadCSV(
    single,
    viewMode,
    allVideos,
    filename || `TubeStrategist_Playlist_${dateStamp()}.csv`,
  );
}

export function downloadSinglePDF(
  result: AnalysisResult,
  playlist: PlaylistRecommendation,
  viewMode: 'detailed' | 'simple' | 'videos_only' | 'audit' | 'criteria_output' = 'detailed',
  allVideos?: Video[],
  filterConfig?: FilterConfig,
  filename?: string,
) {
  const single = singlePlaylistResult(result, playlist);
  downloadPDF(
    single,
    viewMode,
    allVideos,
    filterConfig,
    filename || pdfFileName('TubeStrategist_Playlist'),
  );
}

export function downloadSingleExcel(
  playlist: PlaylistRecommendation,
  allVideos: Video[] = [],
  score?: number,
) {
  const wb = XLSX.utils.book_new();
  const type = playlist.currentTitle ? 'Optimized Existing' : 'New Opportunity';

  // Sheet 1: Playlist overview -- one row per metadata field
  const overviewRows: Record<string, string | number>[] = [
    { Field: 'Type', Value: type },
    { Field: 'Playlist Title', Value: playlist.title },
    { Field: 'Original Title', Value: playlist.currentTitle || '' },
    { Field: 'Original URL', Value: playlist.currentUrl || '' },
    { Field: 'Virality Score', Value: score ?? playlist.viralityScore },
    { Field: 'Predicted Reach', Value: playlist.predictedReach },
    { Field: 'Topic', Value: playlist.topic || '' },
    { Field: 'Criteria', Value: playlist.criteria || '' },
    { Field: 'Goal', Value: playlist.goal || '' },
    { Field: 'Audience', Value: playlist.audience || '' },
    { Field: 'Include Themes', Value: playlist.includeThemes || '' },
    { Field: 'Exclude Themes', Value: playlist.excludeThemes || '' },
    { Field: 'Description', Value: playlist.description || '' },
    { Field: 'Keywords', Value: (playlist.keywords || []).join(', ') },
    { Field: 'Tags', Value: (playlist.tags || []).join(', ') },
    { Field: 'Why', Value: playlist.why || '' },
    { Field: 'Reasoning', Value: playlist.reasoning || '' },
    { Field: 'Engagement Prediction', Value: playlist.engagementPrediction || '' },
  ];
  const overviewSheet = XLSX.utils.json_to_sheet(overviewRows);
  overviewSheet['!cols'] = [{ wch: 24 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, overviewSheet, 'Playlist');

  // Sheet 2: Videos -- one row per included video
  const videoRows = (playlist.videos || []).map((pv, i) => {
    const v = allVideos.find((av) => av.id === pv.id);
    return {
      '#': i + 1,
      'Title': pv.title,
      'Video ID': pv.videoId || v?.videoId || pv.id,
      'URL': v?.url || '',
    };
  });
  if (videoRows.length > 0) {
    const videoSheet = XLSX.utils.json_to_sheet(videoRows);
    videoSheet['!cols'] = [{ wch: 4 }, { wch: 60 }, { wch: 14 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, videoSheet, 'Videos');
  }

  const safeTitle = (playlist.title || 'playlist')
    .replace(/[^a-z0-9]+/gi, '_')
    .substring(0, 30);
  XLSX.writeFile(wb, `TubeStrategist_Playlist_${safeTitle}_${dateStamp()}.xlsx`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateStamp(): string {
  return new Date().toISOString().split('T')[0];
}
