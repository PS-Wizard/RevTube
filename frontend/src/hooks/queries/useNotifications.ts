import { useQuery } from "@tanstack/react-query";
import { getNotifications } from "../../services/notificationService";

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: getNotifications,
    refetchInterval: 30_000,
    // Keep polling while the tab is backgrounded so OS notifications for
    // completed audits/analyses still fire when the app is in another tab.
    refetchIntervalInBackground: true,
    staleTime: 15_000,
  });
}
