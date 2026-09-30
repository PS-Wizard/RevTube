import {
  Grid,
  StatCard,
} from "@/components/ui";
import React from "react";
import { MdAddChart, MdAutoAwesome } from "react-icons/md";
import type { UseAnomalies } from "./useAnomalies";

export function KpiRow({ state }: { state: UseAnomalies }): React.ReactElement {
  const { counts } = state;
  return (
    <Grid container spacing={1.5}>
      <Grid size={{ xs: 6, sm: 3 }}>
        <StatCard
          tone="neutral"
          label="Total anomalies"
          value={counts.total}
          icon={<MdAddChart size={16} />}
        />
      </Grid>
      <Grid size={{ xs: 6, sm: 3 }}>
        <StatCard
          tone="warning"
          label="Open"
          value={counts.open}
          icon={<MdAddChart size={16} />}
        />
      </Grid>
      <Grid size={{ xs: 6, sm: 3 }}>
        <StatCard
          tone="destructive"
          label="Critical"
          value={counts.critical}
          icon={<MdAddChart size={16} />}
        />
      </Grid>
      <Grid size={{ xs: 6, sm: 3 }}>
        <StatCard
          tone="info"
          label="High"
          value={counts.high}
          icon={<MdAutoAwesome size={16} />}
        />
      </Grid>
    </Grid>
  );
}
