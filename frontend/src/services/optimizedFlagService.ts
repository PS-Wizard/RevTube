/**
 * Default "Optimized" lists for audits.
 *
 * One default saved list per audit kind per workspace (personal user or org):
 *   - `optimized_video`      -> Video Audit picks
 *   - `optimized_thumbnail`  -> Thumbnail Optimizer picks
 *   - `optimized_playlist`   -> Playlist Optimizer picks
 *
 * Lists live in the standard saved-list collections (personal:
 * users/{uid}/savedLists, org: organizations/{orgId}/lists), so they also show
 * up wherever saved lists already appear. Each list keeps `itemsMeta` (title,
 * thumbnailUrl, addedAt) so the optimized-list viewer can sort/filter without
 * extra fetches.
 */
import {
  getOrganizationLists,
  saveOrganizationList,
} from "./organizationListService";
import type { SavedList } from "./savedListService";
import { getUserLists, saveList } from "./savedListService";

export type OptimizedKind = "video" | "thumbnail" | "playlist";

/**
 * The individual optimization fields tracked per video in the Video Management
 * page. Each is an independent toggle so a video can be "optimized" on some
 * aspects (e.g. thumbnail + description) and still pending on others.
 */
export type OptimizedField =
  | "thumbnail"
  | "titleKeywords"
  | "description"
  | "tags"
  | "playlist"
  | "cta";

export interface OptimizedFieldDef {
  value: OptimizedField;
  label: string;
  /** Short tooltip describing what "optimized" means for this field. */
  hint: string;
}

export const OPTIMIZED_FIELD_DEFS: readonly OptimizedFieldDef[] = [
  {
    value: "thumbnail",
    label: "Thumbnail",
    hint: "Click-worthy, on-brand thumbnail",
  },
  {
    value: "titleKeywords",
    label: "Title Keywords",
    hint: "SEO keywords embedded in the title",
  },
  {
    value: "description",
    label: "Description",
    hint: "Optimized description & links",
  },
  { value: "tags", label: "Tags", hint: "Relevant tags applied" },
  {
    value: "playlist",
    label: "Playlist",
    hint: "Added to an optimized playlist",
  },
  {
    value: "cta",
    label: "CTA",
    hint: "Call-to-action added (end screen / description card)",
  },
];

export const OPTIMIZED_FIELD_VALUES: readonly OptimizedField[] =
  OPTIMIZED_FIELD_DEFS.map((f) => f.value);

/** Per-field optimization status stored on each managed video's itemsMeta. */
export type OptimizedFields = Partial<Record<OptimizedField, boolean>>;

interface KindMeta {
  listName: string;
  /** SavedList.listType the dashboard already understands */
  listType: "video" | "playlist";
}

const KIND_META: Record<OptimizedKind, KindMeta> = {
  video: { listName: "Optimized — Video Audit", listType: "video" },
  thumbnail: { listName: "Optimized — Thumbnail Audit", listType: "video" },
  playlist: { listName: "Optimized — Playlist Audit", listType: "playlist" },
};

export const OPTIMIZED_KINDS: OptimizedKind[] = [
  "video",
  "thumbnail",
  "playlist",
];

const LIST_IDS: Record<OptimizedKind, string> = {
  video: "optimized_video",
  thumbnail: "optimized_thumbnail",
  playlist: "optimized_playlist",
};

export interface OptimizedScope {
  uid: string;
  organizationId?: string | null;
}

export type OptimizedItemMeta = {
  title?: string;
  thumbnailUrl?: string;
  addedAt: number;
  /** Per-field optimization status (Video Management toggles). */
  fields?: OptimizedFields;
  /** True when the item was flagged "Optimized" during an audit run (vs added manually). */
  fromAudit?: boolean;
};

function emptyList(kind: OptimizedKind): SavedList {
  return {
    id: LIST_IDS[kind],
    name: KIND_META[kind].listName,
    listType: KIND_META[kind].listType,
    videoIds: [],
    ...(KIND_META[kind].listType === "playlist" ? { playlistIds: [] } : {}),
    color: "#0ea5e9",
    createdAt: Date.now(),
  };
}

