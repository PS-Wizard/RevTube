import { useState } from "react";
import { Box, Button, Typography } from "../../components/ui";
import { Tv } from "lucide-react";
import { ChannelFocusDialog } from "../../components/channel/ChannelFocusDialog";
import { ChannelPickerDialog } from "../thumbnail-optimizer/ChannelPickerDialog";
import type { ChannelOption } from "./auditOrchestratorTypes";

export interface AuditChannelPickerCardProps {
  channels: ChannelOption[];
  selectedChannelId: string;
  onSelectChannel: (id: string) => void;
  running: boolean;
  /** Active scope: null = personal, org id = organization. */
  organizationId?: string | null;
  organizationName?: string;
}

export function AuditChannelPickerCard({
  channels,
  selectedChannelId,
  onSelectChannel,
  running,
  organizationId = null,
  organizationName,
}: AuditChannelPickerCardProps) {
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const selectedChannel = channels.find((c) => c.id === selectedChannelId);

  return (
    <>
      <div className="aop-card-title-row" style={{ marginBottom: "var(--rt-space-3)" }}>
        <div className="aop-card-title">Target Channel</div>
      </div>

      {channels.length === 0 && !running ? (
        <Box
          sx={{
            p: 4,
            textAlign: "center",
            bgcolor: "var(--rt-color-bg-subtle)",
            borderRadius: "var(--rt-radius-md)",
            border: "1px solid var(--rt-color-border)",
          }}
        >
          <Tv size={28} style={{ color: "var(--rt-color-text-tertiary)", marginBottom: 8 }} />
          <Typography
            sx={{
              color: "var(--rt-color-text-secondary)",
              fontSize: "var(--rt-text-sm)",
              fontWeight: "var(--rt-weight-medium)",
            }}
          >
            No connected YouTube channels found.
          </Typography>
          <Typography
            sx={{
              color: "var(--rt-color-text-tertiary)",
              fontSize: "var(--rt-text-xs)",
              mt: 0.5,
            }}
          >
            Please connect a YouTube channel to your account or organization to run an audit.
          </Typography>
        </Box>
      ) : selectedChannel ? (
        <div className="aop-channel-card">
          <div className="aop-channel-info-group">
            {selectedChannel.thumbnailUrl ? (
              <img
                src={selectedChannel.thumbnailUrl}
                alt=""
                className="aop-channel-avatar"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />
            ) : (
              <div className="aop-channel-avatar-fallback">
                {selectedChannel.title.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="aop-channel-meta">
              <div className="aop-channel-title-row">
                <span className="aop-channel-title">{selectedChannel.title}</span>
                {(selectedChannel.owner || (selectedChannel as any)._shared) && (
                  <span className="aop-owner-badge">
                    {(selectedChannel as any)._shared
                      ? "Org • You"
                      : selectedChannel.owner?.type === "org"
                      ? "Org"
                      : "Personal"}
                  </span>
                )}
              </div>
              <div className="aop-channel-sub">
                <span>Channel ID:</span>
                <span className="aop-channel-id-pill">{selectedChannel.id}</span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "var(--rt-space-2)" }}>
            <Button
              variant="secondary"
              size="small"
              onClick={() => setFocusOpen(true)}
              disabled={running}
            >
              Channel focus
            </Button>
            <Button
              variant="secondary"
              size="small"
              onClick={() => setChannelDialogOpen(true)}
              disabled={running}
              startIcon={<Tv size={14} />}
            >
              Change Channel
            </Button>
          </div>
        </div>
      ) : (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            p: 2,
            borderRadius: "var(--rt-radius-md)",
            bgcolor: "var(--rt-color-bg-subtle)",
            border: "1px solid var(--rt-color-border)",
          }}
        >
          <Typography sx={{ fontSize: "var(--rt-text-xs)", color: "var(--rt-color-text-secondary)" }}>
            No channel currently selected.
          </Typography>
          <Button
            variant="primary"
            size="small"
            onClick={() => setChannelDialogOpen(true)}
            disabled={running}
          >
            Select Channel
          </Button>
        </Box>
      )}

      {/* Channel Picker Dialog */}
      <ChannelPickerDialog
        open={channelDialogOpen}
        channels={channels}
        selectedChannelId={selectedChannelId}
        onClose={() => setChannelDialogOpen(false)}
        onConfirm={(id: string) => {
          onSelectChannel(id);
          setChannelDialogOpen(false);
        }}
        isLoading={running}
      />

      {/* Channel Focus & Knowledge */}
      <ChannelFocusDialog
        open={focusOpen}
        onClose={() => setFocusOpen(false)}
        channelId={selectedChannel?.id ?? null}
        channelTitle={selectedChannel?.title}
        organizationId={organizationId}
        organizationName={organizationName}
        channelSnapshot={{ title: selectedChannel?.title }}
      />
    </>
  );
}
