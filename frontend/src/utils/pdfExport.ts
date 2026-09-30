import type { VideoMetadata } from '../types/youtube';
import type jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CellHookData } from 'jspdf-autotable';
import {
  createBrandedDoc,
  finalizeBrandedDoc,
} from '@/services/pdf/brandedPdf';
import { TUBEKETER_DOMAIN_DISPLAY, TUBEKETER_SITE_URL } from '../constants/productUrls';
import dayjs from 'dayjs';

interface ComparisonMetrics {
  channelName: string;
  profilePicture?: string;
  bannerUrl?: string;
  subscriberCount?: number;
  totalVideos: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  avgViewsPerVideo: number;
  avgLikesPerVideo: number;
  avgCommentsPerVideo: number;
  avgLikesPerView: number;
  topVideos: VideoMetadata[];
  lifetimeVideoCount?: number;
  lifetimeViewCount?: number;
}

// Helper to convert image URL to base64 for jsPDF using backend proxy to bypass CORS
async function getBase64Image(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    // If the URL is a local asset (root-relative) fetch directly from the origin
    let fetchUrl = url;
    if (typeof window !== 'undefined' && url.startsWith('/')) {
      fetchUrl = window.location.origin + url;
    }

    // If the URL appears remote and we're running in-browser use a small proxy to avoid CORS
    const useProxy = !fetchUrl.startsWith(window?.location?.origin || '');
    const res = await fetch(useProxy ? `/api/proxy-image?url=${encodeURIComponent(url)}` : fetchUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('Failed to load image for PDF:', url, e);
    return null;
  }
}

// Helper to truncate text to fit a max width
function truncateText(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && doc.getTextWidth(truncated + '...') > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '...';
}

// Placeholder for circular avatar when load fails
function drawAvatarPlaceholder(doc: jsPDF, name: string, x: number, y: number, size: number) {
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.circle(x + size / 2, y + size / 2, size / 2, 'DF');
  doc.setFontSize(size * 0.4);
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'bold');
  const initial = name ? name.charAt(0).toUpperCase() : '?';
  doc.text(initial, x + size / 2, y + size / 2 + (size * 0.14), { align: 'center' });
}

// Placeholder for video thumbnail
function drawThumbnailPlaceholder(doc: jsPDF, x: number, y: number, width: number, height: number) {
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.rect(x, y, width, height, 'DF');
  
  // Play icon triangle
  doc.setFillColor(148, 163, 184);
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const size = height * 0.18;
  doc.triangle(
    centerX - size * 0.6, centerY - size,
    centerX - size * 0.6, centerY + size,
    centerX + size, centerY,
    'F'
  );
}