function persistList(
  scope: OptimizedScope,
  list: SavedList,
): Promise<SavedList> {
  return scope.organizationId
    ? saveOrganizationList(scope.organizationId, list, scope.uid)
    : saveList(scope.uid, list);
}

/**
 * Mirror thumbnail-audit picks into the Video Management (`video`) list so the
 * Optimized Content page shows the video with its Thumbnail field checked.
 * The `thumbnail` list stays the source of truth for the Thumbnail Optimizer
 * toggles; this only ensures the shared video list carries the same signal.
 */
async function mirrorThumbnailIntoVideoList(
  scope: OptimizedScope,
  videoList: SavedList | null,
  ids: string[],
  meta?: Record<string, OptimizedItemMeta>,
  fromAudit: boolean = false,
): Promise<void> {
  const existing = videoList ?? emptyList("video");
  existing.videoIds = [...(existing.videoIds ?? [])];
  const itemsMeta = { ...(existing.itemsMeta ?? {}) } as Record<
    string,
    OptimizedItemMeta
  >;
  for (const id of ids) {
    if (!existing.videoIds.includes(id)) existing.videoIds.push(id);
    const item = itemsMeta[id] ?? { addedAt: Date.now() };
    const m = meta?.[id];
    itemsMeta[id] = {
      ...item,
      ...(m?.title ? { title: m.title } : {}),
      ...(m?.thumbnailUrl ? { thumbnailUrl: m.thumbnailUrl } : {}),
      addedAt: item.addedAt ?? Date.now(),
      ...(fromAudit ? { fromAudit: true } : {}),
      fields: { ...(item.fields ?? {}), thumbnail: true },
    };
  }
  await persistList(scope, { ...existing, itemsMeta });
}

/** Clear the Thumbnail field on mirrored video-list entries (keeps the entry). */
async function unmirrorThumbnailFromVideoList(
  scope: OptimizedScope,
  videoList: SavedList | null,
  ids: string[],
): Promise<void> {
  if (!videoList) return;
  const itemsMeta = { ...(videoList.itemsMeta ?? {}) } as Record<
    string,
    OptimizedItemMeta
  >;
  let touched = false;
  for (const id of ids) {
    const item = itemsMeta[id];
    if (item?.fields?.thumbnail) {
      itemsMeta[id] = { ...item, fields: { ...item.fields, thumbnail: false } };
      touched = true;
    }
  }
  if (touched) await persistList(scope, { ...videoList, itemsMeta });
}

/**
 * Mirror the Video Management Thumbnail checkbox into the `thumbnail` list so
 * the Thumbnail Optimizer toggles reflect the same state.
 */
async function syncThumbnailListForField(
  scope: OptimizedScope,
  thumbList: SavedList | null,
  videoId: string,
  value: boolean,
  meta?: { title?: string; thumbnailUrl?: string },
): Promise<void> {
  const existing = thumbList ?? emptyList("thumbnail");
  existing.videoIds = [...(existing.videoIds ?? [])];
  const itemsMeta = { ...(existing.itemsMeta ?? {}) } as Record<
    string,
    OptimizedItemMeta
  >;
  if (value) {
    if (!existing.videoIds.includes(videoId)) existing.videoIds.push(videoId);
    const item = itemsMeta[videoId] ?? { addedAt: Date.now() };
    itemsMeta[videoId] = {
      ...item,
      ...(meta?.title ? { title: meta.title } : {}),
      ...(meta?.thumbnailUrl ? { thumbnailUrl: meta.thumbnailUrl } : {}),
      addedAt: item.addedAt ?? Date.now(),
    };
    await persistList(scope, { ...existing, itemsMeta });
  } else if (existing.videoIds.includes(videoId)) {
    existing.videoIds = existing.videoIds.filter((id) => id !== videoId);
    delete itemsMeta[videoId];
    await persistList(scope, { ...existing, itemsMeta });
  }
}
/** The three default optimized lists for the workspace (null = not created yet). */
export async function getAllOptimizedLists(
  scope: OptimizedScope,
): Promise<Record<OptimizedKind, SavedList | null>> {
  try {
    const all = scope.organizationId
      ? await getOrganizationLists(scope.organizationId)
      : await getUserLists(scope.uid);
    return {
      video: all.find((l) => l.id === LIST_IDS.video) ?? null,
      thumbnail: all.find((l) => l.id === LIST_IDS.thumbnail) ?? null,
      playlist: all.find((l) => l.id === LIST_IDS.playlist) ?? null,
    };
  } catch (error) {
    console.error("[optimizedFlag] Failed loading lists:", error);
    return { video: null, thumbnail: null, playlist: null };
  }
}

