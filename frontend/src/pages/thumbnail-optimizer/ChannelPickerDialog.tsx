// ─────────────────────────────────────────────────────────────────────────────
// ChannelPickerDialog -- shared channel selector (same UX as ChatPage)
// Shows org + personal merged, searchable, with owner badges and thumbnails
// ─────────────────────────────────────────────────────────────────────────────
import {
  Box,
  Button,
  TextField,
  List,
  ListItemAvatar,
  ListItemText,
  ListItemButton,
  Avatar,
  Spinner,
  Typography,
} from "../../components/ui";
import { Modal } from "../../components/ui/Modal";
import { Search, Tv } from "lucide-react";
import { useState, useMemo } from "react";

export interface ChannelOption {
  id: string;
  title: string;
  thumbnailUrl?: string;
  owner?: { type: string; orgId?: string | null; uid?: string | null };
  _shared?: boolean;
}

interface ChannelPickerDialogProps {
  open: boolean;
  channels: ChannelOption[];
  selectedChannelId: string;
  onClose: () => void;
  onConfirm: (channelId: string) => void;
  isLoading?: boolean;
}

export function ChannelPickerDialog({
  open,
  channels,
  selectedChannelId,
  onClose,
  onConfirm,
  isLoading = false,
}: ChannelPickerDialogProps) {
  const [search, setSearch] = useState("");

  const filteredChannels = useMemo(() => {
    if (!search.trim()) return channels;
    const q = search.toLowerCase().trim();
    return channels.filter((c) => c.title.toLowerCase().includes(q));
  }, [search, channels]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Select Audit Target Channel"
      maxWidth="sm"
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {/* Search — same as ChatPage */}
        <Box sx={{ position: "relative", display: "flex", alignItems: "center" }}>
          <Search size={14} style={{ position: "absolute", left: 10, color: "var(--rt-color-text-tertiary)", pointerEvents: "none" }} />
          <TextField
            size="small"
            placeholder="Search channels..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            fullWidth
            autoFocus
            sx={{
              "& .MuiInputBase-input": {
                fontSize: "var(--rt-text-sm)",
                paddingLeft: "28px",
              },
            }}
          />
        </Box>

        {/* Channel list — same card style as ChatPage dropdown */}
        <List
          sx={{
            maxHeight: 320,
            overflow: "auto",
            borderRadius: "var(--rt-radius-md)",
            border: "1px solid var(--rt-color-border)",
            bgcolor: "var(--rt-color-bg-subtle)",
            p: 0,
          }}
        >
          {isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <Spinner size={26} />
            </Box>
          ) : filteredChannels.length === 0 ? (
            <Box sx={{ py: 4, textAlign: "center" }}>
              <Typography
                sx={{
                  fontSize: "var(--rt-text-sm)",
                  color: "var(--rt-color-text-tertiary)",
                }}
              >
                {channels.length === 0
                  ? "No connected channels found."
                  : "No channels match your search."}
              </Typography>
            </Box>
          ) : (
            filteredChannels.map((c) => (
              <ListItemButton
                key={c.id}
                selected={c.id === selectedChannelId}
                onClick={() => onConfirm(c.id)}
                sx={{
                  px: 2,
                  py: 1.5,
                  borderBottom: "1px solid var(--rt-color-border)",
                  "&:last-child": { borderBottom: "none" },
                  "&.Mui-selected": {
                    bgcolor: "var(--rt-color-accent-muted)",
                  },
                  "&:hover": {
                    bgcolor: "var(--rt-color-bg-highlight, var(--rt-color-bg-muted))",
                  },
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                }}
              >
                <ListItemAvatar sx={{ minWidth: 40 }}>
                  {c.thumbnailUrl ? (
                    <Avatar
                      src={c.thumbnailUrl}
                      sx={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        bgcolor: "var(--rt-color-bg-muted)",
                      }}
                    >
                      <Tv size={16} />
                    </Avatar>
                  ) : (
                    <Box
                      sx={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        bgcolor: "var(--rt-color-accent-muted)",
                        color: "var(--rt-color-accent)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: "var(--rt-weight-bold)",
                      }}
                    >
                      {c.title.slice(0, 1).toUpperCase()}
                    </Box>
                  )}
                </ListItemAvatar>
                <ListItemText
                  primary={c.title}
                  primaryTypographyProps={{
                    fontSize: "var(--rt-text-sm)",
                    fontWeight: "var(--rt-weight-medium)",
                    color: "var(--rt-color-text)",
                    sx: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
                  }}
                />
                {(c.owner || (c as any)._shared) && (
                  <Box
                    sx={{
                      ml: "auto",
                      px: 1,
                      py: 0.25,
                      borderRadius: "var(--rt-radius-pill)",
                      bgcolor: "var(--rt-color-bg-muted)",
                      border: "1px solid var(--rt-color-border)",
                      fontSize: "var(--rt-text-2xs)",
                      color: "var(--rt-color-text-tertiary)",
                      flexShrink: 0,
                    }}
                  >
                    {(c as any)._shared ? "Org • You" : c.owner?.type === "org" ? "Org" : "You"}
                  </Box>
                )}
              </ListItemButton>
            ))
          )}
        </List>

        {/* Footer hint like ChatPage */}
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography sx={{ fontSize: "var(--rt-text-xs)", color: "var(--rt-color-text-tertiary)" }}>
            {filteredChannels.length} channel{filteredChannels.length !== 1 ? "s" : ""}
          </Typography>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </Box>
      </Box>
    </Modal>
  );
}
