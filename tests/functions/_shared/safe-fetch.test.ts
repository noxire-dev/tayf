import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Direct coverage for supabase/functions/_shared/safe-fetch.ts (audit T3 P1-5).
//
// The image-consumer test already exercises safeFetch *transitively* (through
// a vi.mock of the module that swaps in a deny-list stub), but Round-2 QA
// flagged that the module itself had zero direct tests — so a regression in
// the IPv6 parser, the DNS-rebinding allowlist, the manual-redirect loop, or
// the protocol gate would slip through. This file imports the REAL module
// (no vi.mock on safe-fetch.ts) and drives it through the audit's threat
// matrix: literal metadata addresses, IPv6 special-purpose blocks, CGNAT,
// hostnames whose DNS records point into private space (including the mixed
// public-plus-private DNS-rebinding shape), redirect-into-metadata, and
// non-http schemes.
//
// Deno globals (resolveDns + serve) don't exist in the vitest Node env, so
// we stub them per-test with vi.stubGlobal and tear the stubs down after each
// case to keep the suite hermetic.
// ---------------------------------------------------------------------------

import {
  assertHostnameIsPublic,
  isPrivateAddress,
  safeFetch,
  SafeFetchError,
  validateOutboundUrl,
} from "../../../supabase/functions/_shared/safe-fetch.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DenoStub {
  resolveDns: ReturnType<typeof vi.fn>;
  // safe-fetch.ts itself never calls Deno.serve, but the function-level
  // tests in the rest of the suite assume Deno.serve exists, so we provide a
  // no-op to mirror that environment shape.
  serve: ReturnType<typeof vi.fn>;
}

/**
 * Install a Deno global whose `resolveDns` returns `aRecords` for "A"
 * lookups and `aaaaRecords` for "AAAA" lookups. Either array may be empty
 * (resolver rejects with a "NotFound"-shaped error, which Promise.allSettled
 * surfaces as a rejection — the same shape Deno.resolveDns has in production
 * when only one record family exists).
 */
function stubResolveDns(
  aRecords: string[],
  aaaaRecords: string[] = [],
): DenoStub {
  const resolveDns = vi.fn(async (_host: string, recordType: string) => {
    if (recordType === "A") {
      if (aRecords.length === 0) {
        throw new Error("NotFound");
      }
      return aRecords;
    }
    if (recordType === "AAAA") {
      if (aaaaRecords.length === 0) {
        throw new Error("NotFound");
      }
      return aaaaRecords;
    }
    throw new Error(`unexpected record type ${recordType}`);
  });
  const stub: DenoStub = { resolveDns, serve: vi.fn() };
  vi.stubGlobal("Deno", stub);
  return stub;
}

/**
 * Stub global fetch with a queue of responses. Each call shifts the next
 * Response off the queue. Used to drive the manual-redirect loop through a
 * 302 → metadata flow without ever touching the network.
 */
function queueFetchResponses(responses: Response[]): ReturnType<typeof vi.fn> {
  const fetchStub = vi.fn(async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("fetch stub queue exhausted");
    }
    return next;
  });
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// isPrivateAddress — pure literal-IP classifier
// ---------------------------------------------------------------------------

