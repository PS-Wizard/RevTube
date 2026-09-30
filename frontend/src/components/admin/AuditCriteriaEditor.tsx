import React, { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../../utils/apiBase';
import { getFirebaseAuthHeader } from '../../services/authHeaders';
import { Button, Input, Toggle, Dialog, DialogTitle, DialogBody, DialogFooter } from '../ui';
import { toast } from 'react-hot-toast';
import {
  Tv,
  Video,
  TrendingUp,
  Sliders,
  Image as ImageIcon,
  ListVideo,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  SlidersHorizontal,
  Layers,
  Award,
  X,
} from 'lucide-react';
import './AuditCriteriaEditor.css';

export type AuditType = 'CHANNEL_IDENTITY' | 'VIDEO' | 'PLAYLIST' | 'GENERAL';
export type OptimizerTab = 'THUMBNAIL' | 'PLAYLIST_CRITERIA' | 'VIDEO_ELEMENTS';
export type TabKey = AuditType | OptimizerTab | 'weights';

export interface AuditParamDef {
  auditType: AuditType;
  key: string;
  label: string;
  category: string;
  weight: number;
  enabled: boolean;
  thresholds?: Record<string, number | string>;
  recommendationTemplate?: string;
}

// Optimizer criteria -- the same config the Thumbnail Optimizer, Playlist
// Optimizer, and the channel audit's thumbnail/playlist sub-audits consume.
export type PillarTier = 'Red' | 'Yellow' | 'Grey';

export interface ThumbnailPillarCfg {
  key: string;
  label: string;
  tier: PillarTier;
  weight: number;
  instruction: string;
}

export interface PlaylistCriterionCfg {
  key: string;
  label: string;
  weight: number;
  instruction: string;
}

export interface VideoElementCfg {
  key: string;
  label: string;
  element: string;
  category: string;
  weight: number;
  instruction: string;
}

// Unified row for the Video Audit tab — merges the per-element AI criteria
// (videoElements) and the generic VIDEO scoring params into ONE editable list.
// origin tracks which store a row came from so save can split it back.
export interface MergedVideoCriterion {
  origin: 'element' | 'param';
  key: string;
  label: string;
  category: string;
  weight: number;
  enabled: boolean;
  element?: string;
  instruction?: string;
  thresholds?: Record<string, number | string>;
  recommendationTemplate?: string;
}

export interface BlendWeights {
  algorithmic: number;
  ai: number;
}

export interface OptimizerCriteriaCfg {
  thumbnail: ThumbnailPillarCfg[];
  playlist: PlaylistCriterionCfg[];
  videoElements: VideoElementCfg[];
  videoBlend: BlendWeights;
  channelBlend?: BlendWeights;
  playlistBlend?: BlendWeights;
  generalBlend?: BlendWeights;
  /** Channel-identity AI rubric (channelBrand): scored 0-10 by the cheap
   *  text-only LLM in the channel sub-audit. Same fixed-set contract as the
   *  other sections — backend merges by key, drops unknown keys. */
  channelBrand: AiCriterionCfg[];
  /** General-outlook AI rubric (generalOutlook): scored 0-10 by the cheap
   *  text-only LLM in the general sub-audit. */
  generalOutlook: AiCriterionCfg[];
}

/** Generic AI-rubric row (channelBrand / generalOutlook): label + weight +
 *  LLM instruction + user-facing recommendation template. */
export interface AiCriterionCfg {
  key: string;
  label: string;
  category: string;
  weight: number;
  instruction: string;
  recommendationTemplate?: string;
}

/** Keep only well-formed AI-rubric rows from the backend payload. */
function parseAiSection(raw: unknown): AiCriterionCfg[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (r): r is AiCriterionCfg =>
        !!r &&
        typeof (r as AiCriterionCfg).key === 'string' &&
        typeof (r as AiCriterionCfg).label === 'string' &&
        typeof (r as AiCriterionCfg).instruction === 'string' &&
        typeof (r as AiCriterionCfg).weight === 'number'
    )
    .map((r) => ({
      key: r.key,
      label: r.label,
      category: typeof r.category === 'string' ? r.category : '',
      weight: r.weight,
      instruction: r.instruction,
      recommendationTemplate: typeof r.recommendationTemplate === 'string' ? r.recommendationTemplate : '',
    }));
}

export interface ScoringProfile {
  id: string;
  name: string;
  version: number;
  subAuditWeights: {
    channelIdentity: number;
    video: number;
    playlist: number;
    general: number;
  };
  gradeBands: Array<{ min: number; grade: string }>;
}

const TIER_OPTIONS: Array<{ value: PillarTier; label: string; desc: string }> = [
  { value: 'Red', label: 'Red (Critical)', desc: 'Must-have core pillar' },
  { value: 'Yellow', label: 'Yellow (Important)', desc: 'High impact pillar' },
  { value: 'Grey', label: 'Grey (Standard)', desc: 'Supplemental pillar' },
];

const TEMPLATE_VARIABLES = [
  '{{label}}',
  '{{score}}',
  '{{rate}}',
  '{{maxGapDays}}',
  '{{minMatchPct}}',
];

// ── STREAM C: robust scoring totals ─────────────────────────────────────
// Points categories (thumbnail pillars, playlist criteria, video elements)
// must total exactly 100 pts. Param groups (CHANNEL_IDENTITY / VIDEO /
// GENERAL) are *shares* — the backend normalizes them via deriveAuditScoring,
// so their totals are informative only and never block save.
const POINTS_TARGET = 100;

function sumPoints(rows: Array<{ weight: number }>): number {
  return rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
}

/** Proportional round + drift-to-last (mirrors backend deriveAuditScoring). */
function normalizeWeightsTo100(weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const total = weights.reduce((s, w) => s + (Number(w) || 0), 0);
  if (!(total > 0)) {
    // Nothing to proportion — split evenly with drift to last.
    const even = Math.floor(POINTS_TARGET / n);
    const out = new Array<number>(n).fill(even);
    out[n - 1] = POINTS_TARGET - even * (n - 1);
    return out.map((v) => Math.max(0, v));
  }
  const out: number[] = [];
  let assigned = 0;
  weights.forEach((w, i) => {
    if (i === n - 1) {
      out.push(Math.max(0, POINTS_TARGET - assigned));
    } else {
      const v = Math.round(((Number(w) || 0) / total) * POINTS_TARGET);
      out.push(Math.max(0, v));
      assigned += v;
    }
  });
  return out;
}

function contribShare(weight: number, total: number): string {
  if (!(total > 0)) return '—';
  return `${(((Number(weight) || 0) / total) * 100).toFixed(1)}%`;
}

async function readBackendErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data: unknown = await res.json();
    if (data && typeof data === 'object') {
      const err = (data as { error?: { message?: unknown } }).error;
      if (typeof err?.message === 'string' && err.message) return err.message;
      const msg = (data as { message?: unknown }).message;
      if (typeof msg === 'string' && msg) return msg;
    }
  } catch {
    /* non-JSON body — fall through to fallback */
  }
  return `${fallback} (HTTP ${res.status})`;
}

const TotalPill: React.FC<{ total: number; mode: 'points' | 'shares' }> = ({ total, mode }) => {
  if (mode === 'shares') {
    return (
      <span className="ace-pill ace-pill--neutral" title="Param weights are shares — backend auto-normalizes to 100">
        <CheckCircle2 size={14} aria-hidden />
        Total: {total} shares (auto-normalized to 100)
      </span>
    );
  }
  const ok = total === POINTS_TARGET;
  const delta = total - POINTS_TARGET;
  return (
    <span
      className={`ace-pill ${ok ? 'ace-pill--success' : 'ace-pill--danger'}`}
      role="status"
      title={ok ? 'Category totals 100 points' : `Off by ${delta > 0 ? '+' : ''}${delta} — normalize or adjust weights`}
    >
      {ok ? <CheckCircle2 size={14} aria-hidden /> : <AlertCircle size={14} aria-hidden />}
      {ok ? `Total: ${total} / ${POINTS_TARGET} pts` : `Total: ${total} / ${POINTS_TARGET} pts (${delta > 0 ? '+' : ''}${delta})`}
    </span>
  );
};

