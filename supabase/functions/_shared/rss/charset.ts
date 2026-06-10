// supabase/functions/_shared/rss/charset.ts
//
// Charset-aware decoder for RSS bodies. Addresses audit T7 P1-22:
// `scripts/rss-worker.mjs` and `src/lib/rss/fetcher.ts` both decoded
// response bodies with `res.text()`, which uses UTF-8 only. Turkish
// publishers commonly emit feeds in `iso-8859-9` / `windows-1254`
// (Hürriyet, Milliyet, NTV, Posta, several local outlets), and the
// raw UTF-8 decode mangled every `İ`, `ş`, `ğ`, `ç`, `ü`, `ö` into a
// Unicode replacement character. This module:
//
//   1. Sniffs the HTTP `Content-Type: text/xml; charset=...` header.
//   2. Falls back to the XML prolog `<?xml version="1.0" encoding="..."?>`.
//   3. Defaults to UTF-8 only when both sniffs are absent or unrecognised.
//
// All target encodings ship with Deno's native `TextDecoder` so no third
// vendor (iconv-lite, encoding) is needed. The Turkish path lands on
// `windows-1254`, which is what Deno exposes for the `iso-8859-9` family —
// they share the same code-point mapping in the Latin block.

/** Family table → canonical TextDecoder label. */
const CHARSET_ALIASES: Record<string, string> = {
  "utf-8": "utf-8",
  utf8: "utf-8",
  "us-ascii": "utf-8",
  ascii: "utf-8",
  // Turkish family — all map to windows-1254 in WHATWG's Encoding Standard.
  "iso-8859-9": "windows-1254",
  "iso8859-9": "windows-1254",
  "windows-1254": "windows-1254",
  cp1254: "windows-1254",
  // Western European fall-throughs occasionally seen on Turkish servers.
  "iso-8859-1": "windows-1252",
  "iso8859-1": "windows-1252",
  latin1: "windows-1252",
  "windows-1252": "windows-1252",
  cp1252: "windows-1252",
};

/**
 * Extract the `charset=...` token from a `Content-Type` header value, or
 * `null` if the header is missing or does not declare one. Tolerant of
 * surrounding whitespace, mixed casing, and optional double-quotes.
 */
export function sniffContentTypeCharset(contentType: string | null): string | null {
  if (!contentType) return null;
  const m = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType);
  if (!m) return null;
  return (m[1] ?? "").toLowerCase() || null;
}

/**
 * Extract the `encoding="..."` attribute from the XML prolog of a byte
 * buffer. Reads only the first 256 bytes as latin1 (every encoding's prolog
 * is ASCII-safe in that prefix) so we never have to decode the entire body
 * twice. Returns `null` if no prolog is present.
 */
export function sniffXmlPrologCharset(bytes: Uint8Array): string | null {
  // 256 bytes is well past every realistic `<?xml ?>` declaration.
  const head = bytes.subarray(0, Math.min(256, bytes.byteLength));
  const ascii = new TextDecoder("ascii", { fatal: false }).decode(head);
  const m = /<\?xml[^?]*encoding\s*=\s*["']([^"']+)["']/i.exec(ascii);
  if (!m) return null;
  return (m[1] ?? "").toLowerCase() || null;
}

/** Strip BOM characters that survive into the decoded string. */
function stripBom(s: string): string {
  return s.length > 0 && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Decode `bytes` to a string using the best charset signal available.
 *
 * Resolution order:
 *   1. HTTP `Content-Type: charset=...`
 *   2. XML prolog `<?xml encoding="..."?>`
 *   3. UTF-8 default.
 *
 * Unrecognised aliases fall through to the next layer (e.g. a junk header
 * with a real prolog still picks the prolog). If the final decoder label
 * itself is unsupported by Deno's TextDecoder (vanishingly rare — we only
 * touch the WHATWG-mandated set) we fall back to UTF-8 in `fatal:false`
 * mode so the caller still receives a (possibly mojibake) string rather
 * than an exception.
 */
export function decodeRssBody(
  bytes: Uint8Array,
  contentType: string | null,
): { text: string; charset: string } {
  const headerCharset = sniffContentTypeCharset(contentType);
  const prologCharset = sniffXmlPrologCharset(bytes);

  const candidates: Array<string | null> = [headerCharset, prologCharset];
  for (const raw of candidates) {
    if (!raw) continue;
    const canonical = CHARSET_ALIASES[raw];
    if (!canonical) continue;
    try {
      const decoded = new TextDecoder(canonical, { fatal: false }).decode(bytes);
      return { text: stripBom(decoded), charset: canonical };
    } catch {
      // Decoder label rejected — try next candidate.
    }
  }

  // Default: UTF-8.
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return { text: stripBom(utf8), charset: "utf-8" };
}