export async function generateComparisonPDF(
  results: ComparisonMetrics[],
  timePeriod: string
): Promise<void> {
  const formattedPeriod = timePeriod === 'lifetime'
    ? 'All-Time Lifetime Stats'
    : /^\d+$/.test(timePeriod)
      ? `Performance over last ${timePeriod} days`
      : `Period: ${timePeriod}`;
  // Shared branded chrome (A4, pt units) replaces the local header band below.
  const doc = createBrandedDoc({
    reportTitle: 'Channel Comparison Report',
    reportSubtitle: `${formattedPeriod}   |   Generated via ${TUBEKETER_DOMAIN_DISPLAY} on ${dayjs().format('MMMM D, YYYY HH:mm')}`,
  });
  const pageWidth  = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  // Matches the branded table gutters (MARGIN_X) so cards align with tables.
  const margins = 40;

  // Colors
  const darkBg      = [15,  23,  42]  as [number, number, number]; // #0F172A
  const redAccent   = [239, 68,  68]  as [number, number, number]; // #EF4444
  const borderGray  = [226, 232, 240] as [number, number, number]; // #E2E8F0
  const successText = [5,   150, 105] as [number, number, number]; // #059669
  const successBg   = [236, 253, 245] as [number, number, number]; // #ECFDF5
  const textMuted   = [100, 116, 139] as [number, number, number]; // #64748B
  const textDark    = [30,  41,  59]  as [number, number, number]; // #1E293B

  // Helper for Winner Highlighting (Best performer per KPI row)
  const getWinnerIndices = (values: number[], isLowerBetter = false) => {
    if (values.length < 2) return [];
    const validValues = values.filter(v => v !== undefined && !isNaN(v));
    if (validValues.length === 0) return [];
    const best = isLowerBetter ? Math.min(...validValues) : Math.max(...validValues);
    if (best === 0 && !isLowerBetter) return [];
    return values.map((v, idx) => (v === best ? idx + 1 : -1)).filter(idx => idx !== -1);
  };

  // ── CHANNEL BRANDING CARDS ────────────────────────────────────────────────
  // (Shared branded header above replaces the old local header band.)
  let yPos = 124; // just below the shared branded header
  const cardGap = 8;
  const availableWidth = pageWidth - margins * 2;
  const cardWidth = (availableWidth - (results.length - 1) * cardGap) / results.length;
  const bannerHeight = 24;
  const pfpSize = 18;

  for (let i = 0; i < results.length; i++) {
    const channel = results[i];
    const x = margins + i * (cardWidth + cardGap);

    // Card frame
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...borderGray);
    doc.setLineWidth(0.5);
    doc.rect(x, yPos, cardWidth, 54, 'DF');

    // Banner Image / Placeholder
    let bannerLoaded = false;
    if (channel.bannerUrl) {
      const bannerBase64 = await getBase64Image(channel.bannerUrl);
      if (bannerBase64) {
        doc.addImage(bannerBase64, 'JPEG', x + 0.25, yPos + 0.25, cardWidth - 0.5, bannerHeight, undefined, 'FAST');
        bannerLoaded = true;
      }
    }
    if (!bannerLoaded) {
      doc.setFillColor(248, 250, 252);
      doc.rect(x + 0.25, yPos + 0.25, cardWidth - 0.5, bannerHeight, 'F');
      // Accent subtle banner design line
      doc.setFillColor(...redAccent);
      doc.rect(x + 0.25, yPos + 0.25, cardWidth - 0.5, 2, 'F');
    }

    // Avatar PFP Image / Placeholder
    const avatarX = x + cardWidth / 2 - pfpSize / 2;
    const avatarY = yPos + bannerHeight - pfpSize / 2;

    let pfpLoaded = false;
    if (channel.profilePicture) {
      const pfpBase64 = await getBase64Image(channel.profilePicture);
      if (pfpBase64) {
        doc.setDrawColor(255, 255, 255);
        doc.setLineWidth(1.5);
        doc.circle(avatarX + pfpSize / 2, avatarY + pfpSize / 2, pfpSize / 2 + 0.75, 'D');
        doc.addImage(pfpBase64, 'JPEG', avatarX, avatarY, pfpSize, pfpSize, undefined, 'FAST');
        pfpLoaded = true;
      }
    }
    if (!pfpLoaded) {
      doc.setDrawColor(255, 255, 255);
      doc.setLineWidth(1.5);
      doc.circle(avatarX + pfpSize / 2, avatarY + pfpSize / 2, pfpSize / 2 + 0.75, 'D');
      drawAvatarPlaceholder(doc, channel.channelName, avatarX, avatarY, pfpSize);
    }

    // Channel metadata
    doc.setFontSize(10.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...textDark);
    const displayName = truncateText(doc, channel.channelName, cardWidth - 10);
    doc.text(displayName, x + cardWidth / 2, yPos + bannerHeight + pfpSize / 2 + 8, { align: 'center' });

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...textMuted);
    const subText = channel.subscriberCount !== undefined
      ? `${channel.subscriberCount.toLocaleString()} subscribers`
      : 'Subscribers hidden';
    doc.text(subText, x + cardWidth / 2, yPos + bannerHeight + pfpSize / 2 + 13, { align: 'center' });
  }

  yPos += 64;

  // ── KPI COMPARISON TABLE ──────────────────────────────────────────────────
  const tableHeaders = ['Metric', ...results.map(r => r.channelName)];

  interface ReportSection {
    title: string;
    rows: {
      label: string;
      values: number[];
      display: string[];
      isLowerBetter?: boolean;
    }[];
  }

  const kpiSections: ReportSection[] = [
    {
      title: 'OVERVIEW',
      rows: [
        {
          label: 'Subscribers',
          values: results.map(r => r.subscriberCount || 0),
          display: results.map(r => r.subscriberCount !== undefined ? r.subscriberCount.toLocaleString() : 'N/A')
        },
        {
          label: 'Total videos',
          values: results.map(r => r.lifetimeVideoCount ?? r.totalVideos),
          display: results.map(r => (r.lifetimeVideoCount ?? r.totalVideos).toLocaleString())
        }
      ]
    },
    {
      title: 'PERFORMANCE',
      rows: [
        {
          label: 'Total views',
          values: results.map(r => r.totalViews),
          display: results.map(r => r.totalViews.toLocaleString())
        },
        {
          label: 'Total likes',
          values: results.map(r => r.totalLikes),
          display: results.map(r => r.totalLikes.toLocaleString())
        },
        {
          label: 'Total comments',
          values: results.map(r => r.totalComments),
          display: results.map(r => r.totalComments.toLocaleString())
        }
      ]
    },
    {
      title: 'AVERAGES & ENGAGEMENT',
      rows: [
        {
          label: 'Avg views / video',
          values: results.map(r => r.avgViewsPerVideo),
          display: results.map(r => Math.round(r.avgViewsPerVideo).toLocaleString())
        },
        {
          label: 'Avg likes / video',
          values: results.map(r => r.avgLikesPerVideo),
          display: results.map(r => Math.round(r.avgLikesPerVideo).toLocaleString())
        },
        {
          label: 'Engagement rate',
          values: results.map(r => r.avgLikesPerView),
          display: results.map(r => `${r.avgLikesPerView.toFixed(2)}%`)
        }
      ]
    }
  ];

  // Compile full table list with custom section header rows
  const tableBody: any[] = [];
  const rowMeta: { isHeader: boolean; winnerIndices?: number[] }[] = [];

  for (const sect of kpiSections) {
    // Add section header row
    tableBody.push([sect.title]);
    rowMeta.push({ isHeader: true });

    for (const r of sect.rows) {
      tableBody.push([r.label, ...r.display]);
      rowMeta.push({
        isHeader: false,
        winnerIndices: getWinnerIndices(r.values, r.isLowerBetter)
      });
    }
  }

  // Draw Comparison Table
  autoTable(doc, {
    startY: yPos,
    head: [tableHeaders],
    body: tableBody,
    theme: 'plain',
    headStyles: {
      fillColor: darkBg,
      textColor: [255, 255, 255],
      fontSize: 8.5,
      fontStyle: 'bold',
      halign: 'center'
    },
    columnStyles: {
      0: { fontStyle: 'normal', textColor: textDark, halign: 'left', cellWidth: 54 }
    },
    bodyStyles: {
      fontSize: 8,
      cellPadding: 4.5,
      textColor: textDark,
      lineColor: borderGray,
      lineWidth: 0.25
    },
    didParseCell: (data: CellHookData) => {
      // Style Metric Column
      if (data.column.index === 0) {
        data.cell.styles.fillColor = [250, 251, 252];
      } else {
        data.cell.styles.halign = 'center';
      }

      const meta = rowMeta[data.row.index];
      if (meta) {
        if (meta.isHeader) {
          // Style Section Header row
          data.cell.styles.fillColor = [241, 245, 249];
          data.cell.styles.textColor = textMuted;
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fontSize = 7.5;
          if (data.column.index === 0) {
            data.cell.styles.halign = 'left';
          }
        } else if (data.column.index > 0 && meta.winnerIndices?.includes(data.column.index)) {
          // Highlight best performing KPI cell
          data.cell.styles.fillColor = successBg;
          data.cell.styles.textColor = successText;
          data.cell.styles.fontStyle = 'bold';
        }
      }
    }
  });

  yPos = (doc as any).lastAutoTable.finalY + 14;

  // ── TOP VIDEOS ────────────────────────────────────────────────────────────
  doc.addPage();
  yPos = margins;

  // Section Heading
  doc.setFillColor(...redAccent);
  doc.rect(margins, yPos - 3, 3, 10, 'F');
  doc.setFontSize(13);
  doc.setTextColor(...darkBg);
  doc.setFont('helvetica', 'bold');
  doc.text('Top Performing Uploads', margins + 6, yPos + 4);
  yPos += 14;

  const colWidth = (availableWidth - (results.length - 1) * cardGap) / results.length;
  const thumbW = 20;
  const thumbH = 11.25; // 16:9 ratio
  const rowHeight = 15;
  const textXOffset = thumbW + 3;

  // List top 5 videos for each channel
  let maxVidY = yPos;
  for (let i = 0; i < results.length; i++) {
    const channel = results[i];
    const colX = margins + i * (colWidth + cardGap);
    let vidY = yPos;

    // Channel Column Header
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(...borderGray);
    doc.setLineWidth(0.5);
    doc.rect(colX, vidY, colWidth, 9, 'DF');

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...textDark);
    doc.text(truncateText(doc, channel.channelName, colWidth - 6), colX + 4, vidY + 6);
    vidY += 13;

    const topVideos = channel.topVideos.slice(0, 5);
    if (topVideos.length === 0) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(...textMuted);
      doc.text('No video statistics found.', colX, vidY);
    }

    for (let vIdx = 0; vIdx < topVideos.length; vIdx++) {
      const video = topVideos[vIdx];

      // Draw subtle top border between rows
      if (vIdx > 0) {
        doc.setDrawColor(...borderGray);
        doc.setLineWidth(0.25);
        doc.line(colX, vidY - 2, colX + colWidth, vidY - 2);
      }

      // Thumbnail
      let thumbLoaded = false;
      if (video.thumbnailUrl) {
        const thumbBase64 = await getBase64Image(video.thumbnailUrl);
        if (thumbBase64) {
          doc.addImage(thumbBase64, 'JPEG', colX, vidY, thumbW, thumbH, undefined, 'FAST');
          thumbLoaded = true;
        }
      }
      if (!thumbLoaded) {
        drawThumbnailPlaceholder(doc, colX, vidY, thumbW, thumbH);
      }

      // Title (truncate to fit text columns)
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...textDark);
      
      const maxTextW = colWidth - textXOffset - 2;
      const displayTitle = truncateText(doc, video.title || 'Untitled Video', maxTextW);
      
      const titleY = vidY + 3;
      doc.text(displayTitle, colX + textXOffset, titleY);

      // Make title a clickable link to YouTube
      if (video.videoId) {
        doc.link(colX + textXOffset, vidY, maxTextW, 6, { url: `https://youtube.com/watch?v=${video.videoId}` });
      }

      // Metrics
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...textMuted);

      const pubDate = video.publishedAt ? dayjs(video.publishedAt).format('MMM D, YYYY') : '';
      const views = (video.viewCount || 0).toLocaleString();
      const likes = video.likeCount ? video.likeCount.toLocaleString() : '0';
      const statsText = `${pubDate ? pubDate + '  •  ' : ''}${views} views  •  ${likes} likes`;
      doc.text(truncateText(doc, statsText, maxTextW), colX + textXOffset, vidY + 8);

      vidY += rowHeight;
    }

    if (vidY > maxVidY) {
      maxVidY = vidY;
    }
  }

  yPos = maxVidY + 12;

  // ── CALL TO ACTION BANNER ────────────────────────────────────────────────
  if (yPos > pageHeight - 60) {
    doc.addPage();
    yPos = margins;
  }

  // Draw a beautiful CTA card background
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(...borderGray);
  doc.setLineWidth(0.5);
  doc.rect(margins, yPos, availableWidth, 22, 'DF');

  // Red accent left band
  doc.setFillColor(...redAccent);
  doc.rect(margins, yPos, 4, 22, 'F');

  // CTA Invitation text
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...textDark);
  doc.text('Want to compare more channels and track performance in real-time?', margins + 8, yPos + 7);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...textMuted);
  const mainLabel = 'Analyze custom date ranges, export charts, and boost your views on ';
  doc.text(mainLabel, margins + 8, yPos + 14);

  // Link text in blue
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(37, 99, 235);
  const linkText = 'TubeKeter AI Analytics';
  const labelTextWidth = doc.getTextWidth(mainLabel);
  doc.text(linkText, margins + 8 + labelTextWidth, yPos + 14);

  // Hyperlink overlay to make the TubeKeter name clickable
  doc.link(margins + 8 + labelTextWidth, yPos + 10, doc.getTextWidth(linkText), 5, { url: TUBEKETER_SITE_URL });

  // ── SHARED BRANDED FOOTER (site URL + page numbers on every page) ─────────
  finalizeBrandedDoc(doc);

  // Save Report file
  const sanitizedChannels = results.map(r => r.channelName.replace(/[^a-z0-9]/gi, '-')).join('-vs-');
  const filename = `compare-report-${sanitizedChannels}-${dayjs().format('YYYY-MM-DD')}.pdf`;
  doc.save(filename);
}
