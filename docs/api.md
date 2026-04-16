# API Reference

## HTTP Endpoints

### `GET /api/health`

Health check. Returns subsystem status for database, environment, and ingestion freshness.

**Response** `200 | 503`:
```json
{
  "status": "healthy" | "degraded" | "unhealthy",
  "timestamp": "2026-04-16T12:00:00.000Z",
  "checks": {
    "database": { "ok": true, "latencyMs": 42 },
    "env": { "ok": true, "missing": [] },
    "ingestion": { "ok": true, "lastArticleAgeSec": 120 }
  }
}
```

- `unhealthy` (503): database or env failure
- `degraded` (200): ingestion stale (>10 min since last article)
- Each subsystem check has a 2s timeout

---

### `GET /api/metrics`

Live counts for articles, clusters, and sources.

**Response** `200` (cached 60s):
```json
{
  "timestamp": "...",
  "articles": { "total": 22000, "last24h": 850, "lastHour": 42, "politicsNullImage": 15, "withImage": 20500 },
  "clusters": { "total": 1200, "multiArticle": 980, "blindspots": 12, "avgArticlesPerCluster": 18.33 },
  "sources": { "total": 144, "active": 140 }
}
```

---

### `GET /api/admin`

Admin statistics. Not rate-limited (read-only).

**Response** `200`:
```json
{
  "articles": 22000,
  "sources": 144,
  "clusters": 1200,
  "missingImages": 150,
  "sourcesList": [{ "id": "...", "name": "Sabah", "slug": "sabah", "url": "...", "rss_url": "...", "bias": "pro_government", "active": true }]
}
```

---

### `POST /api/admin`

Admin actions. Rate limited: 20-token bucket, 0.2 tokens/sec refill.

**Actions** (via `body.action`):

| Action | Body fields | Description |
|---|---|---|
| `ingest` | — | Trigger RSS ingest (skips if worker active) |
| `backfill_images` | — | Fetch og:image for imageless articles |
| `nuke_articles` | — | Delete all articles + clusters |
| `nuke_clusters` | — | Delete all clusters (articles preserved) |
| `toggle_source` | `slug`, `active` | Enable/disable a source |
| `add_source` | `name`, `slug`, `url`, `rss_url`, `bias` | Add new source |
| `update_source` | `id`, + optional fields | Update source fields |
| `delete_source` | `id` | Delete source and its articles |

---

### `GET /api/cron/ingest`

Manual/cron RSS ingestion. Skips if the tmux worker inserted articles in the last 30s.

**Headers**: `Authorization: Bearer <CRON_SECRET>` (if `CRON_SECRET` is set)

**Rate limit**: 5-token bucket, 1 token/60s refill.

**Response** `200`:
```json
{
  "success": true,
  "totalInserted": 42,
  "totalOgFetched": 5,
  "totalErrors": 1,
  "sources": { "sabah": { "inserted": 3, "ogImages": 1 }, "diken": { "inserted": 0, "error": "timeout" } },
  "timestamp": "..."
}
```

---

### `GET /api/cron/backfill-images`

Fetches og:image for up to 30 imageless articles per call.

**Headers**: `Authorization: Bearer <CRON_SECRET>` (if set)

**Rate limit**: 5-token bucket, 1 token/60s refill.

---

### `POST /api/newsletter`

Newsletter email signup.

**Rate limit**: 5-token bucket, 1 token/30s refill.

**Body**: `{ "email": "user@example.com" }`

**Response**: `{ "success": true }` (also returns success for duplicates to avoid email enumeration)

---

### `GET /rss.xml`

RSS 2.0 feed of the top 30 politics clusters. Cached 5 minutes.

---

## Core Library Functions

### `getPoliticsClusters()`

```typescript
// src/lib/clusters/politics-query.ts
async function getPoliticsClusters(): Promise<PoliticsClustersResult>
```

Cached entry point for the home feed. Returns ranked `ClusterBundle[]` with:
- Politics-majority filter (≥60% politika/son_dakika)
- Same-source dedupe (earliest article per source kept)
- Wire redistribution detection (≥50% shared content_hash → collapsed)
- Source fairness cap (each source ≤10% of cluster article count)
- Importance ranking (article count, zone diversity, time decay, dominance penalty, velocity)

Cache: `cluster-feed` profile (30s), tag `clusters-politics`.

---

### `getClusterDetail(id)`

```typescript
// src/lib/clusters/cluster-detail-query.ts
async function getClusterDetail(id: string): Promise<ClusterDetail | null>
```

Returns full cluster detail with members and all 144 sources. Two parallel PostgREST round-trips. Returns `null` if cluster not found.

Cache: `cluster-feed` profile, tag `cluster-detail:{id}`.

**Return shape**:
```typescript
interface ClusterDetail {
  cluster: { id, title_tr, summary_tr, article_count, bias_distribution, is_blindspot, ... };
  members: Array<{ source: Source; article: { id, title, url, published_at, image_url } }>;
  allSources: Source[];  // all 144, for MediaDna grid
}
```

---

### `detectCrossSpectrum(memberSources, threshold?)`

```typescript
// src/lib/bias/cross-spectrum.ts
function detectCrossSpectrum(
  memberSources: Source[],
  dominantThreshold?: number  // default 0.65
): CrossSpectrumResult
```

Finds the dominant Medya DNA zone and any members from the opposite zone ("surprises").

