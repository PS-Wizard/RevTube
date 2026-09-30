import React from "react";
import { ArrowLeft, SquarePlay } from "lucide-react";
import type { VideoMetadata } from "../../types/youtube";
import { Button } from "../ui";
import { Card } from "../ui/card";
import { Box } from "../ui/Box";
import { Flex, Stack } from "../ui/Stack";
import { Typography } from "../ui/Typography";

export interface DashboardVideoDetailProps {
  video: VideoMetadata | null;
  onBack: () => void;
}

/**
 * Selected-video detail block: back bar + video card (thumbnail, title,
 * meta, watch link). Extracted from DashboardPage — pure presentational,
 * composed only from shared primitives.
 */
export const DashboardVideoDetail: React.FC<DashboardVideoDetailProps> = ({
  video,
  onBack,
}) => {
  if (!video) return null;

  return (
    <>
      <div className="page-header page-header--compact">
        <Button variant="ghost" bare onClick={onBack}>
          <ArrowLeft size={16} />
          Back to videos
        </Button>
      </div>

      <Card>
        <Flex alignItems="center" gap={3} wrap>
          <Box
            style={{
              flexShrink: 0,
              width: 280,
              maxWidth: "100%",
              aspectRatio: "16 / 9",
              backgroundColor: "var(--rt-color-bg-muted)",
              borderRadius: "var(--rt-radius-md)",
              overflow: "hidden",
            }}
          >
            <img
              src={video.thumbnailUrl}
              alt={video.title}
              referrerPolicy="no-referrer"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </Box>
          <Stack gap={1.5} style={{ flexGrow: 1, minWidth: 0 }}>
            <Typography component="h2" variant="h4">
              {video.title}
            </Typography>
            <Flex alignItems="center" gap={3} wrap>
              <Typography variant="caption">
                Published:{" "}
                <strong style={{ color: "var(--foreground)", fontWeight: 600 }}>
                  {new Date(video.publishedAt).toLocaleDateString()}
                </strong>
              </Typography>
              <Typography variant="caption">
                Views:{" "}
                <strong style={{ color: "var(--foreground)", fontWeight: 600 }}>
                  {video.viewCount?.toLocaleString()}
                </strong>
              </Typography>
              <Typography variant="caption">
                Likes:{" "}
                <strong style={{ color: "var(--foreground)", fontWeight: 600 }}>
                  {video.likeCount?.toLocaleString()}
                </strong>
              </Typography>
            </Flex>
            <Box>
              <Button
                component="a"
                variant="youtube"
                size="sm"
                href={`https://www.youtube.com/watch?v=${video.videoId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <SquarePlay size={16} />
                Watch on YouTube
              </Button>
            </Box>
          </Stack>
        </Flex>
      </Card>
    </>
  );
};

export default DashboardVideoDetail;
