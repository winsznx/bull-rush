# ADR 0013: Structured logging, metrics, and the status surface

## Status
Accepted

## Context
Through Phase 12 the service logged via scattered `console.*` calls (unstructured, unparseable,
no levels) and had no request metrics, no error accounting, and no way for anyone — operator or
player — to ask "is the backend healthy?" without hitting a gameplay endpoint. Phase 13 adds the
observability layer, scoped to what is real and testable now: no external APM/error-tracking
account exists, so nothing is built against one.

## Decisions

**Hand-rolled JSON logger, pino-shaped interface.** One JSON object per line on stdout/stderr —
what Railway (and every aggregator) ingests natively. The interface mirrors pino
(`log.info(fields, msg)`, `log.child(ctx)`) so swapping in pino later is mechanical; at this
service's volume, pino's actual advantages (throughput, transports) buy nothing yet, and ~60
dependency-free lines are fully auditable. Levels honor `LOG_LEVEL`; errors go to stderr.

**Redaction is the logger's job, not call-site discipline.** Any field whose *name* looks
credential-like (`token`, `secret`, `signature`, `password`, `cookie`, `authorization`,
`private`, `*key`) is masked recursively, wherever it appears — a leaked log stream must never
be a session dump. `Error` objects serialize to name/message/stack; depth is capped so a cyclic
or pathological object can't wedge a log call. This is the security-relevant part, so it is the
unit-tested part.

**Request metrics in Redis, with bounded cardinality.** Every `/api/*` request records a count
(`method:route:statusClass`) and a fixed-bucket duration histogram — after the route is
normalized (`/api/grid/<uuid>/ghost` → `/api/grid/:id/ghost`), so key cardinality cannot grow
with data. Recording is fire-and-forget: metrics must never add latency or a failure mode to
the request path. Redis (not in-process) so counters survive restarts and aggregate across
replicas. A real TSDB/Prometheus stays a deliberate non-goal until traffic justifies it — the
admin snapshot (`GET /api/admin/metrics`, read role) answers today's actual question, "is
anything slow or erroring, and how much."

**Error tracking = structured events + counters + honest crash semantics.** `app.onError`
turns any unhandled route error into one structured event with stack + a counted metric + an
opaque 500 (stacks never reach responses). `unhandledRejection` logs and counts but does not
exit; `uncaughtException` logs, counts, and **exits** — state past that point is unknowable,
and the platform's restart is the correct recovery. No Sentry integration: there is no DSN to
test against, and per this project's standing rule, nothing gets built that can't be genuinely
exercised.

**Public `/status`: real round-trips, non-sensitive by construction.** `SELECT 1` against
Postgres and `PING` against Redis with measured latencies, uptime, game version/ruleset hash,
and whether the relayer is configured — 503 when a dependency fails. No counts, no keys, no
internal addresses. This is the "status page" substance; a styled page can render this JSON
later without server changes.

**`migrate.ts` keeps `console.log`.** It's a CLI whose output is read by the human running it,
not a service emitting telemetry — JSON lines there would be worse.

## Verification
- `logger.test.ts` (3, pure): credential-name masking including nested objects, Error
  serialization, array/depth safety.
- `metrics.integration.test.ts` (3, real Redis + Postgres): route normalization (UUID and
  numeric segments collapse), a recorded request lands in the right count key AND the right
  duration bucket and reads back in the snapshot, and `statusReport` returns genuine healthy
  round-trips with measured latencies.
- **Live over real HTTP**: the E2E script now (a) asserts `/status` reports healthy with both
  dependency round-trips before doing anything else, and (b) after the full loop, reads
  `GET /api/admin/metrics` and asserts its own grid submissions were counted (2 × 2xx — the
  honest run and the shadow-held perturbed copy, which is itself a correct 200). Structured
  request logs were inspected in the live server's output: one JSON line per API request with
  method/path/status/duration.
- Full regression: typechecks clean, `sim:check` clean, 97/97 unit (+3), 35/35 sim, 38/38
  integration (+3), full build.
