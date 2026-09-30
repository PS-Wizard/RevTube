import { useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Button } from '../ui/button';
import { Box, Flex } from '../ui';
import { downloadTablesWorkbook, extractMarkdownTables } from './chatWorkbook';

/**
 * Message-level export: when one assistant response holds 2+ markdown
 * tables, offer a single "all tables, one workbook" .xlsx download (one
 * sheet per table, named from the nearest heading). Single tables keep
 * their per-table Download dropdown in ChatTable -- this renders nothing
 * for <2 tables.
 */
export function ChatWorkbookExport({ content }: { content: string }) {
  const tables = useMemo(() => extractMarkdownTables(content), [content]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (tables.length < 2) return null;

  const runExport = async () => {
    setError(null);
    setBusy(true);
    try {
      await downloadTablesWorkbook(tables);
    } catch (err) {
      console.error('[ChatWorkbookExport] export failed:', err);
      setError('Export failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flex gap={1} sx={{ justifyContent: 'flex-end', alignItems: 'center', mt: 1.5 }}>
      {error && (
        <Box component="span" role="alert" sx={{ fontSize: 12, color: 'var(--destructive)' }}>
          {error}
        </Box>
      )}
      <Button variant="secondary" size="sm" onClick={() => void runExport()} disabled={busy} title="Download all tables as one Excel workbook">
        <FileSpreadsheet size={13} aria-hidden />
        <span>{busy ? 'Exporting…' : `Download all ${tables.length} tables (.xlsx)`}</span>
      </Button>
    </Flex>
  );
}
