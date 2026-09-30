import { z } from 'zod';

const columnHeaderSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  columnType: z.string(),
});

/** Exported for cache validation in analyticsService */
export const analyticsReportSchema = z.object({
  kind: z.string(),
  columnHeaders: z.array(columnHeaderSchema),
  rows: z.array(z.array(z.unknown())).optional(),
});

export type ParsedAnalyticsReport = z.infer<typeof analyticsReportSchema>;

export function parseAnalyticsReport(data: unknown, context: string): ParsedAnalyticsReport {
  const r = analyticsReportSchema.safeParse(data);
  if (!r.success) {
    console.warn(`[API] Invalid analytics report (${context})`, r.error.flatten());
    throw new Error(`Invalid analytics report response (${context})`);
  }
  return r.data;
}

const statPeriodSchema = z.object({
  current: z.record(z.unknown()),
  previous: z.record(z.unknown()),
});

export const dashboardBundleResponseSchema = z.object({
  latestDate: z.string(),
  current: analyticsReportSchema.nullable(),
  previous: analyticsReportSchema.nullable(),
  channelCurrent: analyticsReportSchema.nullable(),
  channelPrevious: analyticsReportSchema.nullable(),
  d7: statPeriodSchema,
  d30: statPeriodSchema,
  d90: statPeriodSchema,
});

export type ParsedDashboardBundle = z.infer<typeof dashboardBundleResponseSchema>;

export function parseDashboardBundleResponse(data: unknown): ParsedDashboardBundle {
  const r = dashboardBundleResponseSchema.safeParse(data);
  if (!r.success) {
    console.warn('[API] Invalid dashboard bundle', r.error.flatten());
    throw new Error('Invalid dashboard bundle response');
  }
  return r.data;
}

export const dashboardSummaryResponseSchema = z.object({
  latestDate: z.string(),
  d7: statPeriodSchema,
  d30: statPeriodSchema,
  d90: statPeriodSchema,
});

export type ParsedDashboardSummary = z.infer<typeof dashboardSummaryResponseSchema>;

export function parseDashboardSummaryResponse(data: unknown): ParsedDashboardSummary {
  const r = dashboardSummaryResponseSchema.safeParse(data);
  if (!r.success) {
    console.warn('[API] Invalid dashboard summary', r.error.flatten());
    throw new Error('Invalid dashboard summary response');
  }
  return r.data;
}

export const dimensionsBundleResponseSchema = z.object({
  trafficSource: analyticsReportSchema.nullable(),
  gender: analyticsReportSchema.nullable(),
  ageGroup: analyticsReportSchema.nullable(),
  subscribedStatus: analyticsReportSchema.nullable(),
  country: analyticsReportSchema.nullable(),
  deviceType: analyticsReportSchema.nullable(),
});

export type ParsedDimensionsBundle = z.infer<typeof dimensionsBundleResponseSchema>;

export function parseDimensionsBundleResponse(data: unknown): ParsedDimensionsBundle {
  const r = dimensionsBundleResponseSchema.safeParse(data);
  if (!r.success) {
    console.warn('[API] Invalid dimensions bundle', r.error.flatten());
    throw new Error('Invalid dimensions bundle response');
  }
  return r.data;
}

const youtubeTokenSchema = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresAt: z.number(),
    email: z.string(),
    channelId: z.string().optional(),
    channelTitle: z.string().optional(),
    thumbnailUrl: z.string().optional(),
    authorizedAt: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  plan: z.enum(['pro']),
});

const organizationMemberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  role: z.enum(['owner', 'admin', 'write', 'read']),
  joinedAt: z.number(),
  invitedBy: z.string(),
});

export const userInitResponseSchema = z.object({
  user: z
    .object({
      role: z.enum(['admin', 'user']).optional(),
      package: z.enum(['free', 'pro']).optional(),
    })
    .passthrough(),
  tokens: z.array(youtubeTokenSchema),
  organizations: z.array(organizationSchema),
  memberships: z.record(organizationMemberSchema),
});

export type ParsedUserInit = z.infer<typeof userInitResponseSchema>;

export function parseUserInitResponse(data: unknown): ParsedUserInit | null {
  const r = userInitResponseSchema.safeParse(data);
  if (!r.success) {
    console.warn('[API] Invalid user init', r.error.flatten());
    return null;
  }
  return r.data;
}

export const adminUserProfileSchema = z
  .object({
    uid: z.string(),
    email: z.string(),
    role: z.enum(['admin', 'user']),
    package: z.enum(['free', 'pro']),
  })
  .passthrough();

export const adminUsersListSchema = z.array(adminUserProfileSchema);

export type ParsedAdminUserProfile = z.infer<typeof adminUserProfileSchema>;

export function parseAdminUsersList(data: unknown): ParsedAdminUserProfile[] {
  const r = adminUsersListSchema.safeParse(data);
  if (!r.success) {
    console.warn('[API] Invalid admin users list', r.error.flatten());
    throw new Error('Invalid admin users response');
  }
  return r.data;
}