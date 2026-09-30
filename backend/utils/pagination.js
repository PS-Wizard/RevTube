/**
 * Shared offset-pagination slicer for catalog routes (dashboard videos /
 * playlists, explorer channel playlists).
 *
 * `hasMore` is exhaustion-aware: it compares the END of the returned slice
 * against the total, not the requested page size. A short/empty slice means
 * the catalog is exhausted even when a stale-high total claims otherwise --
 * without this, clients page into phantom empty pages forever ("loading"
 * that never completes).
 */
function paginateCatalog(items, { offset = 0, limit = 50, total } = {}) {
  const list = Array.isArray(items) ? items : [];
  const requestedLimit =
    typeof limit === "number" && limit > 0 ? Math.floor(limit) : 50;
  const parsedOffset =
    typeof offset === "number" && offset >= 0 ? Math.floor(offset) : 0;
  const totaldata =
    typeof total === "number" && total >= 0 ? Math.floor(total) : list.length;
  const currentPage = Math.floor(parsedOffset / requestedLimit) + 1;
  const totalpages = Math.max(1, Math.ceil(totaldata / requestedLimit));
  const sliced = list.slice(parsedOffset, parsedOffset + requestedLimit);
  // A short slice means the rows ran out (offset slicing has no gaps), so the
  // catalog is exhausted even when a stale-high total claims otherwise.
  // Without this, clients page into phantom empty pages forever ("loading"
  // that never completes).
  const hasMore =
    sliced.length === requestedLimit && parsedOffset + sliced.length < totaldata;
  return {
    sliced,
    pagination: {
      totaldata,
      currentpage: currentPage,
      perpageitem: requestedLimit,
      totalpages,
      hasMore,
    },
  };
}

module.exports = { paginateCatalog };
