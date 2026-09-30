import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  MdTrackChanges,
  MdAdd,
  MdHelpOutline,
  MdFilterList,
  MdCheckCircleOutline,
  MdTrendingUp,
  MdTrendingFlat,
  MdTrendingDown,
  MdHighlightOff,
} from "react-icons/md";
import { toast } from "react-hot-toast";
import type {
  GoalPeriodType,
  CreateGoalInput,
  UpdateGoalInput,
} from "../../types/goals";
import { PERIOD_TYPE_LABELS } from "../../types/goals";
import {
  getGoals,
  createGoal,
  updateGoal,
  deleteGoal,
} from "../../services/goalsService";
import { useOrganization } from "../../hooks/useOrganization";
import { useAuth } from "../../hooks/useAuth";
import { GoalCard } from "../../components/goals/GoalCard";
import { CreateGoalModal } from "../../components/goals/CreateGoalModal";
import { PinToDashboardButton } from "../../components/dashboard/pin-to-dashboard";
import type { GoalWithAdaptive } from "../../types/goals";
import {
  Box,
  Button,
  Card,
  Flex,
  Grid,
  IconButton,
  SegmentedControl,
  Spinner,
  Stack,
  StatCard,
  ToggleChip,
  ShadcnTooltip as Tooltip,
  TooltipContent,
  TooltipTrigger,
  Typography,
  type StatCardTone,
} from "../../components/ui";
import { EmptyState } from "../../components/EmptyState";

type PeriodFilterTab = "all" | GoalPeriodType;
type StatusFilter =
  | "all"
  | "active"
  | "ahead"
  | "on_track"
  | "behind"
  | "met"
  | "missed"
  | "upcoming"
  | "has_anomalies";

const KPI_CONFIG: Array<{ label: string; key: string; tone: StatCardTone; icon: typeof MdTrackChanges }> = [
  {
    label: "Total Goals",
    key: "total",
    tone: "neutral",
    icon: MdTrackChanges,
  },
  {
    label: "Ahead / Growth",
    key: "ahead",
    tone: "success",
    icon: MdTrendingUp,
  },
  {
    label: "On Track",
    key: "onTrack",
    tone: "info",
    icon: MdTrendingFlat,
  },
  {
    label: "Behind / Decline",
    key: "behind",
    tone: "warning",
    icon: MdTrendingDown,
  },
  {
    label: "Goals Met",
    key: "met",
    tone: "success",
    icon: MdCheckCircleOutline,
  },
  {
    label: "Missed",
    key: "missed",
    tone: "destructive",
    icon: MdHighlightOff,
  },
];

const STATUS_FILTERS = [
  { key: "all", label: "All", title: "Show all goals" },
  {
    key: "active",
    label: "In Progress",
    title: "Goals currently within their active date range",
  },
  {
    key: "ahead",
    label: "Ahead of Pace",
    title: "Current velocity exceeds required pace to hit target",
  },
  {
    key: "on_track",
    label: "On Track",
    title: "Current velocity is close to required pace (within ~10%)",
  },
  {
    key: "behind",
    label: "Behind Pace",
    title: "Current velocity falls short of required pace",
  },
  {
    key: "met",
    label: "Met",
    title: "Completed goals that reached or exceeded their target",
  },
  {
    key: "missed",
    label: "Missed",
    title: "Completed goals that fell short of their target",
  },
  {
    key: "upcoming",
    label: "Upcoming",
    title: "Goals that haven't started yet (future start date)",
  },
  {
    key: "has_anomalies",
    label: "Has Anomalies",
    title: "Goals with detected statistical outliers/spikes",
  },
] as const;

const HELP_TEXT = [
  "Goals & Pacing System Overview:",
  "",
  "• Real-time pacing vs. actual target tracking across channels",
  "• Metrics: Views, Subscribers, CTR, Engagement Rate, Retention",
  "• Time Horizons: Weekly, Monthly, 90 Days, Quarterly, Half-Year, Yearly, Custom",
  "",
  "• Pacing Logic: Compares current velocity with target rate to predict final completion state",
  "• Sub-frames: Auto-calculates interim targets for weeks, months, and quarters",
].join("\n");

