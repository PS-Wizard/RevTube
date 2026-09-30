const INGEST_LOOKBACK_DAYS = 730;
const INGEST_CHUNK_DAYS = 180;

function computeDateWindow(days = INGEST_LOOKBACK_DAYS) {
  const end = new Date();
  const start = new Date(end.getTime() - (Math.max(1, days) - 1) * 86400000);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

function addUtcDays(iso, n) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function splitDateWindows(startDate, endDate, chunkDays = INGEST_CHUNK_DAYS) {
  const windows = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const rawEnd = addUtcDays(cursor, chunkDays - 1);
    const chunkEnd = rawEnd < endDate ? rawEnd : endDate;
    windows.push({ startDate: cursor, endDate: chunkEnd });
    cursor = addUtcDays(chunkEnd, 1);
  }
  return windows;
}

module.exports = {
  INGEST_LOOKBACK_DAYS,
  INGEST_CHUNK_DAYS,
  computeDateWindow,
  splitDateWindows,
  addUtcDays,
};
