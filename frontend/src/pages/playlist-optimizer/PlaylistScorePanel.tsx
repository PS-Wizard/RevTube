// ─────────────────────────────────────────────────────────────────────────────
// PlaylistScorePanel -- deterministic "Why this score" + "Raise it" breakdown
// shown inside each playlist card, under the score. Explains every deduction
// with a concrete action to recover the points.
// ─────────────────────────────────────────────────────────────────────────────
import { Lightbulb, TrendingUp } from "lucide-react";
import type { PlaylistScore } from "../../utils/playlistScoring";

interface PlaylistScorePanelProps {
  score?: PlaylistScore;
}

export const PlaylistScorePanel: React.FC<PlaylistScorePanelProps> = ({ score }) => {
  // Nothing to explain: either no score was computed (AI fallback) or the
  // playlist is clean and the floor didn't fire.
  if (!score || (!score.isTopUplifted && score.factors.length === 0)) return null;

  const hasTips = score.factors.some((f) => f.tip);

  return (
    <div className="pl-score-panel">
      <div className="pl-score-panel-block">
        <div className="pl-score-panel-title">
          <TrendingUp size={13} /> Why this score
        </div>
        {score.factors.length === 0 ? (
          <div className="pl-score-panel-note">
            Solid playlist - no deductions found.
          </div>
        ) : (
          <ul className="pl-score-factors">
            {score.factors.map((f) => (
              <li key={f.key} className="pl-score-factor">
                <span className="pl-score-factor-label">{f.label}</span>
                <span className="pl-score-factor-delta">-{f.deduction} pts</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasTips && (
        <div className="pl-score-panel-block">
          <div className="pl-score-panel-title">
            <Lightbulb size={13} /> Raise it
          </div>
          <ul className="pl-score-tips">
            {score.factors
              .filter((f) => f.tip)
              .map((f) => (
                <li key={f.key} className="pl-score-tip">
                  <span className="pl-score-tip-gain">+{f.deduction}</span>
                  {f.tip}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
};
