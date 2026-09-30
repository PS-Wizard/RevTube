// ─────────────────────────────────────────────────────────────────────────────
// AdminPlaylistOptimizer -- Admin-only playlist optimizer.
// Renders the same UI as the user-facing PlaylistOptimizerPage in admin mode:
// any channel's videos or playlists can be analyzed (no single-channel lock,
// no restriction to connected channels), and admins see the strategy and
// playlist-reasoning content that is hidden from regular users.
// ─────────────────────────────────────────────────────────────────────────────
import { Box } from "../../components/ui";
import { Scan } from "lucide-react";
import { PlaylistOptimizerPage } from "./PlaylistOptimizerPage";

export function AdminPlaylistOptimizer() {
  return (
    <Box>
      {/* Admin badge header */}
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: "var(--rt-text-xs)",
              fontWeight: "var(--rt-weight-bold)",
              color: "var(--rt-color-accent)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            <Scan size={14} />
            Admin · Playlist Optimizer
          </span>
        </Box>
        <p
          style={{
            fontSize: "var(--rt-text-sm)",
            color: "var(--rt-color-text-tertiary)",
            margin: 0,
          }}
        >
          Analyze and optimize playlists for any channel. Enter video URLs or a
          channel ID to get AI-powered playlist recommendations.
        </p>
      </Box>
      <PlaylistOptimizerPage adminMode />
    </Box>
  );
}
