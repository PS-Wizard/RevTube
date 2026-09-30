// ─────────────────────────────────────────────────────────────────────────────
// AdminThumbnailOptimizer -- Admin-only thumbnail optimizer for manual URL entry
// Reuses AuditInputForm (in manual mode) + shared deep-dive (pie+context+verdict)
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from 'react';
import { Box, Container, Accordion, AccordionSummary, AccordionDetails, Menu, IconButton, Spinner, ListItemIcon, ListItemText } from '../../components/ui';
import { MenuItem } from '../../components/ui/Menu';
import { Download, Scan, Image, ChevronRight, FileText, FileSpreadsheet, Table2 } from 'lucide-react';
import { useThumbnailAudit } from '../../hooks/queries/useThumbnailAudit';
import { AuditInputForm } from './AuditInputForm';
import { AuditTable } from './AuditTable';
import { AuditReportHeader } from './AuditReportHeader';
import { ThumbnailDeepDive } from './ThumbnailDeepDive';
import { downloadIndividualPDF, downloadExcel, downloadCSV } from '../../services/thumbnailOptimizerExport';
import type { ThumbnailAudit, AuditRequest } from '../../types/thumbnailOptimizer';

const LOADING_MESSAGES = [
  'Analyzing visual hierarchy...',
  'Evaluating color contrasts...',
  'Scanning emotional triggers...',
  'Measuring text readability...',
  'Synthesizing optimization reports...',
];

