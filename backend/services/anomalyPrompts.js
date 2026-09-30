/**
 * AI prompt + response normaliser for anomaly explanations.
 *
 * Kept separate from anomalyService so the prompt/JSON contract has a single
 * home (DRY) and can be unit-tested without a DB or an LLM.
 *
 * Grounding rule: the model may ONLY reason over the evidence we pass in. Every
 * number in the prompt comes from the deterministic engine, so the explanation
 * can be specific without the model inventing metrics.
 */

const CATEGORIES = [
  'upload',
  'content',
  'externalTraffic',
  'algorithm',
  'engagement',
  'live',
  'trend',
  'seasonality',
  'technical',
  'unknown',
];

function fmtNumber(value, integer = true) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return integer ? Math.round(n).toLocaleString('en-US') : n.toFixed(2);
}

function fmtPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0%';
  return `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

/** Compact, token-cheap view of the ±14d context for the prompt. */
function contextLines(context, limit = 30) {
  const rows = Array.isArray(context) ? context.slice(-limit) : [];
  return rows.map((c) => `${c.date}: actual ${fmtNumber(c.actual, false)}, expected ${fmtNumber(c.expected, false)}`);
}

/**
 * Build the DeepSeek prompt for one anomaly. Pure.
 * Returns a single prompt string consumed by `deepSeekJson({ prompt })`.
 */
function buildExplainPrompt({ anomaly, channelTitle, evidence = {} }) {
  const movements = (evidence.movements || [])
    .slice(0, 8)
    .map((m) => `- ${m.label}: ${fmtPct(m.deltaPct)} (expected ${fmtNumber(m.expected)}, actual ${fmtNumber(m.actual)})`);
  const drivers = (evidence.drivers || [])
    .filter((d) => Number.isFinite(Number(d.deltaViews)))
    .slice(0, 8)
    .map((d) => {
      const share = Number.isFinite(Number(d.sharePct))
        ? `, ${Math.round(Number(d.sharePct) * 100)}% of the day's views`
        : '';
      return `- "${d.title}" (${d.videoId}): ${fmtNumber(d.deltaViews)} views vs previous snapshot${share}${d.publishedAt ? `, published ${d.publishedAt}` : ''}`;
    });
  const uploads = (evidence.uploads || [])
    .slice(0, 5)
    .map((u) => `- "${u.title}" (${u.videoId}) published ${u.publishedAt} (${u.daysBefore} day(s) before)`);
  const signals = (evidence.signals || [])
    .slice(0, 6)
    .map((s) => `- [${s.key}] ${s.label}: ${s.detail}`);

  return [
    'You are a YouTube analytics diagnostician for TubeKeter Analytics.',
    'Explain ONE detected metric anomaly using ONLY the evidence below. Never invent numbers, videos or dates that are not present.',
    'If the evidence does not support a confident cause, say so and lower the confidence.',
    '',
    `Channel: ${channelTitle || anomaly.channelTitle || anomaly.channelId}`,
    `Date: ${anomaly.anomalyDate}`,
    `Metric: ${anomaly.metricLabel} (${anomaly.metric}, unit: ${anomaly.unit})`,
    `Direction: ${anomaly.direction === 'up' ? 'spike' : 'dip'}${anomaly.kind === 'trend' ? ' (multi-day trend)' : ''}`,
    `Detected value: ${fmtNumber(anomaly.actualValue, anomaly.integer)} vs seasonality-aware baseline ${fmtNumber(anomaly.baselineValue, anomaly.integer)} (${fmtPct(anomaly.deltaPct)}, robust z-score ${Number(anomaly.zScore).toFixed(2)}, severity ${anomaly.severity}, score ${anomaly.score}/100)`,
    anomaly.runLength > 1 ? `Run length: ${anomaly.runLength} consecutive days` : '',
    '',
    'Deterministic signals already detected (use these first):',
    signals.length ? signals.join('\n') : '- none',
    '',
    'Other metrics that moved the same day:',
    movements.length ? movements.join('\n') : '- none material',
    '',
    'Per-video view movement for the day (from daily catalog snapshots):',
    drivers.length ? drivers.join('\n') : '- no per-video snapshot available',
    '',
    'Uploads in the 2 days before the anomaly:',
    uploads.length ? uploads.join('\n') : '- none',
    '',
    'Daily series context (actual vs seasonality-aware expected):',
    contextLines(evidence.context).join('\n') || '- unavailable',
    '',
    'Return JSON only, exactly this shape:',
    '{',
    '  "headline": "one short sentence (max 90 chars)",',
    '  "summary": "2-3 sentences explaining what happened and why",',
    `  "likelyCategory": one of ${JSON.stringify(CATEGORIES)},`,
    '  "confidence": 0.0-1.0,',
    '  "rootCauses": [{ "signal": "short_key", "weight": 0.0-1.0, "explanation": "why this contributed" }],',
    '  "impactAssessment": "how big this is for the channel",',
    '  "recommendedActions": [{ "action": "concrete next step", "rationale": "why it helps", "priority": "high|medium|low" }],',
    '  "caveats": ["what could make this explanation wrong"]',
    '}',
    'Rules: 1-4 rootCauses, 1-3 recommendedActions, actions must be specific to the numbers above (no generic advice), and every number you mention must appear in the evidence.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}


/** Compact one-anomaly block for the batch prompt (ids + top evidence only). */
function batchItemLines(id, anomaly, evidence = {}) {
  const signals = (evidence.signals || [])
    .slice(0, 3)
    .map((s) => `[${s.key}] ${s.label}: ${s.detail}`);
  const drivers = (evidence.drivers || [])
    .filter((d) => Number.isFinite(Number(d.deltaViews)))
    .slice(0, 3)
    .map((d) => `"${d.title}": ${fmtNumber(d.deltaViews)} views`);
  const movements = (evidence.movements || [])
    .slice(0, 2)
    .map((m) => `${m.label}: ${fmtPct(m.deltaPct)}`);
  return [
    `--- anomaly id ${id} ---`,
    `${anomaly.metricLabel} (${anomaly.metric}) ${anomaly.direction === 'up' ? 'spike' : 'dip'} on ${anomaly.anomalyDate}: detected ${fmtNumber(anomaly.actualValue, anomaly.integer)} vs baseline ${fmtNumber(anomaly.baselineValue, anomaly.integer)} (${fmtPct(anomaly.deltaPct)}, severity ${anomaly.severity})`,
    `signals: ${signals.length ? signals.join(' | ') : 'none'}`,
    `drivers: ${drivers.length ? drivers.join(' | ') : 'none'}`,
    `other moves: ${movements.length ? movements.join(' | ') : 'none'}`,
  ].join('\n');
}

/**
 * Build ONE DeepSeek prompt covering MULTIPLE anomalies. Pure.
 * The model returns `{ "explanations": { "<id>": {<single-anomaly shape>} } }`
 * so a whole scan's new anomalies cost a single API call instead of one per
 * anomaly. Copy is deliberately SHORT (the UI renders a compact panel).
 */
function buildBatchExplainPrompt({ items = [], channelTitle } = {}) {
  const blocks = items.map(({ id, anomaly, evidence }) =>
    batchItemLines(id, anomaly, evidence || {}),
  );
  const ids = items.map(({ id }) => String(id));
  return [
    'You are a YouTube analytics diagnostician for TubeKeter Analytics.',
    `Explain ${items.length} detected metric anomalies for channel "${channelTitle || items[0]?.anomaly?.channelId || 'unknown'}" using ONLY the evidence below. Never invent numbers, videos or dates that are not present.`,
    'Keep every explanation SHORT: headline max 70 chars, summary 1-2 sentences, max 2 rootCauses, max 2 recommendedActions (specific to the numbers, no generic advice).',
    '',
    ...blocks,
    '',
    'Return JSON only, exactly this shape with one entry per anomaly id:',
    `{"explanations": {${ids.map((id) => `"${id}": {...}`).join(', ')}}}`,
    'Each entry: {"headline": "...", "summary": "...",',
    ` "likelyCategory": one of ${JSON.stringify(CATEGORIES)},`,
    ' "confidence": 0.0-1.0,',
    ' "rootCauses": [{"signal": "short_key", "weight": 0.0-1.0, "explanation": "..."}],',
    ' "impactAssessment": "...", "recommendedActions": [{"action": "...", "rationale": "...", "priority": "high|medium|low"}], "caveats": ["..."]}',
  ].join('\n');
}

function asStringArray(value, max = 5) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : typeof v?.action === 'string' ? v.action.trim() : ''))
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Coerce the model's JSON into the exact shape the UI renders. Returns null when
 * the payload is unusable (the caller then falls back to the rule-based text).
 * Pure.
 */