describe("isPrivateAddress", () => {
  it("flags the AWS / GCP / Azure metadata IPv4 literal", () => {
    const label = isPrivateAddress("169.254.169.254");
    expect(label).not.toBeNull();
    expect(label).toMatch(/link-local/i);
  });

  it("flags IPv6 loopback ::1", () => {
    expect(isPrivateAddress("::1")).toMatch(/loopback/i);
  });

  it("flags CGNAT 100.64.0.1 (RFC 6598)", () => {
    expect(isPrivateAddress("100.64.0.1")).toMatch(/CGNAT/i);
  });

  it("flags IPv6 ULA fc00::1 (RFC 4193)", () => {
    expect(isPrivateAddress("fc00::1")).toMatch(/ULA/i);
  });

  it("flags IPv6 link-local fe80::1", () => {
    expect(isPrivateAddress("fe80::1")).toMatch(/link-local/i);
  });

  it("flags IPv6 documentation 2001:db8::1 (RFC 3849)", () => {
    expect(isPrivateAddress("2001:db8::1")).toMatch(/doc/i);
  });

  it("accepts a routable public IPv4 (1.1.1.1)", () => {
    expect(isPrivateAddress("1.1.1.1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// assertHostnameIsPublic — DNS-aware allowlist (includes rebinding shape)
// ---------------------------------------------------------------------------

describe("assertHostnameIsPublic", () => {
  it("rejects the literal 'localhost' hostname before touching DNS", async () => {
    // No DNS stub installed: if the implementation tried to resolve, the
    // missing Deno global would throw a different error. The hostname rule
    // has to fire on the string match alone.
    const reason = await assertHostnameIsPublic("localhost");
    expect(reason).toMatch(/localhost/i);
  });

  it("blocks a hostname whose A record sits in RFC 1918 (10.0.0.5)", async () => {
    stubResolveDns(["10.0.0.5"]);
    const reason = await assertHostnameIsPublic("rebind.example");
    expect(reason).toMatch(/blocked range/i);
    expect(reason).toMatch(/10\.0\.0\.5/);
  });

  it("blocks the DNS-rebinding mixed-record shape (one public, one private)", async () => {
    // Classic rebinding: an attacker advertises BOTH a public A and a
    // private A. The "any private record blocks" policy must catch it on
    // the private record, even though a public record is present.
    stubResolveDns(["8.8.8.8", "192.168.1.10"]);
    const reason = await assertHostnameIsPublic("mixed.example");
    expect(reason).toMatch(/192\.168\.1\.10/);
    expect(reason).toMatch(/blocked range/i);
  });

  it("accepts a hostname that resolves only to a single public IPv4", async () => {
    stubResolveDns(["8.8.8.8"]);
    const reason = await assertHostnameIsPublic("public.example");
    expect(reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateOutboundUrl — scheme + hostname allowlist
// ---------------------------------------------------------------------------

describe("validateOutboundUrl", () => {
  it("rejects file:// URLs before any DNS lookup", async () => {
    // The protocol check fires before resolveDns, so no DNS stub is needed.
    const result = await validateOutboundUrl("file:///etc/passwd");
    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/protocol/i);
    expect(result as string).toMatch(/file:/i);
  });

  it("rejects a literal [::1] URL on the IPv6 loopback fast path", async () => {
    const result = await validateOutboundUrl("http://[::1]/whatever");
    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/blocked range/i);
  });

  it("rejects a literal 169.254.169.254 URL", async () => {
    const result = await validateOutboundUrl("http://169.254.169.254/latest/meta-data");
    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/link-local/i);
  });
});

// ---------------------------------------------------------------------------
// safeFetch — end-to-end policy enforcement
// ---------------------------------------------------------------------------

describe("safeFetch", () => {
  it("throws SafeFetchError for the literal AWS metadata URL", async () => {
    await expect(
      safeFetch("http://169.254.169.254/latest/meta-data/iam"),
    ).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("throws SafeFetchError for the literal [::1] URL", async () => {
    await expect(safeFetch("http://[::1]/")).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("throws SafeFetchError for literal CGNAT 100.64.0.1", async () => {
    await expect(safeFetch("http://100.64.0.1/")).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("throws SafeFetchError for literal IPv6 ULA [fc00::1]", async () => {
    await expect(safeFetch("http://[fc00::1]/")).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("throws SafeFetchError for literal IPv6 link-local [fe80::1]", async () => {
    await expect(safeFetch("http://[fe80::1]/")).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("throws SafeFetchError for literal IPv6 documentation [2001:db8::1]", async () => {
    await expect(
      safeFetch("http://[2001:db8::1]/"),
    ).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("throws SafeFetchError for file:// URLs", async () => {
    await expect(safeFetch("file:///etc/passwd")).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("throws SafeFetchError when the hostname is 'localhost'", async () => {
    // No DNS stub: the localhost short-circuit must trip purely on the
    // hostname string before any resolver call.
    await expect(safeFetch("http://localhost/admin")).rejects.toBeInstanceOf(
      SafeFetchError,
    );
  });

  it("throws SafeFetchError when Deno.resolveDns returns a private A record", async () => {
    stubResolveDns(["10.0.0.5"]);
    await expect(safeFetch("http://rebind.example/")).rejects.toBeInstanceOf(
      SafeFetchError,
    );
  });

  it("throws SafeFetchError on DNS-rebinding mixed (public + private) records", async () => {
    stubResolveDns(["8.8.8.8", "172.16.0.4"]);
    await expect(safeFetch("http://mixed.example/")).rejects.toBeInstanceOf(
      SafeFetchError,
    );
  });

  it("re-validates the Location header and blocks a 302 → 169.254.169.254 hop", async () => {
    // First hop: public DNS resolution lets the initial fetch happen.
    stubResolveDns(["8.8.8.8"]);
    queueFetchResponses([
      // Hop 1: 302 pointing the manual-redirect loop at the metadata IP.
      new Response(null, {
        status: 302,
        headers: { Location: "http://169.254.169.254/latest/meta-data/iam" },
      }),
      // Hop 2 would only fire if validation passed (it must not).
      new Response("nope", { status: 200 }),
    ]);

    await expect(safeFetch("http://public.example/start")).rejects.toBeInstanceOf(
      SafeFetchError,
    );
  });

  it("returns successfully when DNS resolves to a single public IPv4 (happy path)", async () => {
    stubResolveDns(["8.8.8.8"]);
    queueFetchResponses([
      new Response("<html><head><title>ok</title></head></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    ]);

    const result = await safeFetch("http://public.example/");
    expect(result.status).toBe(200);
    expect(result.body).toContain("<title>ok</title>");
  });

  // Round-4 regression: pre-fix, isPrivateAddress returned the truthy string
  // "unparseable address" for any non-IP input, so assertHostnameIsPublic's
  // literal-IP fast path mis-classified "example.com" as a "literal IP in
  // blocked range" and safeFetch rejected every hostname before DNS ran. The
  // fix returns null for non-literal input and skips the fast path entirely
  // unless the hostname actually parses as a v4 / v6 literal.
  it("does NOT throw on a regular hostname URL when DNS resolves to a public IP (regression)", async () => {
    stubResolveDns(["93.184.215.14"]);
    queueFetchResponses([
      new Response(
        '<html><head><meta property="og:image" content="https://cdn.example.com/cover.jpg" /></head></html>',
        { status: 200, headers: { "Content-Type": "text/html" } },
      ),
    ]);

    const result = await safeFetch(
      new URL("https://example.com/feed.xml").toString(),
    );
    expect(result.status).toBe(200);
    expect(result.body).toContain("og:image");
  });
});
