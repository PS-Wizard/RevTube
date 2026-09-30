import React from "react";
import { AlertTriangle, RotateCcw, SquarePlay } from "lucide-react";
import { Alert, AlertAction, AlertDescription, Button, Flex } from "../ui";

export interface DashboardErrorBannerProps {
  message: string;
  canReconnect: boolean;
  onRetry: () => void;
  onReauthorize: () => void;
}

/**
 * Dashboard-level error banner with Retry / Re-authorize actions.
 * Composed only from shared primitives — no page CSS.
 */
export const DashboardErrorBanner: React.FC<DashboardErrorBannerProps> = ({
  message,
  canReconnect,
  onRetry,
  onReauthorize,
}) => {
  return (
    <Alert severity="error" title="Something went wrong">
      <AlertTriangle size={16} />
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <Flex gap={1}>
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            <RotateCcw size={14} />
            Retry
          </Button>
          {canReconnect && (
            <Button
              type="button"
              onClick={onReauthorize}
              variant="secondary"
              size="sm"
            >
            <SquarePlay size={14} />
            Re-authorize
            </Button>
          )}
        </Flex>
      </AlertAction>
    </Alert>
  );
};

export default DashboardErrorBanner;
