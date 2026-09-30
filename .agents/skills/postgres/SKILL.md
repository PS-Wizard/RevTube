---
name: postgres
description: PostgreSQL 16 analytics store for RevTube — snapshots, aggregation queries, indexes, migrations. Use for backend/db, ingestion/, or any analytics SQL.
---

# PostgreSQL (RevTube analytics)

## Role

PG = analytics + snapshots store (daily metrics, video/channel reads). Firestore = users/orgs/tokens/config. Redis = response cache. Don't cross roles.

## Conventions

- `snake_case` columns, parameterized queries via `pg` Pool only (never string-concatenate input).
- Migrations: `backend/db/migrations/NNN_description.sql`, alphabetical, transactional, run via `pnpm db:migrate` in `backend/`. Never edit an applied migration — add a new one.
- Reads go through `backend/ingestion/readModels.js` (`getVideosByIds` etc.) — postgres-first, YouTube fallback only on miss.

## Analytics query patterns

- Aggregate in SQL (`GROUP BY date/channel_id`, `SUM/AVG`), not in JS loops. Bucket time-series with `date_trunc` in the request tz, or return tz-tagged rows and bucket once.
- Nulls: preserve missing-vs-zero (`NULL` stays `NULL`; see zero-fill trap in `revtube-backend` skill).
- Indexes: `(channel_id, date)` for snapshot scans, video-ID lookups for `IN (...)` batches (chunked 50). Check `EXPLAIN` before adding an index; cron warms all channels every 6h so missing indexes hurt on schedule, not just on click.