/**
 * Merge ids into the default optimized list for `kind`.
 * Titles, when provided, feed the list viewer's search/sort.
 */
export async function markOptimized(
  scope: OptimizedScope,
  kind: OptimizedKind,
  ids: string[],
  meta?: Record<string, OptimizedItemMeta>,
  /**
   * When true (the audit-flag path), tag each item with `fromAudit` so the list
   * can show a "optimized from audit" indicator distinct from manual adds.
   */
  fromAudit: boolean = false,
): Promise<SavedList> {
  if (!Array.isArray(ids) || ids.length === 0)
    throw new Error("No ids to mark");
  const all = await getAllOptimizedLists(scope);
  const existing = all[kind] ?? emptyList(kind);

  const itemsMeta = { ...(existing.itemsMeta ?? {}) } as Record<
    string,
    OptimizedItemMeta
  >;
  const isPlaylist = KIND_META[kind].listType === "playlist";

  if (isPlaylist) {
    existing.playlistIds = [
      ...new Set([...(existing.playlistIds ?? []), ...ids]),
    ];
  } else {
    existing.videoIds = [...new Set([...(existing.videoIds ?? []), ...ids])];
  }
  for (const id of ids) {
    itemsMeta[id] = {
      ...(itemsMeta[id] ?? {}),
      ...(meta?.[id] ?? {}),
      addedAt: itemsMeta[id]?.addedAt ?? Date.now(),
      ...(fromAudit ? { fromAudit: true } : {}),
    };
  }

  const updated: SavedList = { ...existing, itemsMeta };

  const saved = await persistList(scope, updated);
  if (kind === "thumbnail") {
    // Keep the Optimized Content page in sync: the video appears there with
    // its Thumbnail field checked. A mirror failure must not fail the
    // primary mark, so it is best-effort.
    await mirrorThumbnailIntoVideoList(
      scope,
      all.video,
      ids,
      meta,
      fromAudit,
    ).catch((err) =>
      console.error("[optimizedFlag] thumbnail->video mirror failed:", err),
    );
  }
  return saved;
}

/** Remove ids from the default optimized list for `kind`. */
export async function unmarkOptimized(
  scope: OptimizedScope,
  kind: OptimizedKind,
  ids: string[],
): Promise<SavedList> {
  const all = await getAllOptimizedLists(scope);
  const existing = all[kind] ?? emptyList(kind);
  const isPlaylist = KIND_META[kind].listType === "playlist";
  const removeSet = new Set(ids);

  if (isPlaylist && existing.playlistIds) {
    existing.playlistIds = existing.playlistIds.filter(
      (id) => !removeSet.has(id),
    );
  } else if (!isPlaylist && existing.videoIds) {
    existing.videoIds = existing.videoIds.filter((id) => !removeSet.has(id));
  }

  const itemsMeta = { ...(existing.itemsMeta ?? {}) } as Record<
    string,
    OptimizedItemMeta
  >;
  for (const id of ids) delete itemsMeta[id];

  const updated: SavedList = { ...existing, itemsMeta };
  const saved = await persistList(scope, updated);
  if (kind === "thumbnail") {
    await unmirrorThumbnailFromVideoList(scope, all.video, ids).catch((err) =>
      console.error("[optimizedFlag] thumbnail->video unmirror failed:", err),
    );
  }
  return saved;
}

