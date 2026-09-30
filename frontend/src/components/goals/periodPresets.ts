import type { PeriodPreset, GoalPeriodType } from '../../types/goals';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** Generate all period presets relative to today (current year + surrounding) */
export function buildPeriodPresets(referenceDate: Date = new Date()): PeriodPreset[] {
  const today = referenceDate;
  const year = today.getFullYear();
  const month = today.getMonth() + 1; // 1-indexed
  const dayOfWeek = today.getDay(); // 0=Sun
  const dayOfMonth = today.getDate();

  const presets: PeriodPreset[] = [];

  // ── Weekly: current week (Mon–Sun) + last week ────────────────────────────
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(today);
  weekStart.setDate(dayOfMonth + mondayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(weekStart.getDate() - 7);
  const lastWeekEnd = new Date(lastWeekStart);
  lastWeekEnd.setDate(lastWeekStart.getDate() + 6);

  const weekNum = getISOWeekNumber(weekStart);

  presets.push({
    label: `This Week (W${weekNum})`,
    periodType: 'weekly',
    periodKey: `${weekStart.getFullYear()}-W${pad2(weekNum)}`,
    startDate: isoDate(weekStart.getFullYear(), weekStart.getMonth() + 1, weekStart.getDate()),
    endDate: isoDate(weekEnd.getFullYear(), weekEnd.getMonth() + 1, weekEnd.getDate()),
  });

  presets.push({
    label: `Last Week (W${getISOWeekNumber(lastWeekStart)})`,
    periodType: 'weekly',
    periodKey: `${lastWeekStart.getFullYear()}-W${pad2(getISOWeekNumber(lastWeekStart))}`,
    startDate: isoDate(lastWeekStart.getFullYear(), lastWeekStart.getMonth() + 1, lastWeekStart.getDate()),
    endDate: isoDate(lastWeekEnd.getFullYear(), lastWeekEnd.getMonth() + 1, lastWeekEnd.getDate()),
  });

  // ── Monthly: current + last ───────────────────────────────────────────────
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  presets.push({
    label: `This Month (${months[month - 1]} ${year})`,
    periodType: 'monthly',
    periodKey: `${year}-${pad2(month)}`,
    startDate: isoDate(year, month, 1),
    endDate: isoDate(year, month, daysInMonth(year, month)),
  });

  const lastMonthNum = month === 1 ? 12 : month - 1;
  const lastMonthYear = month === 1 ? year - 1 : year;
  presets.push({
    label: `Last Month (${months[lastMonthNum - 1]} ${lastMonthYear})`,
    periodType: 'monthly',
    periodKey: `${lastMonthYear}-${pad2(lastMonthNum)}`,
    startDate: isoDate(lastMonthYear, lastMonthNum, 1),
    endDate: isoDate(lastMonthYear, lastMonthNum, daysInMonth(lastMonthYear, lastMonthNum)),
  });

  // ── 90 days ───────────────────────────────────────────────────────────────
  const ninetyEnd = new Date(today);
  const ninetyStart = new Date(today);
  ninetyStart.setDate(dayOfMonth - 89);

  presets.push({
    label: 'Last 90 Days',
    periodType: '90_days',
    periodKey: `90d-${isoDate(year, month, dayOfMonth)}`,
    startDate: isoDate(ninetyStart.getFullYear(), ninetyStart.getMonth() + 1, ninetyStart.getDate()),
    endDate: isoDate(ninetyEnd.getFullYear(), ninetyEnd.getMonth() + 1, ninetyEnd.getDate()),
  });

  // ── Quarterly: Q1–Q4 for current year + next Q if relevant ───────────────
  const quarters = [
    { label: 'Q1', start: [1, 1], end: [3, 31] },
    { label: 'Q2', start: [4, 1], end: [6, 30] },
    { label: 'Q3', start: [7, 1], end: [9, 30] },
    { label: 'Q4', start: [10, 1], end: [12, 31] },
  ];

  for (const q of quarters) {
    const qStartM = q.start[0];
    const qStartD = q.start[1];
    const qEndM = q.end[0];
    const qEndD = daysInMonth(year, qEndM);

    presets.push({
      label: `${q.label} ${year}`,
      periodType: 'quarterly',
      periodKey: `${year}-${q.label}`,
      startDate: isoDate(year, qStartM, qStartD),
      endDate: isoDate(year, qEndM, qEndD),
    });
  }

  // Also add Q1 next year
  presets.push({
    label: `Q1 ${year + 1}`,
    periodType: 'quarterly',
    periodKey: `${year + 1}-Q1`,
    startDate: isoDate(year + 1, 1, 1),
    endDate: isoDate(year + 1, 3, 31),
  });

  // ── Half-Year ─────────────────────────────────────────────────────────────
  presets.push({
    label: `H1 ${year}`,
    periodType: 'half_yearly',
    periodKey: `${year}-H1`,
    startDate: isoDate(year, 1, 1),
    endDate: isoDate(year, 6, 30),
  });

  presets.push({
    label: `H2 ${year}`,
    periodType: 'half_yearly',
    periodKey: `${year}-H2`,
    startDate: isoDate(year, 7, 1),
    endDate: isoDate(year, 12, 31),
  });

  // ── Yearly ────────────────────────────────────────────────────────────────
  presets.push({
    label: `Full Year ${year}`,
    periodType: 'yearly',
    periodKey: `${year}`,
    startDate: isoDate(year, 1, 1),
    endDate: isoDate(year, 12, 31),
  });

  presets.push({
    label: `Full Year ${year + 1}`,
    periodType: 'yearly',
    periodKey: `${year + 1}`,
    startDate: isoDate(year + 1, 1, 1),
    endDate: isoDate(year + 1, 12, 31),
  });

  return presets;
}

export function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export const PERIOD_TYPE_ORDER: GoalPeriodType[] = [
  'weekly',
  'monthly',
  '90_days',
  'quarterly',
  'half_yearly',
  'yearly',
  'custom',
];
