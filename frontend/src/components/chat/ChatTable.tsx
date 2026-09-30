import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Image as ImageIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Box, Flex, Typography } from '../ui';

interface ExtractedTable {
  headers: string[];
  rows: string[][];
}

const cellText = (cell: Element): string => (cell.textContent ?? '').trim();

/** Read headers + body rows back out of the rendered markdown `<table>`. */
function extractTable(table: HTMLTableElement | null): ExtractedTable | null {
  if (!table) return null;
  let headers = Array.from(table.querySelectorAll('thead th')).map(cellText);
  let bodyRows = Array.from(table.querySelectorAll('tbody tr'));
  // No thead (plain table): promote the first row to headers.
  if (headers.length === 0) {
    const allRows = Array.from(table.querySelectorAll('tr'));
    if (allRows.length === 0) return null;
    headers = Array.from(allRows[0].querySelectorAll('th, td')).map(cellText);
    bodyRows = allRows.slice(1);
  }
  const rows = bodyRows.map((tr) =>
    Array.from(tr.querySelectorAll('th, td')).map(cellText),
  );
  if (headers.length === 0 && rows.length === 0) return null;
  const width = Math.max(headers.length, ...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(Math.max(width - r.length, 0)).fill('')];
  return { headers: pad(headers), rows: rows.map(pad) };
}