function normalizeExplanation(raw, { anomaly } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const headline =
    typeof raw.headline === 'string' && raw.headline.trim()
      ? raw.headline.trim().slice(0, 140)
      : anomaly
        ? `${anomaly.metricLabel} ${anomaly.direction === 'up' ? 'spiked' : 'dipped'} on ${anomaly.anomalyDate}`
        : 'Anomaly explanation';
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
  if (!summary) return null;

  const rootCauses = (Array.isArray(raw.rootCauses) ? raw.rootCauses : [])
    .map((c) => ({
      signal: typeof c?.signal === 'string' ? c.signal.slice(0, 60) : 'signal',
      weight: Number.isFinite(Number(c?.weight)) ? Math.min(1, Math.max(0, Number(c.weight))) : 0.5,
      explanation: typeof c?.explanation === 'string' ? c.explanation.slice(0, 600) : '',
    }))
    .filter((c) => c.explanation)
    .slice(0, 4);

  const recommendedActions = (Array.isArray(raw.recommendedActions) ? raw.recommendedActions : [])
    .map((a) => ({
      action: typeof a?.action === 'string' ? a.action.slice(0, 400) : '',
      rationale: typeof a?.rationale === 'string' ? a.rationale.slice(0, 300) : '',
      priority: ['high', 'medium', 'low'].includes(a?.priority) ? a.priority : 'medium',
    }))
    .filter((a) => a.action)
    .slice(0, 3);

  return {
    source: 'ai',
    headline,
    summary: summary.slice(0, 1600),
    likelyCategory: CATEGORIES.includes(raw.likelyCategory) ? raw.likelyCategory : 'unknown',
    confidence: Number.isFinite(Number(raw.confidence)) ? Math.min(1, Math.max(0, Number(raw.confidence))) : 0.5,
    rootCauses,
    impactAssessment: typeof raw.impactAssessment === 'string' ? raw.impactAssessment.slice(0, 600) : '',
    recommendedActions,
    caveats: asStringArray(raw.caveats, 4),
  };
}

module.exports = {
  CATEGORIES,
  buildExplainPrompt,
  buildBatchExplainPrompt,
  normalizeExplanation,
  fmtNumber,
  fmtPct,
  contextLines,
};
