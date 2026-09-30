import React from "react";
import { SquarePlay } from "lucide-react";
import { Alert, AlertDescription, Button, Card, Flex, IconMedallion, Spinner, Stack, Typography } from "../ui";

export interface DashboardConnectStateProps {
  canConnectChannels: boolean;
  isConnectingChannel: boolean;
  onConnect: () => void;
}

/**
 * Empty state for the dashboard when no YouTube channels are connected.
 * Composed only from shared primitives — no page CSS.
 */
export const DashboardConnectState: React.FC<DashboardConnectStateProps> = ({
  canConnectChannels,
  isConnectingChannel,
  onConnect,
}) => {
  return (
    <Flex
      alignItems="center"
      justifyContent="center"
      style={{ minHeight: "calc(100vh - 100px)", padding: "2rem", backgroundColor: "var(--rt-color-bg-app)" }}
    >
      <Card style={{ maxWidth: 440, width: "100%", padding: "24px 32px" }}>
        <Stack alignItems="center" gap={2} style={{ textAlign: "center" }}>
          <IconMedallion shape="rounded" size={56} style={{ backgroundColor: "var(--rt-color-youtube)", color: "#fff" }}>
            <SquarePlay size={28} />
          </IconMedallion>
          {canConnectChannels ? (
            <>
              <Typography variant="h6" style={{ fontWeight: 600 }}>
                Connect Your YouTube Channel
              </Typography>
              <Typography variant="body2" style={{ lineHeight: 1.55 }}>
                Authorize YouTube Analytics access to view your channel performance
                and content insights.
              </Typography>
              <Button
                variant="youtube"
                fullWidth
                onClick={onConnect}
                disabled={isConnectingChannel}
              >
                {isConnectingChannel ? (
                  <>
                    <Spinner size={18} />
                    Connecting…
                  </>
                ) : (
                  "Connect YouTube"
                )}
              </Button>
              <Typography variant="caption">
                We only request read access to your analytics data.
              </Typography>
            </>
          ) : (
            <>
              <Typography variant="h6" style={{ fontWeight: 600 }}>
                No Channels Connected
              </Typography>
              <Typography variant="body2" style={{ lineHeight: 1.55 }}>
                Only organization owners and admins can add YouTube channels.
                Please ask your organization owner or admin to connect channels
                so you can view analytics here.
              </Typography>
              <Alert severity="info">
                <AlertDescription>
                  Adding channels is restricted to your organization&apos;s owner
                  and admins.
                </AlertDescription>
              </Alert>
            </>
          )}
        </Stack>
      </Card>
    </Flex>
  );
};

export default DashboardConnectState;