// ── Engine blend (algorithmic vs AI) ────────────────────────────────────
// Each audit scope blends a deterministic algorithmic score with an AI model
// judgment score. The two weights are coupled and always sum to 100.
const DEFAULT_BLEND: BlendWeights = { algorithmic: 50, ai: 50 };

const BLEND_HINT =
  'Algorithmic = deterministic checks; AI = model judgments. Final score blends both; users only see the final score.';

/** Clamp 0-100 + renormalize to 100 (mirrors backend). */
function normalizeBlend(b: BlendWeights): BlendWeights {
  const a = Math.max(0, Math.min(100, Number(b.algorithmic) || 0));
  const i = Math.max(0, Math.min(100, Number(b.ai) || 0));
  const total = a + i;
  if (!(total > 0)) return { ...DEFAULT_BLEND };
  const algorithmic = Math.round((a / total) * 100);
  return { algorithmic, ai: 100 - algorithmic };
}

/** Parse a blend from the backend payload; defaults to 50/50 when absent. */
function parseBlend(raw: unknown): BlendWeights {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BLEND };
  const r = raw as { algorithmic?: unknown; ai?: unknown };
  const algo = Number(r.algorithmic);
  const ai = Number(r.ai);
  if (!Number.isFinite(algo) || !Number.isFinite(ai)) return { ...DEFAULT_BLEND };
  return normalizeBlend({ algorithmic: algo, ai });
}

/** Copy of the optimizer config with all blends clamped + renormalized. */
function withNormalizedBlends(cfg: OptimizerCriteriaCfg): OptimizerCriteriaCfg {
  return {
    ...cfg,
    videoBlend: normalizeBlend(cfg.videoBlend ?? DEFAULT_BLEND),
    channelBlend: normalizeBlend(cfg.channelBlend ?? DEFAULT_BLEND),
    playlistBlend: normalizeBlend(cfg.playlistBlend ?? DEFAULT_BLEND),
    generalBlend: normalizeBlend(cfg.generalBlend ?? DEFAULT_BLEND),
  };
}

const BlendSlider: React.FC<{
  title: string;
  value: BlendWeights;
  onChange: (next: BlendWeights) => void;
}> = ({ title, value, onChange }) => {
  const algo = value?.algorithmic ?? DEFAULT_BLEND.algorithmic;
  const ai = value?.ai ?? DEFAULT_BLEND.ai;
  return (
    <div className="ace-cards-list" style={{ marginBottom: 16 }}>
      <div className="ace-summary-banner">
        <div className="ace-summary-info">
          <div className="ace-summary-title">{title}</div>
          <div className="ace-summary-pills">
            <span className="ace-pill ace-pill--neutral">
              Final score = {algo}% algorithmic + {ai}% AI ({algo} / {ai})
            </span>
          </div>
          <span className="ace-banner-hint">{BLEND_HINT}</span>
        </div>
      </div>
      <div className="ace-form-row--columns" style={{ padding: '0 16px 12px' }}>
        <div className="ace-field-group">
          <label className="ace-field-label">Algorithmic Weight (%)</label>
          <Input
            className="ace-input ace-input--number"
            type="number"
            min={0}
            max={100}
            value={algo}
            onChange={(e) => {
              const next = Math.max(0, Math.min(100, Number(e.target.value) || 0));
              onChange({ algorithmic: next, ai: 100 - next });
            }}
          />
        </div>
        <div className="ace-field-group">
          <label className="ace-field-label">AI Weight (%)</label>
          <Input
            className="ace-input ace-input--number"
            type="number"
            min={0}
            max={100}
            value={ai}
            onChange={(e) => {
              const next = Math.max(0, Math.min(100, Number(e.target.value) || 0));
              onChange({ algorithmic: 100 - next, ai: next });
            }}
          />
        </div>
      </div>
    </div>
  );
};

interface ThumbnailPillarsEditorProps {
  optCfg: OptimizerCriteriaCfg | null;
  setOptCfg: React.Dispatch<React.SetStateAction<OptimizerCriteriaCfg | null>>;
  onNormalize: () => void;
  onReset: () => void;
}

interface PlaylistCriteriaEditorProps {
  optCfg: OptimizerCriteriaCfg | null;
  setOptCfg: React.Dispatch<React.SetStateAction<OptimizerCriteriaCfg | null>>;
  onNormalize: () => void;
  onReset: () => void;
}

interface VideoElementsEditorProps {
  optCfg: OptimizerCriteriaCfg | null;
  setOptCfg: React.Dispatch<React.SetStateAction<OptimizerCriteriaCfg | null>>;
  onNormalize: () => void;
  onReset: () => void;
}

