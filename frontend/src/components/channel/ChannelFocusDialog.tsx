/**
 * ChannelFocusDialog — per-channel Focus & Knowledge editor.
 *
 * Shows the saved focus for the channel in the active scope (personal or
 * org), offers "Generate with AI" for the initial draft from channel data,
 * and lets the user edit + save afterwards.
 */
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Modal, Button, Grid, TextField, Spinner } from '../ui';
import { useChannelFocusQuery, useInvalidateChannelFocus } from '../../hooks/queries/useChannelFocusQuery';
import {
  generateChannelFocus,
  saveChannelFocus,
  type ChannelFocus,
  type ChannelSnapshot,
} from '../../services/channelFocusService';

export interface ChannelFocusDialogProps {
  open: boolean;
  onClose: () => void;
  channelId: string | null;
  channelTitle?: string;
  /** Active scope: null = personal, org id = organization. */
  organizationId?: string | null;
  organizationName?: string;
  /** Channel data used for the AI first draft (title/desc/stats/videos). */
  channelSnapshot?: ChannelSnapshot;
  onSaved?: (focus: ChannelFocus) => void;
}

const emptyForm = { niche: '', audience: '', pillarsText: '', tone: '', goalsNotes: '' };

export function ChannelFocusDialog({
  open,
  onClose,
  channelId,
  channelTitle,
  organizationId = null,
  organizationName,
  channelSnapshot,
  onSaved,
}: ChannelFocusDialogProps) {
  const { data: focus, isLoading, isError } = useChannelFocusQuery(open ? channelId : null);
  const invalidate = useInvalidateChannelFocus();
  const [form, setForm] = useState(emptyForm);
  const [dirty, setDirty] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedSource, setGeneratedSource] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<string | null>(null);

  const dataSourceLabel =
    dataSource === 'live'
      ? 'a live channel, videos & playlists audit'
      : dataSource === 'db'
        ? 'saved channel analytics'
        : dataSource === 'snapshot'
          ? 'basic channel info'
          : null;

  // Sync the form when the dialog opens or fresh focus data arrives — adjusted
  // during render (not in an effect) per React's recommended pattern for
  // resetting state in response to a prop change. Never clobbers user edits.
  const focusKey = open && channelId ? `${channelId}:${focus?.updatedAt ?? 'none'}` : 'closed';
  const [loadedKey, setLoadedKey] = useState(focusKey);
  if (focusKey !== loadedKey) {
    setLoadedKey(focusKey);
    if (!open) {
      setDirty(false);
      setDataSource(null);
    } else if (!dirty) {
      setForm(
        focus
          ? {
              niche: focus.niche ?? '',
              audience: focus.audience ?? '',
              pillarsText: (focus.contentPillars ?? []).join('\n'),
              tone: focus.tone ?? '',
              goalsNotes: focus.goalsNotes ?? '',
            }
          : emptyForm,
      );
      setError(null);
      setGeneratedSource(null);
      setDataSource(focus?.dataSource ?? null);
    }
  }

  if (!open || !channelId) return null;

  const set = (key: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setDirty(true);
    setError(null);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const snapshot: ChannelSnapshot = {
        title: channelTitle,
        ...(channelSnapshot ?? {}),
      };
      const gen = await generateChannelFocus(channelId, snapshot, organizationId);
      setDataSource(gen.dataSource ?? null);
      setForm({
        niche: gen.niche ?? '',
        audience: gen.audience ?? '',
        pillarsText: (gen.contentPillars ?? []).join('\n'),
        tone: gen.tone ?? '',
        goalsNotes: gen.goalsNotes ?? '',
      });
      setGeneratedSource(gen.source);
      setDirty(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const pillars = form.pillarsText.split('\n').map((p) => p.trim()).filter(Boolean);
      const saved = await saveChannelFocus(
        {
          channelId,
          organizationId,
          niche: form.niche,
          audience: form.audience,
          contentPillars: pillars,
          tone: form.tone,
          goalsNotes: form.goalsNotes,
          source: generatedSource === 'ai' || focus?.source === 'ai' ? 'ai' : 'manual',
        },
        organizationId,
      );
      invalidate(channelId);
      onSaved?.(saved);
      toast.success('Channel focus saved');
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Save failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const scopeLabel = organizationId ? (organizationName ?? 'Organization') : 'Personal';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Channel Focus — ${channelTitle || channelId}`}
      description={`Focus & knowledge for this channel · ${scopeLabel} context`}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={isLoading || saving || !dirty}>
            {saving ? 'Saving…' : 'Save focus'}
          </Button>
        </>
      }
    >
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--rt-space-6)' }}>
          <Spinner size={26} />
        </div>
      ) : isError ? (
        <p style={{ color: 'var(--rt-color-danger)', fontSize: 'var(--rt-text-sm)' }}>
          Could not load the saved focus. You can still generate a draft and save it.
        </p>
      ) : null}

      {focus && !dirty && (
        <p style={{ color: 'var(--rt-color-text-secondary)', fontSize: 'var(--rt-text-xs)', marginBottom: 'var(--rt-space-2)' }}>
          {focus.source === 'ai' ? 'AI-generated draft (edited or not — update anytime).' : 'Saved focus — update anytime.'}
        </p>
      )}
      {generatedSource && dirty && (
        <p style={{ color: 'var(--rt-color-text-secondary)', fontSize: 'var(--rt-text-xs)', marginBottom: 'var(--rt-space-2)' }}>
          {generatedSource === 'ai' ? 'AI draft ready' : 'Draft ready from channel data'}
          {dataSourceLabel ? ` — based on ${dataSourceLabel}` : ''} — review, edit, then Save.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rt-space-3)' }}>
        <Grid container spacing={1.5}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Niche / Focus" value={form.niche} onChange={set('niche')} fullWidth placeholder="e.g. Beginner guitar lessons" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Tone / Voice" value={form.tone} onChange={set('tone')} fullWidth placeholder="e.g. Friendly, concise, practical" />
          </Grid>
        </Grid>
        <TextField
          label="Content pillars (one per line)"
          value={form.pillarsText}
          onChange={set('pillarsText')}
          fullWidth
          multiline
          rows={4}
          placeholder={'tutorials\nreviews\nbehind the scenes'}
          helperText="One pillar per line — the topics this channel returns to."
        />
        <Grid container spacing={1.5}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Audience" value={form.audience} onChange={set('audience')} fullWidth multiline rows={3} placeholder="Who is this channel for?" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Goals & direction" value={form.goalsNotes} onChange={set('goalsNotes')} fullWidth multiline rows={3} placeholder="Where should this channel go next?" />
          </Grid>
        </Grid>
      </div>

      {error && (
        <p role="alert" style={{ color: 'var(--rt-color-danger)', fontSize: 'var(--rt-text-sm)', marginTop: 'var(--rt-space-2)' }}>
          {error}
        </p>
      )}

      <div style={{ marginTop: 'var(--rt-space-3)' }}>
        <Button variant="secondary" onClick={() => void handleGenerate()} disabled={generating} startIcon={<Sparkles size={14} />}>
          {generating ? 'Generating…' : focus || dirty ? 'Regenerate with AI' : 'Generate with AI'}
        </Button>
      </div>
    </Modal>
  );
}
