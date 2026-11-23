import { describe, expect, it } from "vitest";
import { scrubEvent, scrubText } from "@/lib/monitoring-scrub";

// 拼出来的假密钥：避免 GitHub 等密钥扫描误报
const FAKE_STRIPE = ["sk", "live", "abcDEF123456"].join("_");
const FAKE_WEBHOOK = ["whsec", "abcDEF123456"].join("_");
const FAKE_RESEND = ["re", "abcd1234", "efgh5678"].join("_");

describe("scrubText", () => {
  it("removes emails", () => expect(scrubText("failed for maya@example.com")).toBe("failed for [email]"));

  it.each([
    FAKE_STRIPE,
    ["rk", "test", "abcDEF123456"].join("_"),
    FAKE_WEBHOOK,
    FAKE_RESEND,
    "sk-or-v1-abcdefghijklmnop",
    "Bearer abcdefghijklmnop",
    "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
  ])("removes %s", (secret) => {
    expect(scrubText(`error: ${secret} end`)).not.toContain(secret);
  });

  it("leaves ordinary errors alone", () => expect(scrubText("Upstream 429: rate limit")).toBe("Upstream 429: rate limit"));
});

describe("scrubEvent", () => {
  it("strips request data, headers and the user", () => {
    const e = scrubEvent({
      user: { email: "maya@example.com", ip_address: "1.2.3.4" },
      message: "failed for maya@example.com",
      request: {
        url: "https://site.test/api/newsletter?token=abc",
        cookies: { session: "x" },
        data: { password: "x" },
        query_string: "token=abc",
        headers: { cookie: "a", Authorization: "Bearer x", "stripe-signature": "s", referer: "https://site.test/newsletter?token=abc", "user-agent": "ua" },
      },
      exception: { values: [{ value: `key ${FAKE_STRIPE} rejected` }] },
      breadcrumbs: [{ message: "POST as maya@example.com", data: { body: "x" } }],
    });
    expect(e.user).toBeUndefined();
    expect(e.message).toBe("failed for [email]");
    expect(e.request).toEqual({ url: "https://site.test/api/newsletter", headers: { "user-agent": "ua" } });
    expect(e.exception.values[0].value).toBe("key [secret] rejected");
    expect(e.breadcrumbs[0]).toEqual({ message: "POST as [email]" });
  });
});
