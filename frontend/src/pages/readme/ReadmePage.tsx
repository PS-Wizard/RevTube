import { useEffect, useState, useCallback } from 'react';
import { BookOpen, RefreshCw, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getFirebaseAuthHeader } from '../../services/authHeaders';
import { getResolvedApiBaseUrl } from '../../utils/apiBase';
import { Alert, AlertDescription, Box, Button, Flex, IconMedallion, Spinner, Stack, Typography } from '../../components/ui';

export function ReadmePage() {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReadme = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const baseUrl = getResolvedApiBaseUrl();
      const authHeader = await getFirebaseAuthHeader();

      const response = await fetch(`${baseUrl}/readme`, { headers: { ...authHeader } });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Failed with status ${response.status}`);
      }

      const data = await response.json();
      setContent(data.content || '');
    } catch (err: unknown) {
      console.error('[ReadmePage] Error loading README.md:', err);
      setError(err instanceof Error ? err.message : 'An error occurred while loading the documentation.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchReadme(); }, [fetchReadme]);

  return (
    <Stack style={{ height: 'calc(100vh - var(--sticky-top-height, 64px))' }}>
      {/* Header */}
      <Flex
        justifyContent="space-between"
        alignItems="center"
        style={{ flexShrink: 0, borderBottom: '1px solid var(--border)', backgroundColor: 'var(--card)', padding: '16px 32px' }}
      >
        <Flex alignItems="center" gap={1.5}>
          <IconMedallion tone="primary" shape="rounded" size={36}>
            <BookOpen size={18} strokeWidth={1.75} />
          </IconMedallion>
          <Stack gap={0}>
            <Typography component="h1" variant="h6" style={{ fontWeight: 700, lineHeight: 1.25 }}>Project Documentation</Typography>
            <Typography variant="caption" style={{ marginTop: 2 }}>README.md — live from the project root</Typography>
          </Stack>
        </Flex>
        <Button
          variant="secondary"
          size="sm"
          onClick={fetchReadme}
          disabled={loading}
          title="Refresh documentation"
        >
          {loading ? <Spinner size={14} /> : <RefreshCw size={14} />}
          Refresh
        </Button>
      </Flex>

      {/* Error banner */}
      {error && (
        <Box sx={{ mx: 4, mt: 2, flexShrink: 0 }}>
          <Alert severity="error" title="Connection Error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </Box>
      )}

      {/* Content area */}
      {loading ? (
        <Stack sx={{ flex: 1 }} alignItems="center" justifyContent="center" gap={1.5}>
          <Spinner size={28} />
          <Typography variant="body2">Loading documentation…</Typography>
        </Stack>
      ) : !content ? (
        <Stack sx={{ flex: 1 }} alignItems="center" justifyContent="center" gap={1.5}>
          <FileText size={40} strokeWidth={1.25} style={{ color: 'var(--muted-foreground)' }} />
          <Typography variant="body2" style={{ margin: 0 }}>No content found.</Typography>
        </Stack>
      ) : (
        <article className="readme-prose" style={{ marginInline: 'auto', width: '100%', maxWidth: 'var(--rt-shell-content-max-width)', flex: 1, overflowY: 'auto', padding: '24px 32px', fontSize: 16, lineHeight: 1.625, color: 'var(--foreground)' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </article>
      )}
    </Stack>
  );
}

export default ReadmePage;