export function GoalsPage(): React.ReactElement {
  const { currentOrganization, isPersonalContext, canEdit } = useOrganization();
  const { user } = useAuth();

  // Primitive org id (null in personal context) — kept as a stable value so
  // memoized callbacks can depend on it directly instead of the org object.
  const organizationId = isPersonalContext
    ? null
    : (currentOrganization?.id ?? null);

  const [channelId, setChannelId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("selectedChannel_last");
    } catch {
      return null;
    }
  });

  const readStoredChannel = useCallback((): string | null => {
    try {
      const scopedKey =
        user && !isPersonalContext && organizationId
          ? `selectedChannel_org_${organizationId}`
          : user
            ? `selectedChannel_personal_${user.uid}`
            : null;
      const scoped = scopedKey ? localStorage.getItem(scopedKey) : null;
      return scoped || localStorage.getItem("selectedChannel_last");
    } catch {
      return null;
    }
  }, [user, isPersonalContext, organizationId]);

  useEffect(() => {
    // Defer to a microtask: setState must not be called synchronously from the
    // effect body, which triggers the cascading-renders lint rule.
    Promise.resolve().then(() => setChannelId(readStoredChannel()));
  }, [readStoredChannel]);

  const [goals, setGoals] = useState<GoalWithAdaptive[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activePeriodTab, setActivePeriodTab] =
    useState<PeriodFilterTab>("all");
  const [activeStatusFilter, setActiveStatusFilter] =
    useState<StatusFilter>("all");
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingGoal, setEditingGoal] = useState<GoalWithAdaptive | null>(null);

  useEffect(() => {
    const handleChannelChange = () => setChannelId(readStoredChannel());
    window.addEventListener("channelChanged", handleChannelChange);
    return () =>
      window.removeEventListener("channelChanged", handleChannelChange);
  }, [readStoredChannel]);

  const loadGoals = useCallback(async () => {
    if (!channelId) {
      setGoals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getGoals(channelId, organizationId);
      setGoals(data as GoalWithAdaptive[]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch goals");
    } finally {
      setLoading(false);
    }
  }, [channelId, organizationId]);

  useEffect(() => {
    // Defer to a microtask: loadGoals() sets state synchronously, which triggers
    // the cascading-renders lint rule when called directly from the effect body.
    Promise.resolve().then(() => loadGoals());
  }, [loadGoals]);

  const handleSaveGoal = async (input: CreateGoalInput | UpdateGoalInput) => {
    try {
      if (editingGoal) {
        await updateGoal(
          editingGoal.id,
          input as UpdateGoalInput,
          organizationId,
        );
        toast.success("Goal updated successfully");
      } else {
        await createGoal(input as CreateGoalInput, organizationId);
        toast.success("Goal created successfully");
      }
      setIsModalOpen(false);
      setEditingGoal(null);
      await loadGoals();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save goal");
      throw err;
    }
  };

  const handleDeleteGoal = async (goal: GoalWithAdaptive) => {
    try {
      await deleteGoal(goal.id, organizationId);
      toast.success("Goal deleted");
      setGoals((prev) => prev.filter((g) => g.id !== goal.id));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete goal");
    }
  };

  const filteredGoals = useMemo(
    () =>
      goals.filter((goal) => {
        if (activePeriodTab !== "all" && goal.periodType !== activePeriodTab)
          return false;
        if (activeStatusFilter === "all") return true;
        if (activeStatusFilter === "active") return goal.isActive;
        if (activeStatusFilter === "has_anomalies")
          return goal.anomalies && goal.anomalies.length > 0;
        return goal.status === activeStatusFilter;
      }),
    [goals, activePeriodTab, activeStatusFilter],
  );

  const kpiStats = useMemo(() => {
    let met = 0,
      ahead = 0,
      onTrack = 0,
      behind = 0,
      missed = 0,
      upcoming = 0;
    for (const g of goals) {
      if (g.isPast) {
        if (g.status === "met") met++;
        else missed++;
      } else if (g.isUpcoming) {
        upcoming++;
      } else if (g.isActive) {
        if (g.status === "met") met++;
        else if (g.status === "ahead") ahead++;
        else if (g.status === "on_track") onTrack++;
        else if (g.status === "behind") behind++;
      }
    }
    return {
      total: goals.length,
      met,
      ahead,
      onTrack,
      behind,
      missed,
      upcoming,
    };
  }, [goals]);

  const getTabCount = (tab: PeriodFilterTab) =>
    tab === "all"
      ? goals.length
      : goals.filter((g) => g.periodType === tab).length;

  return (
    <div className="page-container goals-page">
      {/* Header Section */}
      <header className="page-header page-header--split">
        <div>
          <Flex alignItems="center" gap={1}>
            <MdTrackChanges size={20} style={{ color: "var(--primary)" }} />
            <h1>Performance Goals &amp; Pacing</h1>
          </Flex>
          <p className="page-description">
            Track performance targets, monitor real-time velocity, and evaluate
            pacing against channel milestones.
          </p>
        </div>

        <Flex alignItems="center" gap={1.5} sx={{ alignSelf: { xs: "flex-start", sm: "auto" } }}>
          <PinToDashboardButton widgetId="goals" />
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton aria-label="Goals system documentation">
                <MdHelpOutline size={19} />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent style={{ maxWidth: "20rem", whiteSpace: "pre-wrap", padding: 12 }}>
              {HELP_TEXT}
            </TooltipContent>
          </Tooltip>

          {canEdit && (
            <Button
              variant="primary"
              onClick={() => {
                setEditingGoal(null);
                setIsModalOpen(true);
              }}
            >
              <MdAdd size={20} />
              <span>Set New Goal</span>
            </Button>
          )}
        </Flex>
      </header>

      <div className="page-body">

      {/* KPI Stats Grid — 2 per row on phones, 3 per row (2 balanced rows) from sm up */}
      <Grid container spacing={1.5}>
        {KPI_CONFIG.map(({ label, key, tone, icon: Icon }) => (
          <Grid key={key} size={{ xs: 6, sm: 4 }}>
            <StatCard
              tone={tone}
              label={label}
              value={kpiStats[key as keyof typeof kpiStats]}
              icon={<Icon size={16} />}
            />
          </Grid>
        ))}
      </Grid>

      {/* Filter Options */}
      <Card size="sm" style={{ backgroundColor: "color-mix(in srgb, var(--card) 30%, transparent)" }}>
        <Stack gap={2}>
          {/* Horizon Tabs */}
          <Flex wrap alignItems="center" gap={0.75} role="tablist" aria-label="Goal Time Horizons" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
            <SegmentedControl
              wrap
              ariaLabel="Goal Time Horizons"
              value={activePeriodTab}
              onChange={(v) => setActivePeriodTab(v as PeriodFilterTab)}
              options={[
                "all",
                "weekly",
                "monthly",
                "90_days",
                "quarterly",
                "half_yearly",
                "yearly",
              ].map((tab) => ({
                value: tab,
                label:
                  tab === "all"
                    ? "All Horizons"
                    : PERIOD_TYPE_LABELS[tab as GoalPeriodType],
                count: getTabCount(tab as PeriodFilterTab),
              }))}
            />
          </Flex>

          {/* Status Filters */}
          <Flex wrap alignItems="center" gap={1} role="toolbar" aria-label="Status Filters">
            <Flex alignItems="center" gap={0.75} style={{ paddingRight: 8 }}>
              <MdFilterList size={14} />
              <Typography variant="caption" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Filter Status
              </Typography>
            </Flex>
            {STATUS_FILTERS.map((s) => (
              <Tooltip key={s.key}>
                <TooltipTrigger asChild>
                  <ToggleChip
                    tone="primary"
                    pressed={activeStatusFilter === s.key}
                    label={s.label}
                    onPressedChange={() => setActiveStatusFilter(s.key as StatusFilter)}
                  />
                </TooltipTrigger>
                <TooltipContent>{s.title}</TooltipContent>
              </Tooltip>
            ))}
          </Flex>
        </Stack>
      </Card>

      {/* Main Grid Content */}
      {loading ? (
        <Box style={{ border: '1px dashed var(--border)', borderRadius: 12, backgroundColor: 'color-mix(in srgb, var(--card) 20%, transparent)', paddingBlock: 96 }}>
          <Stack alignItems="center" justifyContent="center" gap={1.5}>
            <Spinner size={32} />
            <Typography variant="subtitle2">
              Calculating goal metrics and current pacing...
            </Typography>
          </Stack>
        </Box>
      ) : filteredGoals.length > 0 ? (
        <Grid container spacing={2.5}>
          {filteredGoals.map((goal) => (
            <Grid key={goal.id} item xs={12} md={6} lg={4}>
              <GoalCard
                goal={goal}
                canEdit={canEdit}
                onEdit={(g) => {
                  setEditingGoal(g);
                  setIsModalOpen(true);
                }}
                onDelete={handleDeleteGoal}
              />
            </Grid>
          ))}
        </Grid>
      ) : (
        <EmptyState
          variant={goals.length === 0 ? "zero" : "no-results"}
          title={
            goals.length === 0 ? "No Goals Configured" : "No Matching Goals"
          }
          description={
            goals.length === 0
              ? "Establish views, subscriber growth, engagement, or custom performance targets to monitor real-time channel progress."
              : "Adjust your horizon filters or status conditions to view other performance targets."
          }
          action={
            goals.length === 0 && canEdit ? (
              <Box sx={{ mt: 1 }}>
                <Button
                  variant="primary"
                  style={{ fontWeight: 600 }}
                  onClick={() => {
                    setEditingGoal(null);
                    setIsModalOpen(true);
                  }}
                >
                  <MdAdd size={18} />
                  Create First Goal
                </Button>
              </Box>
            ) : undefined
          }
        />
      )}

      {/* Modal Container */}
      {channelId && (
        <CreateGoalModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingGoal(null);
          }}
          onSubmit={handleSaveGoal}
          editingGoal={editingGoal}
          channelId={channelId}
          organizationId={organizationId}
        />
      )}
      </div>
    </div>
  );
}