const timestamp = (): string => {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const escapeCsv = (val: string): string => {
  const s = String(val ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function downloadCsv(table: ExtractedTable) {
  const lines = [
    table.headers.map(escapeCsv).join(','),
    ...table.rows.map((row) => row.map(escapeCsv).join(',')),
  ];
  downloadBlob(
    new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' }),
    `chat-table_${timestamp()}.csv`,
  );
}

async function downloadExcel(table: ExtractedTable) {
  // Same loader as the workbook export: xlsx.mjs has no default export,
  // so `const { default: XLSX } = await import('xlsx')` resolves undefined.
  const { loadXlsx } = await import('./chatWorkbook');
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet([table.headers, ...table.rows]);
  // Size columns to content (capped so one long cell doesn't blow out the sheet).
  ws['!cols'] = table.headers.map((_, col) => ({
    wch: Math.min(
      Math.max(
        table.headers[col]?.length ?? 0,
        ...table.rows.map((row) => row[col]?.length ?? 0),
      ) + 2,
      48,
    ),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Chat table');
  XLSX.writeFile(wb, `chat-table_${timestamp()}.xlsx`);
}

async function downloadPdf(snapshotEl: HTMLElement | null) {
  if (!snapshotEl) throw new Error('Table element not found.');
  // Snapshot the rendered table (toolbar excluded): the browser rasterizes it,
  // so emojis print exactly as seen on screen -- and no text is selectable.
  const { exportElementToPdf, pdfFileName } = await import('@/services/pdf/brandedPdf');
  await exportElementToPdf(snapshotEl, {
    filename: pdfFileName('chat-table-image'),
    reportTitle: 'Chat table export',
  });
}

/** YouTube video ID cells become clickable watch links in the text PDF. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const videoUrlFor = (cell: string): string | null => {
  const text = cell.trim();
  if (VIDEO_ID_RE.test(text)) return `https://www.youtube.com/watch?v=${text}`;
  if (/^https?:\/\/\S+$/i.test(text)) return text;
  return null;
};

const LINK_BLUE: [number, number, number] = [37, 99, 235];

/**
 * Selectable-text PDF: emojis are transliterated (jsPDF font limit), but text
 * stays copyable and video IDs / URLs are clickable links.
 */
async function downloadTextPdf(table: ExtractedTable) {
  const {
    brandedAutoTable,
    createBrandedDoc,
    finalizeBrandedDoc,
    pdfFileName,
    sanitizeForPdf,
  } = await import('@/services/pdf/brandedPdf');
  const doc = createBrandedDoc({ reportTitle: 'Chat table export' });
  const head = [table.headers.map(sanitizeForPdf)];
  const body = table.rows.map((row) => row.map(sanitizeForPdf));
  brandedAutoTable(doc, {
    head,
    body,
    cellHooks: {
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        if (videoUrlFor(data.cell.text.join(' ').trim())) {
          data.cell.styles.textColor = LINK_BLUE;
        }
      },
      didDrawCell: (data) => {
        if (data.section !== 'body') return;
        const url = videoUrlFor(data.cell.text.join(' ').trim());
        if (url) doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
      },
    },
  });
  finalizeBrandedDoc(doc);
  doc.save(pdfFileName('chat-table'));
}

type ExportKind = 'csv' | 'xlsx' | 'pdf-text' | 'pdf-image';

/**
 * Wraps markdown-rendered `<table>` output with a Download dropdown
 * (CSV / Excel / PDF). Data is read back from the rendered DOM so any
 * GFM table the assistant generates is exportable with no backend changes.
 */
export function ChatTable({ children }: { children?: React.ReactNode }) {
  const tableRef = useRef<HTMLTableElement>(null);
  const snapshotRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open ]);

  const runExport = async (kind: ExportKind) => {
    setOpen(false);
    setError(null);
    // Image PDF snapshots the rendered table (real emojis, non-copyable).
    if (kind === 'pdf-image') {
      if (!snapshotRef.current) {
        setError('Nothing to export in this table.');
        return;
      }
      setBusy(kind);
      try {
        await downloadPdf(snapshotRef.current);
      } catch (err) {
        console.error('[ChatTable] export failed:', err);
        setError('Export failed. Please try again.');
      } finally {
        setBusy(null);
      }
      return;
    }
    const table = extractTable(tableRef.current);
    if (!table || (table.headers.every((h) => !h) && table.rows.length === 0)) {
      setError('Nothing to export in this table.');
      return;
    }
    setBusy(kind);
    try {
      if (kind === 'csv') downloadCsv(table);
      else if (kind === 'xlsx') await downloadExcel(table);
      else await downloadTextPdf(table);
    } catch (err) {
      console.error('[ChatTable] export failed:', err);
      setError('Export failed. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box sx={{ my: 1.5 }}>
      <Flex justifyContent="flex-end" alignItems="center" gap={1} sx={{ mb: 1 }}>
        {error && (
          <Typography variant="caption" role="alert" style={{ color: 'var(--destructive)' }}>
            {error}
          </Typography>
        )}
        <div className="rt-dropdown-anchor" ref={menuRef}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            disabled={busy !== null}
            aria-haspopup="menu"
            aria-expanded={open}
            title="Download table"
          >
            <Download size={13} aria-hidden />
            <span>{busy ? 'Exporting…' : 'Download'}</span>
          </Button>
          {open && (
            <div className="rt-dropdown-panel rt-dropdown-panel--action" role="menu">
              <button
                type="button"
                className="rt-dropdown-item"
                role="menuitem"
                onClick={() => void runExport('csv')}
              >
                <FileText size={14} aria-hidden style={{ color: 'var(--rt-color-text-secondary)', flexShrink: 0 }} />
                <span>CSV (.csv)</span>
              </button>
              <button
                type="button"
                className="rt-dropdown-item"
                role="menuitem"
                onClick={() => void runExport('xlsx')}
              >
                <FileSpreadsheet size={14} aria-hidden style={{ color: 'var(--rt-color-text-secondary)', flexShrink: 0 }} />
                <span>Excel (.xlsx)</span>
              </button>
              <button
                type="button"
                className="rt-dropdown-item"
                role="menuitem"
                onClick={() => void runExport('pdf-text')}
              >
                <FileText size={14} aria-hidden style={{ color: 'var(--rt-color-text-secondary)', flexShrink: 0 }} />
                <span>PDF – selectable text</span>
              </button>
              <button
                type="button"
                className="rt-dropdown-item"
                role="menuitem"
                onClick={() => void runExport('pdf-image')}
              >
                <ImageIcon size={14} aria-hidden style={{ color: 'var(--rt-color-text-secondary)', flexShrink: 0 }} />
                <span>PDF – image (non-copyable)</span>
              </button>
            </div>
          )}
        </div>
      </Flex>
      <Box style={{ overflowX: 'auto' }} ref={snapshotRef}>
        <table ref={tableRef} style={{ margin: 0 }}>{children}</table>
      </Box>
    </Box>
  );
}
