import { useState } from "react";
import {
  Box,
  Button,
  FormControl,
  FormControlLabel,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Spinner,
  Switch,
  TextField,
  Typography,
  type SelectChangeEvent,
} from "../../components/ui";
import { Play, Settings2 } from "lucide-react";
import {
  REVKETER_EXPERT_HELP_URL,
  TUBEKETER_SITE_URL,
} from "../../constants/productUrls";
import {
  AUDIT_VIDEO_COUNT_OPTIONS,
} from "./auditOrchestratorTypes";

export interface AuditSamplingSettingsProps {
  videoSelectionMode: "recent" | "since";
  setVideoSelectionMode: (mode: "recent" | "since") => void;
  videoCount: number;
  setVideoCount: (count: number) => void;
  videoSince: string;
  setVideoSince: (since: string) => void;
  includeThumbnailAI: boolean;
  setIncludeThumbnailAI: (include: boolean) => void;
  running: boolean;
  canRunAudits: boolean;
  selectedChannelId: string;
  onRunAudit: () => void;
  /** Max videos this plan may audit (15 free / 30 pro). */
  planMax: number;
  /** True for Pro/admin — drives the under-select upsell copy. */
  isPro: boolean;
}

export function AuditSamplingSettings({
  videoSelectionMode,
  setVideoSelectionMode,
  videoCount,
  setVideoCount,
  videoSince,
  setVideoSince,
  includeThumbnailAI,
  setIncludeThumbnailAI,
  running,
  canRunAudits,
  selectedChannelId,
  onRunAudit,
  planMax,
  isPro,
}: AuditSamplingSettingsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Presets up to the admin-configured cap; the cap itself is always offered.
  const presets = AUDIT_VIDEO_COUNT_OPTIONS.filter((n) => n <= planMax);
  const countOptions = presets.includes(planMax) ? presets : [...presets, planMax].sort((a, b) => a - b);

  return (
    <>
      {/* Advanced Settings Drawer */}
      <div className="aop-settings-section">
        <div className="aop-settings-section-header">
          <div className="aop-settings-section-title">
            <Settings2 size={16} className="aop-settings-section-icon" />
            Advanced Sampling & Analysis Settings{" "}
            <span className="aop-settings-section-optional">(Optional)</span>
          </div>
          <Button variant="ghost" bare onClick={() => setShowAdvanced(!showAdvanced)}>
            <Settings2 size={14} /> {showAdvanced ? "Hide" : "Show"} Settings
          </Button>
        </div>

        {showAdvanced && (
          <div className="aop-settings-panel">
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={includeThumbnailAI}
                  onChange={(e) => setIncludeThumbnailAI(e.target.checked)}
                  disabled={running}
                />
              }
              label="Include thumbnail AI vision analysis (evaluates visual contrast, focal hooks & composition)"
            />

            <div className="aop-sampling-grid">
              <FormControl size="small" sx={{ minWidth: 230 }}>
                <InputLabel id="video-selection-mode-label">Video Sample Scope</InputLabel>
                <Select
                  labelId="video-selection-mode-label"
                  value={videoSelectionMode}
                  label="Video Sample Scope"
                  onChange={(e: SelectChangeEvent) =>
                    setVideoSelectionMode(e.target.value === "since" ? "since" : "recent")
                  }
                  disabled={running}
                  sx={{ fontSize: "var(--rt-text-sm)" }}
                >
                  <MenuItem value="since">Published since rolling date (Recommended)</MenuItem>
                  <MenuItem value="recent">Most recent videos (Fixed Count)</MenuItem>
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 230 }}>
                <InputLabel id="video-count-label">Videos per audit</InputLabel>
                <Select
                  labelId="video-count-label"
                  value={videoCount}
                  label="Videos per audit"
                  onChange={(e: SelectChangeEvent) => setVideoCount(Number(e.target.value))}
                  disabled={running}
                  sx={{ fontSize: "var(--rt-text-sm)" }}
                >
                  {countOptions.map((n) => (
                    <MenuItem key={n} value={n}>
                      {n} videos{n === planMax ? " (plan max)" : ""}
                    </MenuItem>
                  ))}
                </Select>
                <Typography variant="caption">
                  {isPro ? (
                    <>
                      Pro covers up to {planMax} videos. Need more?{" "}
                      <Link href={REVKETER_EXPERT_HELP_URL} target="_blank" rel="noopener noreferrer">
                        Contact us
                      </Link>
                      .
                    </>
                  ) : (
                    <>
                      Free covers up to {planMax} videos. Need more?{" "}
                      <Link href={TUBEKETER_SITE_URL} target="_blank" rel="noopener noreferrer">
                        Upgrade to Pro
                      </Link>{" "}
                      or{" "}
                      <Link href={REVKETER_EXPERT_HELP_URL} target="_blank" rel="noopener noreferrer">
                        Contact us
                      </Link>
                      .
                    </>
                  )}
                </Typography>
              </FormControl>

              {videoSelectionMode === "since" && (
                <TextField
                  size="small"
                  type="date"
                  label="Published Since Date"
                  value={videoSince}
                  onChange={(e) => setVideoSince(e.target.value)}
                  disabled={running}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ width: 190 }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Primary Action Button */}
      <div className="aop-launch-area">
        <Button
          variant="primary"
          fullWidth
          onClick={onRunAudit}
          disabled={!selectedChannelId || running || !canRunAudits}
          startIcon={running ? null : <Play size={16} />}
          sx={{
            py: 1.5,
            fontSize: "var(--rt-text-md)",
            fontWeight: "var(--rt-weight-bold)",
          }}
        >
          {running ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
              <Spinner size={18} color="inherit" />
              <span>Auditing Channel...</span>
            </Box>
          ) : (
            "Run Channel Audit"
          )}
        </Button>
      </div>
    </>
  );
}