function extractVideoId(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com') && u.pathname === '/watch') return u.searchParams.get('v') || '';
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || '';
    if (u.hostname.includes('youtube.com') && u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || '';
    if (u.hostname.includes('youtube.com') && u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || '';
  } catch { /* not a URL */ }
  return url.replace(/^.*[\\/]/, '').slice(0, 11);
}

export function AdminThumbnailOptimizer() {
  const [audits, setAudits] = useState<ThumbnailAudit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState('Initializing audit engine...');
  const [hasRun, setHasRun] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [exportMenuAnchor, setExportMenuAnchor] = useState<{ el: HTMLElement; index: number } | null>(null);

  const mutation = useThumbnailAudit({
    onSuccess: ({ results, errors }) => {
      setAudits(results);
      setHasRun(true);
      clearLoadingInterval();

      if (errors && errors.length > 0) {
        const errorMsg = errors
          .map((e) => `${e.url}: ${e.error}`)
          .join('\n');
        console.error('[AdminThumbnailOptimizer] Per-video errors:', errorMsg);
        setError(`Some videos failed to analyze:\n${errorMsg.slice(0, 1000)}`);
      }
    },
    onError: (err) => {
      const msg = err.message || '';
      console.error('[AdminThumbnailOptimizer] Error:', msg);
      setError(msg || 'An unexpected error occurred. Please try again.');
      setHasRun(true);
      clearLoadingInterval();
    },
  });

  function clearLoadingInterval() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  useEffect(() => {
    if (mutation.isPending) {
      let idx = 0;
      intervalRef.current = setInterval(() => {
        idx = (idx + 1) % LOADING_MESSAGES.length;
        setLoadingText(LOADING_MESSAGES[idx]);
      }, 2500);
    }
    return clearLoadingInterval;
  }, [mutation.isPending]);

  const handleSubmit = (params: AuditRequest) => {
    setError(null);
    setAudits([]);
    setHasRun(true);
    // Reset the rotating loading message here (event handler, not the effect
    // body) so the effect only manages the interval subscription.
    setLoadingText(LOADING_MESSAGES[0]);
    mutation.mutate(params);
  };



  return (
    <Container maxWidth={false} disableGutters>
      {/* Admin badge header */}
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 'var(--rt-text-xs)',
              fontWeight: 'var(--rt-weight-bold)',
              color: 'var(--rt-color-accent)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            <Scan size={14} />
            Admin · Thumbnail Optimizer
          </span>
        </Box>
        <p style={{ fontSize: 'var(--rt-text-sm)', color: 'var(--rt-color-text-secondary)', margin: 0 }}>
          Manually enter YouTube video URLs to audit thumbnails via AI visual analysis.
        </p>
      </Box>

      {/* Input form -- always in manual URL mode */}
      <AuditInputForm
        onSubmit={handleSubmit}
        isLoading={mutation.isPending}
        error={error}
        videoSource="manual"
      />

      {/* Loading state */}
      {mutation.isPending && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            py: 6,
            px: 2,
            borderRadius: 'var(--rt-radius-lg)',
            bgcolor: 'var(--rt-color-bg-elevated)',
            border: '1px solid var(--rt-color-border)',
            mt: 2,
          }}
        >
          <Spinner size={36} />
          <Box sx={{ textAlign: 'center' }}>
            <div style={{ fontSize: 'var(--rt-text-md)', fontWeight: 'var(--rt-weight-semibold)', color: 'var(--rt-color-text)' }}>
              {loadingText}
            </div>
            <div style={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-secondary)', marginTop: 4 }}>
              AI Multi-dimensional Visual Analysis in Progress
            </div>
          </Box>
        </Box>
      )}

      {/* Results */}
      {!mutation.isPending && audits.length > 0 && (
        <>
          <Box sx={{ mt: 2 }}>
            <AuditReportHeader audits={audits} />
          </Box>

          <Box sx={{ mt: 2 }}>
            <AuditTable audits={audits} />
          </Box>

          <Box sx={{ mt: 6 }}>
            <div className="rtis-section-title">
              Individual Deep Dives
            </div>

            {audits.map((audit, index) => {
              const videoId = extractVideoId(audit.url);
              return (
                <Accordion
                  key={index}
                  id={`thumb-audit-${videoId}`}
                  defaultExpanded={index === 0}
                  className="rtis-video-accordion"
                  disableGutters
                >
                  <AccordionSummary
                    expandIcon={<ChevronRight size={18} style={{ color: 'var(--rt-color-text-tertiary)' }} />}
                    sx={{
                      px: 2,
                      py: 0.5,
                      minHeight: 48,
                      '&.Mui-expanded': { minHeight: 48 },
                      '& .MuiAccordionSummary-content': { my: 1, alignItems: 'center' },
                      '& .MuiAccordionSummary-expandIconWrapper.Mui-expanded': { transform: 'rotate(90deg)' },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
                      <Box
                        sx={{
                          width: 28,
                          height: 28,
                          borderRadius: 'var(--rt-radius-sm)',
                          bgcolor: 'var(--rt-color-bg-subtle)',
                          border: '1px solid var(--rt-color-border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 'var(--rt-text-xs)',
                          fontWeight: 'var(--rt-weight-bold)',
                          color: 'var(--rt-color-text-secondary)',
                          flexShrink: 0,
                        }}
                      >
                        {index + 1}
                      </Box>
                      <Box
                        sx={{
                          fontSize: 'var(--rt-text-2xs)',
                          fontFamily: 'monospace',
                          color: 'var(--rt-color-text-tertiary)',
                          bgcolor: 'var(--rt-color-bg-subtle)',
                          px: 0.75,
                          py: 0.25,
                          borderRadius: 'var(--rt-radius-sm)',
                          flexShrink: 0,
                        }}
                      >
                        {videoId}
                      </Box>
                      <Box
                        sx={{
                          fontSize: 'var(--rt-text-sm)',
                          fontWeight: 'var(--rt-weight-semibold)',
                          color: 'var(--rt-color-text)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        {audit.videoTitle}
                      </Box>
                      <Box
                        sx={{
                          px: 1.25,
                          py: 0.35,
                          borderRadius: 'var(--rt-radius-pill)',
                          fontSize: 'var(--rt-text-xs)',
                          fontWeight: 'var(--rt-weight-bold)',
                          flexShrink: 0,
                          bgcolor: audit.currentScore >= 8 ? 'var(--rt-color-success-surface)' : audit.currentScore >= 5 ? 'var(--rt-color-warning-surface)' : 'var(--rt-color-danger-surface)',
                          color: audit.currentScore >= 8 ? 'var(--rt-color-success)' : audit.currentScore >= 5 ? 'var(--rt-color-warning)' : 'var(--rt-color-danger)',
                        }}
                      >
                        {audit.currentScore}/10
                      </Box>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExportMenuAnchor({ el: e.currentTarget, index });
                        }}
                        sx={{
                          flexShrink: 0,
                          color: 'var(--rt-color-text-tertiary)',
                          p: 0.5,
                          '&:hover': { color: 'var(--rt-color-text)' },
                        }}
                      >
                        <Download size={15} />
                      </IconButton>
                      <Menu
                        anchorEl={exportMenuAnchor?.el ?? null}
                        open={exportMenuAnchor?.index === index}
                        onClose={() => setExportMenuAnchor(null)}
                        onClick={() => setExportMenuAnchor(null)}
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                        slotProps={{
                          paper: {
                            sx: {
                              minWidth: 140,
                              borderRadius: 'var(--rt-radius-md)',
                              border: '1px solid var(--rt-color-border)',
                              boxShadow: 'var(--rt-shadow-lg)',
                            },
                          },
                        }}
                      >
                        <MenuItem onClick={() => { downloadIndividualPDF(audit); }} sx={{ fontSize: 'var(--rt-text-xs)', py: 0.75 }}>
                          <ListItemIcon sx={{ minWidth: 28 }}><FileText size={15} /></ListItemIcon>
                          <ListItemText>PDF</ListItemText>
                        </MenuItem>
                        <MenuItem onClick={() => { downloadExcel([audit]); }} sx={{ fontSize: 'var(--rt-text-xs)', py: 0.75 }}>
                          <ListItemIcon sx={{ minWidth: 28 }}><FileSpreadsheet size={15} /></ListItemIcon>
                          <ListItemText>Excel</ListItemText>
                        </MenuItem>
                        <MenuItem onClick={() => { downloadCSV([audit]); }} sx={{ fontSize: 'var(--rt-text-xs)', py: 0.75 }}>
                          <ListItemIcon sx={{ minWidth: 28 }}><Table2 size={15} /></ListItemIcon>
                          <ListItemText>CSV</ListItemText>
                        </MenuItem>
                      </Menu>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ px: 2.5, pb: 2.5, pt: 0 }}>
                    <ThumbnailDeepDive audit={audit} index={index} />
                  </AccordionDetails>
                </Accordion>
              );
            })}
          </Box>
        </>
      )}

      {/* IDLE state hint */}
      {!hasRun && !mutation.isPending && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1.5,
            py: 6,
            px: 2,
            textAlign: 'center',
            borderRadius: 'var(--rt-radius-lg)',
            bgcolor: 'var(--rt-color-bg-elevated)',
            border: '1px solid var(--rt-color-border)',
            mt: 2,
          }}
        >
          <Image size={36} style={{ color: 'var(--rt-color-text-muted)', opacity: 0.5 }} />
          <div>
            <h3 style={{ fontSize: 'var(--rt-text-md)', fontWeight: 'var(--rt-weight-bold)', color: 'var(--rt-color-text)', margin: 0 }}>
              Admin Thumbnail Audit
            </h3>
            <p style={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-secondary)', margin: '6px 0 0 0', maxWidth: 480 }}>
              Enter YouTube video URLs above and click &ldquo;Initialize Batch Audit&rdquo; to analyze
              thumbnails, contrast, visual hierarchy, and CTR potential.
            </p>
          </div>
        </Box>
      )}
    </Container>
  );
}