/**
 * Set the optimization status of a single field for one video in the Video
 * Management list. Ensures the video is present in the list (so a field can be
 * toggled even before it was otherwise flagged), then persists just that field.
 */
export async function setVideoFieldStatus(
  scope: OptimizedScope,
  videoId: string,
  field: OptimizedField,
  value: boolean,
  meta?: { title?: string; thumbnailUrl?: string },
): Promise<SavedList> {
  const all = await getAllOptimizedLists(scope);
  const existing = all.video ?? emptyList("video");

  existing.videoIds = existing.videoIds ?? [];
  if (!existing.videoIds.includes(videoId)) existing.videoIds.push(videoId);

  const itemsMeta = { ...(existing.itemsMeta ?? {}) } as Record<
    string,
    OptimizedItemMeta
  >;
  const item = itemsMeta[videoId] ?? { addedAt: Date.now() };
  itemsMeta[videoId] = {
    ...item,
    ...(meta ?? {}),
    addedAt: item.addedAt ?? Date.now(),
    fields: { ...(item.fields ?? {}), [field]: value },
  };

  const updated: SavedList = { ...existing, itemsMeta };
  const saved = await persistList(scope, updated);
  if (field === "thumbnail") {
    // Keep the Thumbnail Optimizer toggles in sync with this checkbox.
    await syncThumbnailListForField(
      scope,
      all.thumbnail,
      videoId,
      value,
      meta,
    ).catch((err) =>
      console.error("[optimizedFlag] video->thumbnail mirror failed:", err),
    );
  }
  return saved;
}

/**
 * Bulk-set several optimization fields for one video in a single read-modify-write.
 * Used by the Video Audit "Mark All" toggle so firing the whole set at once does
 * not race (N concurrent setVideoFieldStatus calls could each read stale state
 * and clobber the others' writes).
 */
export async function setVideoFieldsStatus(
  scope: OptimizedScope,
  videoId: string,
  fields: OptimizedFields,
  meta?: { title?: string; thumbnailUrl?: string },
): Promise<SavedList> {
  const all = await getAllOptimizedLists(scope);
  const existing = all.video ?? emptyList("video");

  existing.videoIds = existing.videoIds ?? [];
  if (!existing.videoIds.includes(videoId)) existing.videoIds.push(videoId);

  const itemsMeta = { ...(existing.itemsMeta ?? {}) } as Record<
    string,
    OptimizedItemMeta
  >;
  const item = itemsMeta[videoId] ?? { addedAt: Date.now() };
  itemsMeta[videoId] = {
    ...item,
    ...(meta ?? {}),
    addedAt: item.addedAt ?? Date.now(),
    fields: { ...(item.fields ?? {}), ...fields },
  };

  const updated: SavedList = { ...existing, itemsMeta };
  const saved = await persistList(scope, updated);
  if ("thumbnail" in fields) {
    // Keep the Thumbnail Optimizer toggles in sync with this checkbox.
    await syncThumbnailListForField(
      scope,
      all.thumbnail,
      videoId,
      !!fields.thumbnail,
      meta,
    ).catch((err) =>
      console.error("[optimizedFlag] video->thumbnail mirror failed:", err),
    );
  }
  return saved;
}
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.hostname.includes("youtube.com") && u.pathname === "/watch")
      return u.searchParams.get("v");
    if (u.hostname === "youtu.be")
      return u.pathname.slice(1).split("/")[0] || null;
    if (u.hostname.includes("youtube.com") && u.pathname.startsWith("/shorts/"))
      return u.pathname.split("/")[2] || null;
  } catch {
    /* raw id */
  }
  return /^[a-zA-Z0-9_-]{11}$/.test(trimmed) ? trimmed : null;
}