const ThumbnailPillarsEditor: React.FC<ThumbnailPillarsEditorProps> = ({
  optCfg,
  setOptCfg,
  onNormalize,
  onReset,
}) => {
  const updatePillar = (idx: number, field: keyof ThumbnailPillarCfg, value: unknown) => {
    setOptCfg((prev) => {
      if (!prev) return prev;
      const next = [...prev.thumbnail];
      next[idx] = { ...next[idx], [field]: value };
      return { ...prev, thumbnail: next };
    });
  };

  const pillars = optCfg?.thumbnail || [];
  const total = sumPoints(pillars);

  return (
    <div className="ace-cards-list">
      {/* Summary banner */}
      <div className="ace-summary-banner">
        <div className="ace-summary-info">
          <div className="ace-summary-title">Thumbnail Audit Pillars</div>
          <div className="ace-summary-pills">
            <span className="ace-pill ace-pill--neutral">{pillars.length} Pillars</span>
            <TotalPill total={total} mode="points" />
          </div>
          <span className="ace-banner-hint">points (must total 100) · fixed set</span>
        </div>
        <div className="ace-banner-actions">
          <Button variant="ghost" size="sm" onClick={onNormalize} disabled={pillars.length === 0 || total === POINTS_TARGET} title="Proportionally scale weights so the category totals 100">
            Normalize to 100
          </Button>
          <Button variant="ghost" size="sm" onClick={onReset} title="Restore this category to its initially loaded values">
            Reset to defaults
          </Button>
        </div>
      </div>

      {/* Pillars List */}
      {pillars.length === 0 ? (
        <div className="ace-empty-state">
          <p>No thumbnail pillars configured yet.</p>
        </div>
      ) : (
        pillars.map((pillar, idx) => (
          <div key={`thumb:${pillar.key}:${idx}`} className="ace-card">
            <div className="ace-card__header">
              <div className="ace-card__meta">
                <span className={`ace-tier-badge ace-tier-badge--${pillar.tier}`}>
                  {pillar.tier} Priority
                </span>
                <code className="ace-key-code">{pillar.key}</code>
              </div>
            </div>

            <div className="ace-form-row--three">
              <div className="ace-field-group">
                <label className="ace-field-label">Pillar Label</label>
                <Input
                  className="ace-input"
                  value={pillar.label}
                  onChange={(e) => updatePillar(idx, 'label', e.target.value)}
                  placeholder="e.g. Promise Lock"
                />
              </div>

              <div className="ace-field-group">
                <label className="ace-field-label">Priority Tier</label>
                <select
                  className="ace-select"
                  value={pillar.tier}
                  onChange={(e) => updatePillar(idx, 'tier', e.target.value as PillarTier)}
                >
                  {TIER_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ace-field-group">
                <label className="ace-field-label">Weight (pts) · {contribShare(pillar.weight, total)} of category</label>
                <Input
                  className="ace-input ace-input--number"
                  type="number"
                  min={1}
                  max={100}
                  value={pillar.weight}
                  onChange={(e) => updatePillar(idx, 'weight', Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            </div>

            <div className="ace-field-group">
              <label className="ace-field-label">AI Evaluation Instruction</label>
              <textarea
                className="ace-textarea"
                value={pillar.instruction}
                onChange={(e) => updatePillar(idx, 'instruction', e.target.value)}
                rows={2}
                placeholder="Describe what the visual AI should inspect and evaluate for this pillar..."
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
};

const PlaylistCriteriaEditor: React.FC<PlaylistCriteriaEditorProps> = ({ optCfg, setOptCfg, onNormalize, onReset }) => {
  const updateCriterion = (idx: number, field: keyof PlaylistCriterionCfg, value: unknown) => {
    setOptCfg((prev) => {
      if (!prev) return prev;
      const next = [...prev.playlist];
      next[idx] = { ...next[idx], [field]: value };
      return { ...prev, playlist: next };
    });
  };

  const criteria = optCfg?.playlist || [];
  const total = sumPoints(criteria);

  return (
    <div className="ace-cards-list">
      {/* Summary banner */}
      <div className="ace-summary-banner">
        <div className="ace-summary-info">
          <div className="ace-summary-title">Playlist Scoring Criteria</div>
          <div className="ace-summary-pills">
            <span className="ace-pill ace-pill--neutral">{criteria.length} Criteria</span>
            <TotalPill total={total} mode="points" />
          </div>
          <span className="ace-banner-hint">points (must total 100) · fixed set</span>
        </div>
        <div className="ace-banner-actions">
          <Button variant="ghost" size="sm" onClick={onNormalize} disabled={criteria.length === 0 || total === POINTS_TARGET} title="Proportionally scale weights so the category totals 100">
            Normalize to 100
          </Button>
          <Button variant="ghost" size="sm" onClick={onReset} title="Restore this category to its initially loaded values">
            Reset to defaults
          </Button>
        </div>
      </div>

      {/* Criteria List */}
      {criteria.length === 0 ? (
        <div className="ace-empty-state">
          <p>No playlist scoring criteria configured yet.</p>
        </div>
      ) : (
        criteria.map((criterion, idx) => (
          <div key={`playlist:${criterion.key}:${idx}`} className="ace-card">
            <div className="ace-card__header">
              <div className="ace-card__meta">
                <span className="ace-category-tag">PLAYLIST</span>
                <code className="ace-key-code">{criterion.key}</code>
              </div>
            </div>

            <div className="ace-form-row--columns">
              <div className="ace-field-group">
                <label className="ace-field-label">Criterion Label</label>
                <Input
                  className="ace-input"
                  value={criterion.label}
                  onChange={(e) => updateCriterion(idx, 'label', e.target.value)}
                  placeholder="e.g. Title CTR Power"
                />
              </div>

              <div className="ace-field-group">
                <label className="ace-field-label">Weight (pts) · {contribShare(criterion.weight, total)} of category</label>
                <Input
                  className="ace-input ace-input--number"
                  type="number"
                  min={1}
                  max={100}
                  value={criterion.weight}
                  onChange={(e) => updateCriterion(idx, 'weight', Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            </div>

            <div className="ace-field-group">
              <label className="ace-field-label">AI Evaluation Instruction</label>
              <textarea
                className="ace-textarea"
                value={criterion.instruction}
                onChange={(e) => updateCriterion(idx, 'instruction', e.target.value)}
                rows={2}
                placeholder="Describe how the AI should analyze playlist structure and metadata..."
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
};

const VideoElementsEditor: React.FC<VideoElementsEditorProps> = ({ optCfg, setOptCfg, onNormalize, onReset }) => {
  const updateElement = (idx: number, field: keyof VideoElementCfg, value: unknown) => {
    setOptCfg((prev) => {
      if (!prev) return prev;
      const next = [...prev.videoElements];
      next[idx] = { ...next[idx], [field]: value };
      return { ...prev, videoElements: next };
    });
  };

  const elements = optCfg?.videoElements || [];
  const total = sumPoints(elements);

  return (
    <div className="ace-cards-list">
      {/* Summary banner */}
      <div className="ace-summary-banner">
        <div className="ace-summary-info">
          <div className="ace-summary-title">Video Audit Elements</div>
          <div className="ace-summary-pills">
            <span className="ace-pill ace-pill--neutral">{elements.length} Elements</span>
            <TotalPill total={total} mode="points" />
          </div>
          <span className="ace-banner-hint">points (must total 100) · fixed set</span>
        </div>
        <div className="ace-banner-actions">
          <Button variant="ghost" size="sm" onClick={onNormalize} disabled={elements.length === 0 || total === POINTS_TARGET} title="Proportionally scale weights so the category totals 100">
            Normalize to 100
          </Button>
          <Button variant="ghost" size="sm" onClick={onReset} title="Restore this category to its initially loaded values">
            Reset to defaults
          </Button>
        </div>
      </div>

      {/* Elements List */}
      {elements.length === 0 ? (
        <div className="ace-empty-state">
          <p>No video audit elements configured yet.</p>
        </div>
      ) : (
        elements.map((element, idx) => (
          <div key={`videoEl:${element.key}:${idx}`} className="ace-card">
            <div className="ace-card__header">
              <div className="ace-card__meta">
                <span className="ace-category-tag">VIDEO</span>
                <code className="ace-key-code">{element.key}</code>
              </div>
            </div>

            <div className="ace-form-row--columns">
              <div className="ace-field-group">
                <label className="ace-field-label">Element Label</label>
                <Input
                  className="ace-input"
                  value={element.label}
                  onChange={(e) => updateElement(idx, 'label', e.target.value)}
                  placeholder="e.g. Title Clarity"
                />
              </div>
              <div className="ace-field-group">
                <label className="ace-field-label">Element</label>
                <Input
                  className="ace-input"
                  value={element.element}
                  onChange={(e) => updateElement(idx, 'element', e.target.value)}
                  placeholder="title / description / tags / keywords / caption"
                />
              </div>
            </div>

            <div className="ace-form-row--columns">
              <div className="ace-field-group">
                <label className="ace-field-label">Category</label>
                <Input
                  className="ace-input"
                  value={element.category}
                  onChange={(e) => updateElement(idx, 'category', e.target.value)}
                  placeholder="discoverability / contentQuality / visualHook"
                />
              </div>
              <div className="ace-field-group">
                <label className="ace-field-label">Weight (pts) · {contribShare(element.weight, total)} of category</label>
                <Input
                  className="ace-input ace-input--number"
                  type="number"
                  min={1}
                  max={100}
                  value={element.weight}
                  onChange={(e) => updateElement(idx, 'weight', Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            </div>

            <div className="ace-field-group">
              <label className="ace-field-label">AI Evaluation Instruction</label>
              <textarea
                className="ace-textarea"
                value={element.instruction}
                onChange={(e) => updateElement(idx, 'instruction', e.target.value)}
                rows={2}
                placeholder="Describe how the AI should analyze this video element..."
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
};

interface AiCriteriaSectionProps {
  title: string;
  hint: string;
  tag: string;
  section: 'channelBrand' | 'generalOutlook';
  optCfg: OptimizerCriteriaCfg | null;
  setOptCfg: React.Dispatch<React.SetStateAction<OptimizerCriteriaCfg | null>>;
  onNormalize: () => void;
  onReset: () => void;
}

/**
 * Generic editor for the AI-rubric sections (channelBrand / generalOutlook):
 * the cheap text-only LLM in each sub-audit scores these 0-10. The rubric
 * TEXT (label, instruction, recommendation) is fixed prompt engineering and
 * renders read-only — only the WEIGHT (score contribution) of each row is
 * editable. Totals are informative (the engine normalizes); only
 * thumbnail/playlist/videoElements block save.
 */
const AiCriteriaSection: React.FC<AiCriteriaSectionProps> = ({
  title,
  hint,
  tag,
  section,
  optCfg,
  setOptCfg,
  onNormalize,
  onReset,
}) => {
  const updateWeight = (idx: number, value: number) => {
    setOptCfg((prev) => {
      if (!prev) return prev;
      const next = [...prev[section]];
      next[idx] = { ...next[idx], weight: value };
      return { ...prev, [section]: next };
    });
  };

  const rows = optCfg?.[section] || [];
  const total = sumPoints(rows);

  return (
    <div className="ace-cards-list">
      <div className="ace-summary-banner">
        <div className="ace-summary-info">
          <div className="ace-summary-title">{title}</div>
          <div className="ace-summary-pills">
            <span className="ace-pill ace-pill--neutral">{rows.length} Criteria</span>
            <TotalPill total={total} mode="points" />
          </div>
          <span className="ace-banner-hint">{hint}</span>
        </div>
        <div className="ace-banner-actions">
          <Button variant="ghost" size="sm" onClick={onNormalize} disabled={rows.length === 0 || total === POINTS_TARGET} title="Proportionally scale weights so the category totals 100">
            Normalize to 100
          </Button>
          <Button variant="ghost" size="sm" onClick={onReset} title="Restore this category to its initially loaded values">
            Reset to defaults
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="ace-empty-state">
          <p>No criteria configured yet.</p>
        </div>
      ) : (
        rows.map((row, idx) => (
          <div key={`${section}:${row.key}:${idx}`} className="ace-card">
            <div className="ace-card__header">
              <div className="ace-card__meta">
                <span className="ace-category-tag">{row.category || tag}</span>
                <code className="ace-key-code">{row.key}</code>
              </div>
            </div>

            <div className="ace-form-row--columns">
              <div className="ace-field-group">
                <label className="ace-field-label">Criterion</label>
                <div className="ace-readonly-value">{row.label}</div>
              </div>
              <div className="ace-field-group">
                <label className="ace-field-label">Weight (pts) · {contribShare(row.weight, total)} of category</label>
                <Input
                  className="ace-input ace-input--number"
                  type="number"
                  min={1}
                  max={100}
                  value={row.weight}
                  onChange={(e) => updateWeight(idx, Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            </div>

            <div className="ace-field-group">
              <label className="ace-field-label">AI Evaluation Instruction</label>
              <div className="ace-readonly-value ace-readonly-value--multiline">{row.instruction}</div>
            </div>

            {row.recommendationTemplate && (
              <div className="ace-field-group">
                <label className="ace-field-label">Actionable Recommendation Template</label>
                <div className="ace-readonly-value ace-readonly-value--multiline">{row.recommendationTemplate}</div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
};

const CATEGORY_TABS: Array<{
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  description: string;
}> = [
  { key: 'CHANNEL_IDENTITY', label: 'Channel Audit', icon: Tv, description: 'Channel branding, upload cadence, velocity and metadata' },
  { key: 'VIDEO', label: 'Video Audit', icon: Video, description: 'Video SEO, per-element AI criteria, tags, description structure, retention & CTR factors' },
  { key: 'THUMBNAIL', label: 'Thumbnail Pillars', icon: ImageIcon, description: 'AI visual audit criteria for thumbnail effectiveness' },
  { key: 'PLAYLIST_CRITERIA', label: 'Playlist Criteria', icon: ListVideo, description: 'Playlist organization and optimization evaluation' },
  { key: 'GENERAL', label: 'General & Trends', icon: TrendingUp, description: 'Long-term consistency, trend alignment & performance stability' },
  { key: 'weights', label: 'Weights & Grades', icon: Sliders, description: 'Global category contribution percentages and grade thresholds' },
];

export const AuditCriteriaEditor: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('CHANNEL_IDENTITY');
  /** Category dialog open state — declared with the other hooks (above the
   *  loading early-return) so hook order stays stable across renders. */
  const [dialogOpen, setDialogOpen] = useState(false);
  const [params, setParams] = useState<AuditParamDef[]>([]);
  const [profile, setProfile] = useState<ScoringProfile | null>(null);
  const [optCfg, setOptCfg] = useState<OptimizerCriteriaCfg | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // DEFAULTS snapshot from initial load — powers per-category "Reset to defaults".
  const [defaultsOpt, setDefaultsOpt] = useState<OptimizerCriteriaCfg | null>(null);
  const [defaultsParams, setDefaultsParams] = useState<AuditParamDef[] | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setFormError(null);
    try {
      const authHeader = await getFirebaseAuthHeader();
      const [paramsRes, profileRes, optRes] = await Promise.all([
        fetch(apiUrl('/admin/audit-parameter-definitions'), { headers: { ...authHeader } }),
        fetch(apiUrl('/admin/audit-scoring-profiles'), { headers: { ...authHeader } }),
        fetch(apiUrl('/admin/optimizer-criteria'), { headers: { ...authHeader } }),
      ]);

      if (paramsRes.ok) {
        const pData = await paramsRes.json();
        const loaded: AuditParamDef[] = Array.isArray(pData.params) ? pData.params : [];
        setParams(loaded);
        setDefaultsParams((prev) => prev ?? structuredClone(loaded));
      }
      if (profileRes.ok) {
        const prData = await profileRes.json();
        setProfile(prData);
      }
      if (optRes.ok) {
        const oData = await optRes.json();
        const loaded: OptimizerCriteriaCfg = {
          thumbnail: Array.isArray(oData.thumbnail) ? oData.thumbnail : [],
          playlist: Array.isArray(oData.playlist) ? oData.playlist : [],
          videoElements: Array.isArray(oData.videoElements) ? oData.videoElements : [],
          videoBlend: parseBlend(oData.videoBlend),
          channelBlend: parseBlend(oData.channelBlend),
          playlistBlend: parseBlend(oData.playlistBlend),
          generalBlend: parseBlend(oData.generalBlend),
          channelBrand: parseAiSection(oData.channelBrand),
          generalOutlook: parseAiSection(oData.generalOutlook),
        };
        setOptCfg(loaded);
        setDefaultsOpt((prev) => prev ?? structuredClone(loaded));
      }
    } catch (err) {
      console.error('Failed to load audit criteria config:', err);
      toast.error('Failed to load audit configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred past mount (also StrictMode-safe: first timer is cleared).
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadData]);

  const handleParamChange = (
    key: string,
    auditType: AuditType,
    field: keyof AuditParamDef,
    value: unknown
  ) => {
    setParams((prev) =>
      prev.map((p) => (p.key === key && p.auditType === auditType ? { ...p, [field]: value } : p))
    );
  };

  const handleThresholdChange = (
    key: string,
    auditType: AuditType,
    threshKey: string,
    val: number | string
  ) => {
    setParams((prev) =>
      prev.map((p) => {
        if (p.key === key && p.auditType === auditType) {
          return {
            ...p,
            thresholds: {
              ...(p.thresholds || {}),
              [threshKey]: typeof val === 'number' && Number.isNaN(val) ? 0 : val,
            },
          };
        }
        return p;
      })
    );
  };

  // Criteria sets are FIXED (backend drops unknown keys on merge): admin edits
  // weights/labels/instructions/enabled only -- no custom add or remove.

  // ── Optimizer criteria handlers ──

  // ── STREAM C: per-category normalize / reset (points categories only) ──
  type PointsSection = 'thumbnail' | 'playlist' | 'videoElements' | 'channelBrand' | 'generalOutlook';
  const normalizeCategory = (section: PointsSection) => {
    setOptCfg((prev) => {
      if (!prev) return prev;
      const rows = prev[section];
      const next = normalizeWeightsTo100(rows.map((r) => Number(r.weight) || 0));
      return { ...prev, [section]: rows.map((r, i) => ({ ...r, weight: next[i] ?? r.weight })) };
    });
    setFormError(null);
  };

  const resetCategory = (section: PointsSection) => {
    const snap = defaultsOpt?.[section];
    if (!snap) {
      toast.error('No initial snapshot to reset to yet — reload first.');
      return;
    }
    setOptCfg((prev) => (prev ? { ...prev, [section]: structuredClone(snap) } : prev));
    setFormError(null);
    toast.success('Category reset to initially loaded values.');
  };

  const resetParamCategory = (auditType: AuditType) => {
    if (!defaultsParams) {
      toast.error('No initial snapshot to reset to yet — reload first.');
      return;
    }
    const snapRows = structuredClone(defaultsParams.filter((p) => p.auditType === auditType));
    setParams((prev) => [
      ...prev.filter((p) => p.auditType !== auditType),
      ...snapRows,
    ]);
    setFormError(null);
    toast.success('Category reset to initially loaded values.');
  };

  /** Points-category guard: returns an inline error message or null when OK. */
  const pointsErrorFor = (section: PointsSection, label: string): string | null => {
    const rows = optCfg?.[section] ?? [];
    if (rows.length === 0) return `${label}: add at least one criterion before saving.`;
    const total = sumPoints(rows);
    if (total !== POINTS_TARGET) {
      const delta = total - POINTS_TARGET;
      return `${label} totals ${total} / ${POINTS_TARGET} pts (${delta > 0 ? '+' : ''}${delta}). Use “Normalize to 100” or adjust weights before saving.`;
    }
    return null;
  };

  const handleSaveOptimizer = async () => {
    if (!optCfg) return;
    // Enforce only the active points category so one tab's drift never blocks another.
    const guard =
      activeTab === 'THUMBNAIL'
        ? pointsErrorFor('thumbnail', 'Thumbnail Pillars')
        : activeTab === 'PLAYLIST_CRITERIA'
          ? pointsErrorFor('playlist', 'Playlist Criteria')
          : null;
    if (guard) {
      setFormError(guard);
      toast.error(guard);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const authHeader = await getFirebaseAuthHeader();
      const res = await fetch(apiUrl('/admin/optimizer-criteria'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(withNormalizedBlends(optCfg)),
      });
      if (!res.ok) {
        const msg = await readBackendErrorMessage(res, 'Failed to save optimizer criteria');
        setFormError(msg);
        throw new Error(msg);
      }
      toast.success('Optimizer criteria saved successfully!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setFormError((prev) => prev ?? msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveParams = async () => {
    // Param weights are shares — backend auto-normalizes, so never block on total.
    // The Channel Audit and General tabs also own their engine blend, so persist
    // the optimizer config (blends included) alongside the params there.
    const persistBlend = optCfg && (activeTab === 'CHANNEL_IDENTITY' || activeTab === 'GENERAL');
    setSaving(true);
    setFormError(null);
    try {
      const authHeader = await getFirebaseAuthHeader();
      const paramsReq = fetch(apiUrl('/admin/audit-parameter-definitions'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ params }),
      });
      if (!persistBlend) {
        const res = await paramsReq;
        if (!res.ok) {
          const msg = await readBackendErrorMessage(res, 'Failed to save parameter definitions');
          setFormError(msg);
          throw new Error(msg);
        }
        toast.success('Audit parameters saved successfully!');
        return;
      }
      // SEQUENTIAL, not Promise.all: both endpoints read-modify-write the SAME
      // Firestore doc (config/optimizerCriteria). Concurrent writes race and the
      // last writer silently erases the first (e.g. toggles lost while the toast
      // still reports success). Awaiting in order makes each write build on the
      // other's committed result.
      const paramsRes = await paramsReq;
      if (!paramsRes.ok) {
        const msg = await readBackendErrorMessage(paramsRes, 'Failed to save parameter definitions');
        setFormError(msg);
        throw new Error(msg);
      }
      const optRes = await fetch(apiUrl('/admin/optimizer-criteria'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(withNormalizedBlends(optCfg)),
      });

      if (!optRes.ok) {
        const msg = await readBackendErrorMessage(optRes, 'Failed to save engine blend');
        setFormError(msg);
        throw new Error(msg);
      }
      toast.success('Audit parameters saved successfully!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setFormError((prev) => prev ?? msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // The combined "Video Audit" tab edits BOTH the optimizer element criteria
  // (videoElements) and the generic VIDEO params — save them together so admin
  // changes are persisted atomically.
  const handleSaveVideo = async () => {
    if (!optCfg) return handleSaveParams();
    // Points enforcement covers videoElements only; VIDEO params are shares.
    const guard = pointsErrorFor('videoElements', 'Video Elements');
    if (guard) {
      setFormError(guard);
      toast.error(guard);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const authHeader = await getFirebaseAuthHeader();
      // SEQUENTIAL (see handleSaveParams): both endpoints read-modify-write the
      // same Firestore doc — concurrent writes race and erase each other.
      const paramsRes = await fetch(apiUrl('/admin/audit-parameter-definitions'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ params }),
      });
      if (!paramsRes.ok) {
        const msg = await readBackendErrorMessage(paramsRes, 'Failed to save video parameters');
        setFormError(msg);
        throw new Error(msg);
      }
      const optRes = await fetch(apiUrl('/admin/optimizer-criteria'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(withNormalizedBlends(optCfg)),
      });
      if (!optRes.ok) {
        const msg = await readBackendErrorMessage(optRes, 'Failed to save video element criteria');
        setFormError(msg);
        throw new Error(msg);
      }
      toast.success('Video audit criteria saved successfully!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setFormError((prev) => prev ?? msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    setFormError(null);
    try {
      const authHeader = await getFirebaseAuthHeader();
      const res = await fetch(apiUrl('/admin/audit-scoring-profiles'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(profile),
      });

      if (!res.ok) {
        const msg = await readBackendErrorMessage(res, 'Failed to save scoring profile');
        setFormError(msg);
        throw new Error(msg);
      }
      toast.success('Scoring weights & grade bands saved!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setFormError((prev) => prev ?? msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="ace-loading-state">
        <RefreshCw size={24} className="rt-spin" aria-hidden />
        <p>Loading audit criteria and parameter definitions...</p>
      </div>
    );
  }

  const currentCategoryParams = ['CHANNEL_IDENTITY', 'VIDEO', 'GENERAL'].includes(activeTab)
    ? params.filter((p) => p.auditType === activeTab)
    : [];
  const activeParamsCount = currentCategoryParams.filter((p) => p.enabled).length;
  const currentCategoryWeight = currentCategoryParams
    .filter((p) => p.enabled)
    .reduce((s, p) => s + (Number(p.weight) || 0), 0);

  const subWeights = profile?.subAuditWeights || {
    channelIdentity: 0.25,
    video: 0.35,
    playlist: 0.15,
    general: 0.25,
  };

  const totalSubWeights = Math.round(
    ((subWeights.channelIdentity || 0) +
      (subWeights.video || 0) +
      (subWeights.playlist || 0) +
      (subWeights.general || 0)) *
      100
  );

  const isWeightsTab = activeTab === 'weights';
  const isOptimizerTab = activeTab === 'THUMBNAIL' || activeTab === 'PLAYLIST_CRITERIA';
  const isVideoTab = activeTab === 'VIDEO';

  // Compute counts for tab badges
  const getTabBadgeCount = (key: TabKey) => {
    if (key === 'THUMBNAIL') return optCfg?.thumbnail.length ?? 0;
    if (key === 'PLAYLIST_CRITERIA') return optCfg?.playlist.length ?? 0;
    if (key === 'weights') return `${totalSubWeights}%`;
    return params.filter((p) => p.auditType === key).length;
  };

  // ── Category dialog helpers ──────────────────────────────────────
  // The grid below is the overview; clicking a card opens that category's
  // full control set in a 70%-width dialog. All edit state lives in this
  // component, so closing the dialog never discards unsaved edits.
  const openCategory = (key: TabKey) => {
    setActiveTab(key);
    setFormError(null);
    setDialogOpen(true);
  };

  const paramsOf = (auditType: AuditType) => params.filter((p) => p.auditType === auditType);
  const thumbTotal = sumPoints(optCfg?.thumbnail ?? []);
  const playlistTotal = sumPoints(optCfg?.playlist ?? []);
  const videoElTotal = sumPoints(optCfg?.videoElements ?? []);
  const brandTotal = sumPoints(optCfg?.channelBrand ?? []);
  const outlookTotal = sumPoints(optCfg?.generalOutlook ?? []);

  /** One-line status for each category card. */
  const cardStats = (key: TabKey): string => {
    if (key === 'THUMBNAIL') return `${optCfg?.thumbnail.length ?? 0} pillars · ${thumbTotal}/100 pts`;
    if (key === 'PLAYLIST_CRITERIA') return `${optCfg?.playlist.length ?? 0} criteria · ${playlistTotal}/100 pts`;
    if (key === 'VIDEO') {
      const rows = paramsOf('VIDEO');
      return `${rows.filter((p) => p.enabled).length}/${rows.length} params · ${optCfg?.videoElements.length ?? 0} elements · ${videoElTotal}/100 pts`;
    }
    if (key === 'weights') return totalSubWeights === 100 ? 'Balanced · 100%' : `Unbalanced · ${totalSubWeights}%`;
    const rows = paramsOf(key as AuditType);
    const ai = key === 'CHANNEL_IDENTITY' ? optCfg?.channelBrand.length ?? 0 : optCfg?.generalOutlook.length ?? 0;
    const aiTotal = key === 'CHANNEL_IDENTITY' ? brandTotal : outlookTotal;
    return `${rows.filter((p) => p.enabled).length}/${rows.length} params · ${ai} AI rubric · ${aiTotal}/100 pts`;
  };

  const activeCard = CATEGORY_TABS.find((t) => t.key === activeTab);
  const ActiveCardIcon = activeCard?.icon ?? SlidersHorizontal;

  /** Per-category save for the dialog footer (mirrors the old header buttons). */
  const renderDialogSave = () => {
    if (isWeightsTab) {
      return (
        <Button variant="primary" size="sm" onClick={() => void handleSaveProfile()} disabled={saving || totalSubWeights !== 100}>
          {saving ? 'Saving…' : 'Save Weights & Bands'}
        </Button>
      );
    }
    if (isVideoTab) {
      return (
        <Button variant="primary" size="sm" onClick={() => void handleSaveVideo()} disabled={saving || !optCfg}>
          {saving ? 'Saving…' : 'Save Video Audit'}
        </Button>
      );
    }
    if (isOptimizerTab) {
      return (
        <Button variant="primary" size="sm" onClick={() => void handleSaveOptimizer()} disabled={saving || !optCfg}>
          {saving ? 'Saving…' : 'Save Criteria'}
        </Button>
      );
    }
    return (
      <Button variant="primary" size="sm" onClick={() => void handleSaveParams()} disabled={saving}>
        {saving ? 'Saving…' : 'Save Category'}
      </Button>
    );
  };

  return (
    <div className="audit-criteria-editor">
      {/* ── Control Header ────────────────────────────────────────── */}
      <div className="ace-header">
        <div className="ace-header__title-group">
          <div className="ace-header__icon-wrapper">
            <SlidersHorizontal size={20} aria-hidden />
          </div>
          <div className="ace-header__text">
            <h2>Audit Scoring & Variables Engine</h2>
            <p>Single source of truth for weights, formulas, thresholds, and AI prompt instructions</p>
          </div>
        </div>

        <div className="ace-header__actions">
          <Button variant="secondary" size="sm" onClick={() => void loadData()} disabled={saving}>
            <RefreshCw size={14} style={{ marginRight: 6 }} className={saving ? 'rt-spin' : ''} aria-hidden />
            Reload
          </Button>
        </div>
      </div>

      {/* ── Category overview grid ────────────────────────────────────
          Each card opens the category's full controls in a wide dialog.
          Unsaved edits survive dialog close; Reload discards them. */}
      <div className="ace-cat-grid" role="group" aria-label="Audit criteria categories">
        {CATEGORY_TABS.map((tab) => {
          const Icon = tab.icon;
          const badgeCount = getTabBadgeCount(tab.key);
          const stats = cardStats(tab.key);
          const warn = tab.key === 'weights' ? totalSubWeights !== 100 : stats.includes('NaN');
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => openCategory(tab.key)}
              className="ace-cat-card"
              aria-label={`Configure ${tab.label}`}
            >
              <span className="ace-cat-card__icon" aria-hidden>
                <Icon size={20} />
              </span>
              <span className="ace-cat-card__body">
                <span className="ace-cat-card__title-row">
                  <span className="ace-cat-card__title">{tab.label}</span>
                  <span className={`ace-tab-badge${warn ? ' ace-tab-badge--warn' : ''}`}>{badgeCount}</span>
                </span>
                <span className="ace-cat-card__desc">{tab.description}</span>
                <span className="ace-cat-card__stats">{stats}</span>
              </span>
              <span className="ace-cat-card__cta" aria-hidden>Configure →</span>
            </button>
          );
        })}
      </div>

      {/* ── Category dialog (70% width) ─────────────────────────────── */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth={false}
        className="ace-dialog"
        aria-label={activeCard ? `${activeCard.label} criteria` : 'Audit criteria'}
      >
        <DialogTitle className="ace-dialog__title">
          <span className="ace-dialog__title-group">
            <span className="ace-header__icon-wrapper" aria-hidden>
              <ActiveCardIcon size={18} />
            </span>
            <span>
              <span className="ace-dialog__heading">{activeCard?.label ?? 'Category'}</span>
              <span className="ace-dialog__sub">{activeCard?.description}</span>
            </span>
          </span>
          <Button variant="ghost" size="sm" bare onClick={() => setDialogOpen(false)} aria-label="Close dialog" title="Close (edits are kept)">
            <X size={18} aria-hidden />
          </Button>
        </DialogTitle>

        <DialogBody className="ace-dialog__body">
          {formError && (
            <div className="ace-form-error" role="alert">
              <AlertCircle size={16} aria-hidden />
              <span>{formError}</span>
            </div>
          )}

      {/* ── Active Category Content ─────────────────────────────────── */}
      {activeTab === 'weights' ? (
        <div className="ace-weights-container">
          {/* Sub-Audit Category Weights */}
          <div className="ace-weights-card">
            <div className="ace-section-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <SlidersHorizontal size={18} style={{ color: 'var(--rt-color-accent)' }} aria-hidden />
                  <h3>Full Audit Category Contribution Weights</h3>
                </div>
                <p>
                  Defines how much each sub-audit contributes to the overall 0–100 Channel Health Score. Must equal exactly 100%.
                </p>
              </div>

              <span
                className={`ace-pill ${totalSubWeights === 100 ? 'ace-pill--success' : 'ace-pill--danger'}`}
              >
                {totalSubWeights === 100 ? <CheckCircle2 size={14} aria-hidden /> : <AlertCircle size={14} aria-hidden />}
                {totalSubWeights === 100 ? 'Total: 100% Balanced' : `Total: ${totalSubWeights}% (Must equal 100%)`}
              </span>
            </div>

            <div className="ace-grid-four">
              {[
                { key: 'channelIdentity', label: 'Channel Audit', desc: 'Branding, metadata completeness, cadence & velocity' },
                { key: 'video', label: 'Video Audit', desc: 'SEO, CTR, retention, tags, description & thumbnail alignment' },
                { key: 'playlist', label: 'Playlist Audit', desc: 'Structure, depth, organization & strategic playlist coverage' },
                { key: 'general', label: 'General & Trends', desc: 'Long-term consistency, trend stability & format mix' },
              ].map((sub) => (
                <div key={sub.key} className="ace-subweight-card">
                  <div className="ace-subweight-card__title">{sub.label}</div>
                  <div className="ace-subweight-card__desc">{sub.desc}</div>
                  <div className="ace-input-suffix-wrapper">
                    <Input
                      className="ace-input ace-input--weight"
                      type="number"
                      min={0}
                      max={100}
                      value={Math.round((subWeights[sub.key as keyof typeof subWeights] || 0) * 100)}
                      onChange={(e) => {
                        const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                        setProfile((prev) =>
                          prev
                            ? {
                                ...prev,
                                subAuditWeights: {
                                  ...prev.subAuditWeights,
                                  [sub.key]: pct / 100,
                                },
                              }
                            : prev
                        );
                      }}
                    />
                    <span className="ace-input-suffix">%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Grade Bands */}
          <div className="ace-weights-card">
            <div className="ace-section-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Award size={18} style={{ color: 'var(--rt-color-accent)' }} aria-hidden />
                  <h3>Channel Health Grade Bands</h3>
                </div>
                <p>Minimum score thresholds required for channels to earn each corresponding audit tier.</p>
              </div>
            </div>

            <div className="ace-grid-four">
              {(profile?.gradeBands || [
                { min: 76, grade: 'Optimized' },
                { min: 51, grade: 'Growing' },
                { min: 26, grade: 'Getting Started' },
                { min: 0, grade: 'Needs Work' },
              ]).map((b, idx) => {
                const gradeClass = b.grade.toLowerCase().replace(/\s+/g, '-');
                return (
                  <div key={b.grade} className={`ace-grade-card ace-grade-card--${gradeClass}`}>
                    <div className="ace-grade-card__title">
                      <span>{b.grade}</span>
                      <span className="ace-pill ace-pill--neutral">Tier {idx + 1}</span>
                    </div>
                    <div className="ace-input-suffix-wrapper">
                      <span style={{ fontSize: '0.8rem', color: 'var(--rt-color-text-secondary)' }}>Min Score:</span>
                      <Input
                        className="ace-input ace-input--band"
                        type="number"
                        min={0}
                        max={100}
                        value={b.min}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          setProfile((prev) => {
                            if (!prev) return prev;
                            const bands = [...prev.gradeBands];
                            bands[idx] = { ...bands[idx], min: val };
                            return { ...prev, gradeBands: bands };
                          });
                        }}
                      />
                      <span className="ace-input-suffix">pts</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : activeTab === 'THUMBNAIL' ? (
        <ThumbnailPillarsEditor
          optCfg={optCfg}
          setOptCfg={setOptCfg}
          onNormalize={() => normalizeCategory('thumbnail')}
          onReset={() => resetCategory('thumbnail')}
        />
      ) : activeTab === 'PLAYLIST_CRITERIA' ? (
        <div className="ace-video-combined">
          <BlendSlider
            title="Engine Blend (Algorithmic vs AI)"
            value={optCfg?.playlistBlend ?? DEFAULT_BLEND}
            onChange={(next) =>
              setOptCfg((prev) => (prev ? { ...prev, playlistBlend: next } : prev))
            }
          />
          <PlaylistCriteriaEditor
            optCfg={optCfg}
            setOptCfg={setOptCfg}
            onNormalize={() => normalizeCategory('playlist')}
            onReset={() => resetCategory('playlist')}
          />
        </div>
      ) : isVideoTab ? (
        // Combined "Video Audit" tab: per-element AI criteria first, then the
        // generic VIDEO scoring params below. Both edited together here.
        <div className="ace-video-combined">
          {/* Engine blend: how the final video sub-audit score combines the
              algorithmic (rule-based) and AI (LLM) engine scores. */}
          <BlendSlider
            title="Engine Blend (Algorithmic vs AI)"
            value={optCfg?.videoBlend ?? DEFAULT_BLEND}
            onChange={(next) =>
              setOptCfg((prev) => (prev ? { ...prev, videoBlend: next } : prev))
            }
          />
          <VideoElementsEditor
            optCfg={optCfg}
            setOptCfg={setOptCfg}
            onNormalize={() => normalizeCategory('videoElements')}
            onReset={() => resetCategory('videoElements')}
          />
          <div className="ace-cards-list">
            <div className="ace-summary-banner">
              <div className="ace-summary-info">
                <div className="ace-summary-title">Video Scoring Params</div>
                <div className="ace-summary-pills">
                  <span className="ace-pill ace-pill--neutral">
                    {activeParamsCount} / {currentCategoryParams.length} Enabled
                  </span>
                  <TotalPill total={currentCategoryWeight} mode="shares" />
                </div>
                <span className="ace-banner-hint">shares (auto-normalized to 100) · fixed set</span>
              </div>
              <div className="ace-banner-actions">
                <Button variant="ghost" size="sm" onClick={() => resetParamCategory('VIDEO')} title="Restore this category to its initially loaded values">
                  Reset to defaults
                </Button>
              </div>
            </div>
            {currentCategoryParams.length === 0 ? (
              <div className="ace-empty-state">
                <p>No video scoring params defined yet.</p>
              </div>
            ) : (
              currentCategoryParams.map((p) => {
                const threshKeys = Object.keys(p.thresholds || {});
                return (
                  <div
                    key={`${p.auditType}:${p.key}`}
                    className={`ace-card${!p.enabled ? ' is-disabled' : ''}`}
                  >
                    <div className="ace-card__header">
                      <div className="ace-card__meta">
                        <Toggle
                          checked={p.enabled}
                          onChange={(checked: boolean) =>
                            handleParamChange(p.key, p.auditType, 'enabled', checked)
                          }
                          ariaLabel={`Enable ${p.label}`}
                        />
                        <span className="ace-category-tag">{p.category}</span>
                        <code className="ace-key-code">{p.key}</code>
                      </div>
                    </div>

                    <div className="ace-form-row--columns">
                      <div className="ace-field-group">
                        <label className="ace-field-label">Display Label</label>
                        <Input
                          className="ace-input"
                          value={p.label}
                          onChange={(e) =>
                            handleParamChange(p.key, p.auditType, 'label', e.target.value)
                          }
                          placeholder="e.g. Cards & End Screens"
                        />
                      </div>
                      <div className="ace-field-group">
                        <label className="ace-field-label">Weight (share) · {p.enabled ? contribShare(p.weight, currentCategoryWeight) : '— (disabled)'} of category</label>
                        <Input
                          className="ace-input ace-input--number"
                          type="number"
                          min={1}
                          max={100}
                          value={p.weight}
                          onChange={(e) =>
                            handleParamChange(
                              p.key,
                              p.auditType,
                              'weight',
                              Math.max(1, Number(e.target.value) || 1)
                            )
                          }
                        />
                      </div>
                    </div>

                    {threshKeys.length > 0 && (
                      <div className="ace-thresholds-box">
                        <div className="ace-thresholds-header">
                          <Layers size={14} aria-hidden />
                          <span>Threshold Variables & Tuning Parameters</span>
                        </div>
                        <div className="ace-thresholds-list">
                          {threshKeys.map((tk) => (
                            <div key={tk} className="ace-threshold-item">
                              <span className="ace-threshold-key">{tk}</span>
                              <Input
                                className="ace-input ace-input--threshold"
                                type="number"
                                value={p.thresholds?.[tk] ?? ''}
                                onChange={(e) =>
                                  handleThresholdChange(p.key, p.auditType, tk, Number(e.target.value))
                                }
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="ace-field-group">
                      <label className="ace-field-label">Actionable Recommendation Template</label>
                      <textarea
                        className="ace-textarea"
                        value={p.recommendationTemplate || ''}
                        onChange={(e) =>
                          handleParamChange(p.key, p.auditType, 'recommendationTemplate', e.target.value)
                        }
                        rows={2}
                        placeholder="e.g. Add cards and end screens linking to related videos to boost session time."
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="ace-cards-list">
          {activeTab === 'CHANNEL_IDENTITY' && (
            <BlendSlider
              title="Engine Blend (Algorithmic vs AI)"
              value={optCfg?.channelBlend ?? DEFAULT_BLEND}
              onChange={(next) =>
                setOptCfg((prev) => (prev ? { ...prev, channelBlend: next } : prev))
              }
            />
          )}
          {activeTab === 'GENERAL' && (
            <BlendSlider
              title="Engine Blend (Algorithmic vs AI)"
              value={optCfg?.generalBlend ?? DEFAULT_BLEND}
              onChange={(next) =>
                setOptCfg((prev) => (prev ? { ...prev, generalBlend: next } : prev))
              }
            />
          )}
          {/* AI rubric for this scope: scored 0-10 by the cheap text-only LLM
              and blended via the slider above. Saved together with the params
              by this category's Save button (same unified criteria doc). */}
          {activeTab === 'CHANNEL_IDENTITY' && (
            <AiCriteriaSection
              title="Channel Brand AI Rubric"
              hint="0–10 LLM scores · weights auto-normalized · drives the AI half of the channel blend"
              tag="CHANNEL"
              section="channelBrand"
              optCfg={optCfg}
              setOptCfg={setOptCfg}
              onNormalize={() => normalizeCategory('channelBrand')}
              onReset={() => resetCategory('channelBrand')}
            />
          )}
          {activeTab === 'GENERAL' && (
            <AiCriteriaSection
              title="General Outlook AI Rubric"
              hint="0–10 LLM scores · weights auto-normalized · drives the AI half of the general blend"
              tag="GENERAL"
              section="generalOutlook"
              optCfg={optCfg}
              setOptCfg={setOptCfg}
              onNormalize={() => normalizeCategory('generalOutlook')}
              onReset={() => resetCategory('generalOutlook')}
            />
          )}
          {/* Summary Header */}
          <div className="ace-summary-banner">
            <div className="ace-summary-info">
              <div className="ace-summary-title">
                {CATEGORY_TABS.find((t) => t.key === activeTab)?.label} Criteria
              </div>
              <div className="ace-summary-pills">
                <span className="ace-pill ace-pill--neutral">
                  {activeParamsCount} / {currentCategoryParams.length} Enabled
                </span>
                <TotalPill total={currentCategoryWeight} mode="shares" />
              </div>
              <span className="ace-banner-hint">shares (auto-normalized to 100) · fixed set</span>
            </div>

            <div className="ace-banner-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => resetParamCategory(activeTab as AuditType)}
                title="Restore this category to its initially loaded values"
              >
                Reset to defaults
              </Button>
            </div>
          </div>

          {/* List of Criteria Cards */}
          {currentCategoryParams.length === 0 ? (
            <div className="ace-empty-state">
              <p>No criteria defined in this category yet.</p>
            </div>
          ) : (
            currentCategoryParams.map((p) => {
              const threshKeys = Object.keys(p.thresholds || {});
              return (
                <div
                  key={`${p.auditType}:${p.key}`}
                  className={`ace-card${!p.enabled ? ' is-disabled' : ''}`}
                >
                  <div className="ace-card__header">
                    <div className="ace-card__meta">
                      <Toggle
                        checked={p.enabled}
                        onChange={(checked: boolean) =>
                          handleParamChange(p.key, p.auditType, 'enabled', checked)
                        }
                        ariaLabel={`Enable ${p.label}`}
                      />
                      <span className="ace-category-tag">{p.category}</span>
                      <code className="ace-key-code">{p.key}</code>
                    </div>
                  </div>

                  <div className="ace-form-row--columns">
                    <div className="ace-field-group">
                      <label className="ace-field-label">Display Label</label>
                      <Input
                        className="ace-input"
                        value={p.label}
                        onChange={(e) =>
                          handleParamChange(p.key, p.auditType, 'label', e.target.value)
                        }
                          placeholder="e.g. Upload Cadence Consistency"
                        />
                      </div>

                      <div className="ace-field-group">
                        <label className="ace-field-label">Weight (share) · {p.enabled ? contribShare(p.weight, currentCategoryWeight) : '— (disabled)'} of category</label>
                      <Input
                        className="ace-input ace-input--number"
                        type="number"
                        min={1}
                        max={100}
                        value={p.weight}
                        onChange={(e) =>
                          handleParamChange(
                            p.key,
                            p.auditType,
                            'weight',
                            Math.max(1, Number(e.target.value) || 1)
                          )
                        }
                      />
                    </div>
                  </div>

                  {/* Thresholds row if present */}
                  {threshKeys.length > 0 && (
                    <div className="ace-thresholds-box">
                      <div className="ace-thresholds-header">
                        <Layers size={14} aria-hidden />
                        <span>Threshold Variables & Tuning Parameters</span>
                      </div>
                      <div className="ace-thresholds-list">
                        {threshKeys.map((tk) => (
                          <div key={tk} className="ace-threshold-item">
                            <span className="ace-threshold-key">{tk}</span>
                            <Input
                              className="ace-input ace-input--threshold"
                              type="number"
                              value={p.thresholds?.[tk] ?? ''}
                              onChange={(e) =>
                                handleThresholdChange(p.key, p.auditType, tk, Number(e.target.value))
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recommendation Template */}
                  <div className="ace-field-group">
                    <label className="ace-field-label">Actionable Recommendation Template</label>
                    <textarea
                      className="ace-textarea"
                      value={p.recommendationTemplate || ''}
                      onChange={(e) =>
                        handleParamChange(p.key, p.auditType, 'recommendationTemplate', e.target.value)
                      }
                      rows={2}
                      placeholder="e.g. Upload gaps exceed {{maxGapDays}} days. Maintain a regular schedule to improve retention."
                    />
                    <div className="ace-template-hints">
                      <span>Supported tokens:</span>
                      {TEMPLATE_VARIABLES.map((v) => (
                        <code key={v} className="ace-hint-chip">
                          {v}
                        </code>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
        </DialogBody>

        <DialogFooter className="ace-dialog__footer">
          <span className="ace-dialog__footer-hint">Closing keeps unsaved edits — Reload discards them.</span>
          <span className="ace-dialog__footer-actions">
            <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
              Close
            </Button>
            {renderDialogSave()}
          </span>
        </DialogFooter>
      </Dialog>
    </div>
  );
};
