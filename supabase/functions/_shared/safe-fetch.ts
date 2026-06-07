// supabase/functions/_shared/safe-fetch.ts
//
// SSRF-safe fetch primitive shared by the image-backfill Edge Function. This
// is the audit T3 P1-5 fix: every outbound HTTP fetch in og-image.ts MUST go
// through `safeFetch` so we can't be tricked into pulling instance metadata,
// link-local addresses, RFC 1918 ranges, or other private targets via a
// hostile article URL, an attacker-controlled Location header, or DNS
// rebinding.
//
// Guarantees:
//   1. Resolves the target hostname via Deno.resolveDns for BOTH A and AAAA
//      records. Any record that falls inside the private/special-purpose
//      block list (RFC 1918, CGNAT, loopback, link-local, ULA, etc.) causes
//      the request to be rejected before a connection is opened.
//   2. Redirects are manual (`redirect: "manual"`). Each Location header is
//      re-validated through the same allowlist on every hop, with a maximum
//      of MAX_REDIRECTS hops. This blocks the "first-fetch is public, then
//      redirect to 169.254.169.254" exfiltration pattern.
//   3. Only http(s) URLs are allowed. file://, ftp://, gopher://, etc. are
//      rejected before resolution.
//   4. The streamed body is bounded by `maxBytes` (the caller-supplied cap,
//      typically 50 KB). The HTML-aware early-stop on `</head>` lives in
//      the og-image extractor; this module only enforces the byte ceiling.
//
// IMPORTANT: this module is Deno-only. Node fetch has no equivalent of
// Deno.resolveDns; the Vercel cron path uses a different code path that
// will be retired by B7.

// ---------------------------------------------------------------------------
// Private / special-purpose IP ranges. Mirrors the audit T3 P1-5 requirement.
// Each entry is parsed once at module load and matched against every record
// returned by Deno.resolveDns.
//
// IPv4 blocks (RFC-numbered):
//   10.0.0.0/8        — RFC 1918 private
//   172.16.0.0/12     — RFC 1918 private
//   192.168.0.0/16    — RFC 1918 private
//   127.0.0.0/8       — loopback
//   169.254.0.0/16    — link-local (covers AWS/GCP/Azure metadata 169.254.169.254)
//   0.0.0.0/8         — "this network", current network
//   100.64.0.0/10     — RFC 6598 CGNAT shared address space
//
// IPv6 blocks:
//   ::1/128           — loopback (single host)
//   fc00::/7          — RFC 4193 unique local addresses (ULA)
//   fe80::/10         — link-local
//   2001:db8::/32     — RFC 3849 documentation prefix
//
// Note: we DO NOT block public-but-suspicious ranges like multicast or
// reserved/unassigned — those are not in the audit requirement, and a
// global allowlist would be too strict for legitimate news CDNs.
// ---------------------------------------------------------------------------

interface IPv4Block {
  readonly kind: "v4";
  readonly base: number; // network address as a uint32
  readonly mask: number; // network mask as a uint32
  readonly label: string;
}

interface IPv6Block {
  readonly kind: "v6";
  // First two 64-bit halves of the network address (BigInt). For all blocks
  // we care about, the prefix is <= 64 bits, so we only need the high half
  // plus the prefix length to match.
  readonly high: bigint;
  readonly prefix: number; // 0..128
  readonly label: string;
}

type IPBlock = IPv4Block | IPv6Block;

function parseIPv4(addr: string): number | null {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  // JS bitwise ops are 32-bit signed; coerce to uint32 for consistent compare.
  return result >>> 0;
}

