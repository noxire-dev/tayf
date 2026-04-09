import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import {
  apiBadRequest,
  apiError,
  withApiErrors,
} from "@/lib/api/errors";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

// Newsletter signups: 5-token bucket refilling at 1 token / 30s. A real human
// fills the form once; this absorbs accidental double-clicks but cuts off any
// scripted abuse from a single IP. Mirrors the admin-post limiter shape so we
// have a single rate-limit pattern across mutating routes.
const newsletterPostLimit = createRateLimiter("newsletter-post", {
  capacity: 5,
  refillPerSecond: 1 / 30,
});

// Pragmatic email regex — matches "local@domain.tld" with at least one dot in
// the domain. Not RFC-5322 perfect, but good enough to catch typos client-side
// and to keep obviously-broken rows out of the table. The unique index on
// `email` is the real source of truth for dedupe.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST = withApiErrors(async (request: Request) => {
  const rl = newsletterPostLimit(clientKey(request));
  if (!rl.allowed) {
    return apiError(429, "Too many requests", {
      details: { retryAfterMs: rl.retryAfterMs },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  const email =
    typeof body === "object" && body !== null && "email" in body
      ? String((body as { email: unknown }).email ?? "").trim().toLowerCase()
      : "";

  if (!email) {
    return apiBadRequest("Email is required");
  }
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return apiBadRequest("Invalid email address");
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from("newsletter_subscribers")
    .insert({ email });

  if (error) {
    // 23505 = unique_violation. Treat duplicate signup as success so we
    // don't leak which addresses are already on the list.
    if (error.code === "23505") {
      return NextResponse.json({ success: true, alreadySubscribed: true });
    }
    return apiError(500, error.message);
  }

  return NextResponse.json({ success: true });
});
