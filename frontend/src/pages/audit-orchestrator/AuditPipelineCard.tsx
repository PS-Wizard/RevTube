import {
  Box,
  Button,
  IconButton,
  Progress,
  Spinner,
  Typography,
} from "../../components/ui";
import { Eye, ListVideo, Scan, Search, TrendingUp, Tv, X } from "lucide-react";
import { toast } from "react-hot-toast";

export interface AuditPipelineCardProps {
  running: boolean;
  runningHidden: boolean;
  setRunningHidden: (hidden: boolean) => void;
  /** Job percent (10-100) while the worker reports staged progress. */
  progress?: number | null;
}

export function AuditPipelineCard({
  running,
  runningHidden,
  setRunningHidden,
  progress,
}: AuditPipelineCardProps) {
  if (!running) return null;
  const determinate = typeof progress === "number" && progress > 0;

  return (
    <>
      {/* Active Pipeline Loading Card */}
      {!runningHidden && (
        <div className="aop-pipeline-card">
          <div className="aop-pipeline-shimmer">
            <div className="aop-pipeline-shimmer-bar" />
          </div>

          <div className="aop-pipeline-header">
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: "var(--rt-radius-md)",
                  bgcolor: "var(--rt-color-accent-muted)",
                  color: "var(--rt-color-accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Scan size={16} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: "var(--rt-text-sm)", fontWeight: "var(--rt-weight-bold)", color: "var(--rt-color-text)" }}>
                  Channel Audit in Progress
                </Typography>
                <Typography sx={{ fontSize: "var(--rt-text-xs)", color: "var(--rt-color-text-tertiary)" }}>
                  {determinate
                    ? `Working through the pipeline — ${Math.min(100, Math.round(progress as number))}% complete…`
                    : "Scanning channel metadata, evaluating video sample and calculating category benchmarks..."}
                </Typography>
              </Box>
            </Box>

            <IconButton
              size="small"
              onClick={() => {
                setRunningHidden(true);
                toast("Audit running in background — click Show to restore", { icon: "⏳", duration: 3000 });
              }}
              aria-label="Hide running status"
            >
              <X size={16} />
            </IconButton>
          </div>

          <div className="aop-pipeline-badge-group">
            {[
              { label: "1. Channel Identity", icon: Tv },
              { label: "2. Video SEO & Sample", icon: Search },
              { label: "3. Playlist Architecture", icon: ListVideo },
              { label: "4. Trends & Cadence", icon: TrendingUp },
            ].map(({ label, icon: Icon }) => (
              <div key={label} className="aop-pipeline-chip">
                <Icon size={13} style={{ color: "var(--rt-color-accent)" }} />
                <span>{label}</span>
                <div className="aop-pulse-dot" />
              </div>
            ))}
          </div>

          <Progress
            variant={determinate ? "determinate" : "indeterminate"}
            value={determinate ? Math.min(100, Math.round(progress as number)) : undefined}
            sx={{
              height: 6,
              borderRadius: "var(--rt-radius-pill)",
              bgcolor: "var(--rt-color-bg-subtle)",
              "& .MuiLinearProgress-bar": {
                background: "linear-gradient(90deg, var(--rt-color-accent), var(--rt-color-accent-hover))",
              },
            }}
          />
        </div>
      )}

      {/* Background Floating Pill */}
      {runningHidden && (
        <Box
          sx={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 1400,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            px: 2,
            py: 1.25,
            borderRadius: "var(--rt-radius-pill)",
            bgcolor: "var(--rt-color-bg-elevated)",
            border: "1px solid var(--rt-color-border-strong)",
            boxShadow: "var(--rt-shadow-md)",
            animation: "aop-slideIn 0.22s ease-out",
          }}
        >
          <Spinner size={16} />
          <Typography sx={{ fontSize: "var(--rt-text-sm)", fontWeight: "var(--rt-weight-semibold)", color: "var(--rt-color-text)" }}>
            Auditing Channel…
          </Typography>
          <Button size="small" variant="secondary" onClick={() => setRunningHidden(false)} sx={{ ml: 0.5 }}>
            Show
          </Button>
          <IconButton size="small" onClick={() => setRunningHidden(false)} sx={{ ml: -0.5 }}>
            <Eye size={14} />
          </IconButton>
        </Box>
      )}
    </>
  );
}