function parseIPv4Block(cidr: string, label: string): IPv4Block {
  const [addr, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  const base = parseIPv4(addr);
  if (base === null || !Number.isFinite(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`invalid IPv4 CIDR: ${cidr}`);
  }
  // prefix=0 → mask=0; prefix=32 → mask=0xffffffff. The conditional avoids
  // the "x << 32 === x" JS quirk.
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return { kind: "v4", base: (base & mask) >>> 0, mask, label };
}

/**
 * Parse a textual IPv6 address into its high and low 64-bit halves. Returns
 * null on malformed input. Supports `::` shorthand and IPv4-mapped suffixes
 * (`::ffff:1.2.3.4`).
 */
function parseIPv6(addr: string): { high: bigint; low: bigint } | null {
  // Strip a possible zone id (e.g. `fe80::1%eth0`).
  const zoneAt = addr.indexOf("%");
  if (zoneAt !== -1) addr = addr.slice(0, zoneAt);

  // Handle IPv4-mapped tail: split off and convert to two hex groups.
  let tail = "";
  const dotAt = addr.lastIndexOf(".");
  if (dotAt !== -1) {
    const colonAt = addr.lastIndexOf(":", dotAt);
    if (colonAt === -1) return null;
    const v4 = parseIPv4(addr.slice(colonAt + 1));
    if (v4 === null) return null;
    const hi = (v4 >>> 16) & 0xffff;
    const lo = v4 & 0xffff;
    tail = `${hi.toString(16)}:${lo.toString(16)}`;
    addr = addr.slice(0, colonAt + 1) + tail;
  }

  let head: string[];
  let rest: string[];
  if (addr.includes("::")) {
    const [headStr, restStr] = addr.split("::");
    head = headStr ? headStr.split(":") : [];
    rest = restStr ? restStr.split(":") : [];
  } else {
    head = addr.split(":");
    rest = [];
  }

  const total = head.length + rest.length;
  if (total > 8) return null;
  const zeros = 8 - total;
  if (zeros < 0) return null;
  if (!addr.includes("::") && total !== 8) return null;

  const groups: string[] = [...head, ...new Array(zeros).fill("0"), ...rest];
  if (groups.length !== 8) return null;

  let high = 0n;
  let low = 0n;
  for (let i = 0; i < 8; i++) {
    const g = groups[i];
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const v = BigInt(parseInt(g, 16));
    if (i < 4) high = (high << 16n) | v;
    else low = (low << 16n) | v;
  }
  return { high, low };
}

function parseIPv6Block(cidr: string, label: string): IPv6Block {
  const [addr, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  const parsed = parseIPv6(addr);
  if (parsed === null || !Number.isFinite(prefix) || prefix < 0 || prefix > 128) {
    throw new Error(`invalid IPv6 CIDR: ${cidr}`);
  }
  // We only support /0..../64 — every block in BLOCKED_BLOCKS sits at /128, /7,
  // /10, /32, so the high-half-only match is sufficient. For the /128 case
  // (::1) we still anchor on the high half (0) and verify the low half in
  // matchIPv6Block.
  return { kind: "v6", high: parsed.high, prefix, label };
}

const BLOCKED_BLOCKS: readonly IPBlock[] = [
  parseIPv4Block("10.0.0.0/8", "RFC1918 10.0.0.0/8"),
  parseIPv4Block("172.16.0.0/12", "RFC1918 172.16.0.0/12"),
  parseIPv4Block("192.168.0.0/16", "RFC1918 192.168.0.0/16"),
  parseIPv4Block("127.0.0.0/8", "loopback 127.0.0.0/8"),
  parseIPv4Block("169.254.0.0/16", "link-local 169.254.0.0/16"),
  parseIPv4Block("0.0.0.0/8", "this-network 0.0.0.0/8"),
  parseIPv4Block("100.64.0.0/10", "CGNAT 100.64.0.0/10"),
  parseIPv6Block("::1/128", "IPv6 loopback ::1"),
  parseIPv6Block("fc00::/7", "IPv6 ULA fc00::/7"),
  parseIPv6Block("fe80::/10", "IPv6 link-local fe80::/10"),
  parseIPv6Block("2001:db8::/32", "IPv6 doc 2001:db8::/32"),
];

function matchIPv4Block(addr: number, block: IPv4Block): boolean {
  return ((addr & block.mask) >>> 0) === block.base;
}

function matchIPv6Block(parsed: { high: bigint; low: bigint }, block: IPv6Block): boolean {
  if (block.prefix === 128) {
    // Exact match on the full 128 bits; only ::1 currently uses this.
    return parsed.high === block.high && parsed.low === 1n;
  }
  // All other blocks live in the high 64 bits (prefix <= 64).
  const shift = BigInt(64 - block.prefix);
  if (shift < 0n) {
    // Shouldn't happen given BLOCKED_BLOCKS, but guard so a misuse doesn't
    // silently bypass the check.
    return false;
  }
  return (parsed.high >> shift) === (block.high >> shift);
}

/**
 * Test whether a literal IP address (v4 or v6) falls in any blocked range.
 * Returns the offending block label on match, null otherwise.
 *
 * Non-literal input (e.g. a hostname like "example.com") also returns null —
 * meaning "this is not a literal IP I can classify". Callers MUST treat the
 * null return as "fall through to hostname normalisation + DNS resolution",
 * NOT as "address is safe". The previous contract that returned a truthy
 * string for unparseable input was a footgun: assertHostnameIsPublic would
 * mis-classify every hostname as a "literal IP in blocked range" and refuse
 * every outbound request.
 */
export function isPrivateAddress(ip: string): string | null {
  const v4 = parseIPv4(ip);
  if (v4 !== null) {
    for (const block of BLOCKED_BLOCKS) {
      if (block.kind === "v4" && matchIPv4Block(v4, block)) return block.label;
    }
    return null;
  }
  const v6 = parseIPv6(ip);
  if (v6 !== null) {
    for (const block of BLOCKED_BLOCKS) {
      if (block.kind === "v6" && matchIPv6Block(v6, block)) return block.label;
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hostname resolution + allowlist
// ---------------------------------------------------------------------------

/**
 * Resolve a hostname to every A and AAAA record and reject the request if
 * ANY record falls in a blocked range. Treating "any private record blocks"
 * (rather than "all private records block") closes DNS-rebinding pinholes
 * where an attacker advertises both a public and a private A.
 *
 * Returns null if the host is safe, or a human-readable reason string if it
 * should be blocked.
 */
export async function assertHostnameIsPublic(hostname: string): Promise<string | null> {
  // Literal IP fast path — skip DNS, just validate the literal. Only treat
  // the hostname as a literal IP if it actually parses as one; otherwise
  // isPrivateAddress's null return means "not an IP I can classify" and we
  // must fall through to hostname normalisation + DNS resolution below.
  const bareHost = hostname.replace(/^\[|\]$/g, "");
  const isLiteralIp =
    parseIPv4(bareHost) !== null || parseIPv6(bareHost) !== null;
  if (isLiteralIp) {
    const literal = isPrivateAddress(bareHost);
    if (literal !== null) {
      return `literal IP in blocked range (${literal})`;
    }
    // Literal IP that wasn't in a blocked range: safe.
    return null;
  }

  // Hostnames must look like real DNS names. Empty / overly long / control
  // chars are refused outright.
  if (!hostname || hostname.length > 253) return "invalid hostname length";
  if (!/^[a-zA-Z0-9.\-]+$/.test(hostname)) return "hostname contains invalid characters";
  // Disallow "localhost" and trailing-dot variants — even if they don't
  // resolve to 127.0.0.1 on every system, we have no legitimate use case for
  // them in an outbound og:image fetch.
  const normalised = hostname.replace(/\.$/, "").toLowerCase();
  if (normalised === "localhost" || normalised.endsWith(".localhost")) {
    return "localhost host";
  }

  // Resolve A + AAAA in parallel. Either resolver throwing means the host
  // didn't have that record type; both throwing is a real failure.
  const settled = await Promise.allSettled([
    Deno.resolveDns(hostname, "A"),
    Deno.resolveDns(hostname, "AAAA"),
  ]);

  const addrs: string[] = [];
  let resolvedSomething = false;
  for (const result of settled) {
    if (result.status === "fulfilled") {
      resolvedSomething = true;
      for (const a of result.value) addrs.push(a);
    }
  }
  if (!resolvedSomething) return "DNS resolution failed";
  if (addrs.length === 0) return "hostname has no A or AAAA records";

  for (const addr of addrs) {
    const offender = isPrivateAddress(addr);
    if (offender !== null) {
      return `resolved address ${addr} in blocked range (${offender})`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// URL allowlist
// ---------------------------------------------------------------------------

/**
 * Validate a URL string: must be http(s), must parse, and the hostname must
 * resolve to only public addresses. Returns a parsed URL on success, or a
 * string reason on failure.
 */
export async function validateOutboundUrl(rawUrl: string): Promise<URL | string> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "URL did not parse";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `protocol ${parsed.protocol} not allowed (http/https only)`;
  }
  // Strip IPv6 brackets for the resolver.
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const reason = await assertHostnameIsPublic(host);
  if (reason !== null) return reason;
  return parsed;
}

// ---------------------------------------------------------------------------
// safeFetch — DNS-validated, manual-redirect, bounded-body HTTP fetcher
// ---------------------------------------------------------------------------

export interface SafeFetchOptions {
  /** Request headers; same shape as RequestInit.headers. */
  readonly headers?: HeadersInit;
  /** Per-request timeout. Defaults to 8000ms. */
  readonly timeoutMs?: number;
  /** Maximum number of bytes streamed from the body. Defaults to 50 KiB. */
  readonly maxBytes?: number;
  /**
   * Optional early-stop predicate. Invoked after each chunk decode with the
   * current accumulated text. If it returns true, the read loop exits. Used
   * by og-image.ts to stop at `</head>` without reading the full cap.
   */
  readonly shouldStopReading?: (accumulated: string) => boolean;
  /** Maximum redirect hops. Defaults to 3. */
  readonly maxRedirects?: number;
}

export interface SafeFetchResult {
  /** Final HTTP status code after redirect handling. */
  readonly status: number;
  /** Final response headers. */
  readonly headers: Headers;
  /** UTF-8-decoded body, truncated to `maxBytes`. */
  readonly body: string;
  /** Final URL after redirects. */
  readonly finalUrl: string;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 50_000;
const DEFAULT_MAX_REDIRECTS = 3;

/**
 * Thrown for any safeFetch-detected violation (SSRF, oversized body, invalid
 * URL, redirect chain exceeded). Callers in og-image.ts catch this broadly
 * and return null — we never leak an SSRF target back to a caller.
 */
export class SafeFetchError extends Error {
  override readonly name = "SafeFetchError";
  constructor(message: string) {
    super(message);
  }
}

/**
 * SSRF-safe outbound fetch. Validates the URL (DNS + private-block check),
 * disables automatic redirects, re-validates every Location header through
 * the same allowlist, and caps the body read at `maxBytes`.
 *
 * Throws SafeFetchError on any policy violation. Callers should catch and
 * return null — see og-image.ts for the canonical pattern.
 */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = rawUrl;
    let hops = 0;
    let response: Response | null = null;

    while (true) {
      const validated = await validateOutboundUrl(currentUrl);
      if (typeof validated === "string") {
        throw new SafeFetchError(`URL rejected: ${validated} (url=${currentUrl})`);
      }

      response = await fetch(validated.toString(), {
        method: "GET",
        signal: controller.signal,
        headers: opts.headers,
        redirect: "manual",
      });

      // 3xx with a Location header → cancel the current body, validate the
      // next hop, and loop. We do NOT follow without re-validating; we do NOT
      // follow more than `maxRedirects` hops.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        // Discard the body of the redirect response. Some servers send a
        // small "Redirecting to ..." HTML even on 3xx; we don't need it.
        try {
          await response.body?.cancel();
        } catch {
          // ignore
        }
        if (!location) {
          // 3xx without Location: nothing more we can do, return as-is.
          // (Most clients treat this as an error; we surface it via status.)
          return {
            status: response.status,
            headers: response.headers,
            body: "",
            finalUrl: validated.toString(),
          };
        }
        if (hops >= maxRedirects) {
          throw new SafeFetchError(
            `redirect chain exceeded ${maxRedirects} hops (last=${currentUrl} → ${location})`,
          );
        }
        // Resolve Location relative to the validated URL — Location may be
        // absolute or relative per RFC 7231 §7.1.2.
        let nextUrl: string;
        try {
          nextUrl = new URL(location, validated).toString();
        } catch {
          throw new SafeFetchError(`unparseable Location header: ${location}`);
        }
        currentUrl = nextUrl;
        hops += 1;
        continue;
      }

      // Non-redirect: drop out and stream the body.
      break;
    }

    if (response === null) {
      // Unreachable — the loop always assigns response — but TypeScript
      // narrowing wants the explicit check.
      throw new SafeFetchError("internal: no response after redirect loop");
    }

    // ---- Bounded body read ------------------------------------------------
    const finalUrl = response.url || currentUrl;
    const reader = response.body?.getReader();
    if (!reader) {
      return {
        status: response.status,
        headers: response.headers,
        body: "",
        finalUrl,
      };
    }
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let accumulated = "";
    let bytesRead = 0;
    try {
      while (bytesRead < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        // Slice the final chunk to the maxBytes boundary so the caller never
        // sees more than the requested ceiling.
        let chunk: Uint8Array = value;
        if (bytesRead > maxBytes) {
          const overshoot = bytesRead - maxBytes;
          chunk = value.subarray(0, value.byteLength - overshoot);
          accumulated += decoder.decode(chunk, { stream: false });
          break;
        }
        accumulated += decoder.decode(chunk, { stream: true });
        if (opts.shouldStopReading && opts.shouldStopReading(accumulated)) break;
      }
    } finally {
      // Always cancel the reader to free the socket. cancel() can itself
      // throw if the socket was already torn down — swallow so safeFetch's
      // contract (only SafeFetchError or fetch-level errors propagate) holds.
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    }

    return {
      status: response.status,
      headers: response.headers,
      body: accumulated,
      finalUrl,
    };
  } finally {
    clearTimeout(timer);
  }
}