**Guards**: ≥5 sources, ≥0.65 dominant share, ≥3 absolute margin between dominant and opposite zone.

```typescript
interface CrossSpectrumResult {
  dominantZone: MediaDnaZone | null;
  dominantPct: number;            // 0..1
  surpriseOutlets: Source[];      // opposite-zone members
  blindspotCandidate: boolean;    // true when dominantPct ≥ 0.85
}
```

---

### `summarizeSurprises(result, clusterTitle, max?)`

```typescript
function summarizeSurprises(result: CrossSpectrumResult, clusterTitle: string, max?: number): string[]
```

Renders Turkish blurbs like: `⚡ Sözcü (muhalefet) bu iktidara yakın habere yer verdi: "Headline"`. Returns `[]` when nothing to show.

---

### `fetchAllFeeds(sources)`

```typescript
// src/lib/rss/fetcher.ts
async function fetchAllFeeds(sources: Source[]): Promise<FetchResult[]>
```

Fetches all RSS feeds in parallel. Each result contains `{ source, items: RawFeedItem[], error? }`.

---

### `normalizeArticles(source, items)`

```typescript
// src/lib/rss/normalize.ts
function normalizeArticles(source: Source, items: RawFeedItem[]): NormalizedArticle[]
```

Normalizes raw RSS items: URL canonicalization, HTML entity decoding, image extraction, SHA256 content hashing, keyword-based category classification.

---

### `fetchOgImage(url)`

```typescript
// src/lib/rss/og-image.ts
async function fetchOgImage(url: string): Promise<string | null>
```

Fetches a page's `og:image` meta tag. Reads only the first 50KB (up to `</head>`). 8s timeout.

---

### `createRateLimiter(name, opts)`

```typescript
// src/lib/rate-limit.ts
function createRateLimiter(name: string, opts: {
  capacity: number;
  refillPerSecond: number;
}): (key: string) => { allowed: boolean; retryAfterMs: number }
```

In-memory token-bucket rate limiter. Idle buckets evicted after 10 minutes.

```typescript
const limiter = createRateLimiter("my-route", { capacity: 5, refillPerSecond: 0.1 });
const result = limiter(clientKey(request));
if (!result.allowed) return apiError(429, "Too many requests");
```

---

### `zoneOf(bias)`

```typescript
// src/lib/bias/config.ts
function zoneOf(bias: BiasCategory): MediaDnaZone
```

Maps any of the 10 bias categories to one of `"iktidar" | "bagimsiz" | "muhalefet"`.

---

### `getSourceMetadata(slug)`

```typescript
// src/lib/sources/factuality.ts
function getSourceMetadata(slug: string): SourceFactualityMetadata | null
```

Returns hand-tagged `{ factuality: "high"|"mixed"|"low"|null, ownership: string|null }` for known slugs. Returns `null` for untagged sources.

---

### `formatTurkishTimeAgo(dateISO)`

```typescript
// src/lib/time.ts
function formatTurkishTimeAgo(dateISO: string): string
```

Returns Turkish relative time: `"az önce"`, `"5 dakika önce"`, `"2 saat önce"`, `"3 gün önce"`, etc.

---

## Error Handling

All API routes use `withApiErrors()` to catch thrown errors and return consistent JSON:

```typescript
interface ApiError {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}
```

Helper functions: `apiError(status, message)`, `apiUnauthorized()`, `apiBadRequest(reason)`, `apiNotFound()`, `apiServerError(err)`.

---

## Core Types

```typescript
// src/types/index.ts

type BiasCategory =
  | "pro_government" | "gov_leaning" | "state_media"
  | "islamist_conservative" | "center" | "international"
  | "pro_kurdish" | "opposition_leaning" | "opposition" | "nationalist";

type MediaDnaZone = "iktidar" | "bagimsiz" | "muhalefet";

type NewsCategory =
  | "son_dakika" | "politika" | "dunya" | "ekonomi"
  | "spor" | "teknoloji" | "yasam" | "genel";

type BiasDistribution = Record<BiasCategory, number>;

interface Source {
  id: string;
  name: string;
  slug: string;
  url: string;
  rss_url: string;
  bias: BiasCategory;
  logo_url: string | null;
  active: boolean;
}

interface Article {
  id: string;
  source_id: string;
  title: string;
  description: string | null;
  url: string;
  image_url: string | null;
  published_at: string;
  content_hash: string;
  category: NewsCategory;
  created_at: string;
}
```

---

## Key Components

### `<ClusterCard>`
Server Component. Renders a cluster preview card with hero image, bias spectrum, and member article list. Props: `cluster`, `articles`, `sources`, `index`, `isAging`.

### `<BiasSpectrum distribution compact?>`
Renders a horizontal bar chart of bias distribution. `compact` mode collapses 10 categories into 3 zones.

### `<ClusterStance members>`
Groups cluster members by Medya DNA zone with source chips linking to original articles.

### `<MediaDna sources highlightSlugs?>`
Client Component. Displays all 144 sources grouped by zone. Toggle between showing only cluster participants vs. full directory.

### `<SourceChips slug>`
Server Component. Renders factuality + ownership chips for tagged sources. No-ops for unknown slugs.

### `<ClusterCardImage src srcs? logoSrc?>`
Client Component. Multi-tier image fallback: article images → source logo → gray placeholder. Walks an array of candidates on error.

### `<SearchBar>`
Client Component. Debounced (300ms) URL-driven search with `/` keyboard shortcut.
