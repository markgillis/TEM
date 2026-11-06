import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const environment = (send = async () => ({ messageId: "test-message" })) => ({
  ASSETS: { fetch: async () => new Response("asset") },
  EMAIL: { send },
  EMAIL_FROM: "website@tem-ai.com",
  TURNSTILE_SECRET_KEY: "test-secret",
  TURNSTILE_SITE_KEY: "test-site-key",
});

const submission = (overrides = {}) =>
  new Request("https://tem-ai.com/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Alex Example",
      email: "alex@example.com",
      message: "Please get in touch.",
      turnstileToken: "valid-token",
      ...overrides,
    }),
  });

test("validates Turnstile before sending a contact email", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let email;
  globalThis.fetch = async (url, options) => {
    assert.equal(
      url,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    assert.equal(JSON.parse(options.body).response, "valid-token");
    return Response.json({
      success: true,
      action: "contact",
      hostname: "tem-ai.com",
    });
  };

  const response = await worker.fetch(
    submission(),
    environment(async (message) => {
      email = message;
      return { messageId: "sent" };
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(email.to, "mark.gillis.ktyc@gmail.com");
  assert.equal(email.from, "website@tem-ai.com");
  assert.equal(email.replyTo, "alex@example.com");
  assert.match(email.text, /Please get in touch\./);
});

test("does not send email when Turnstile validation fails", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => Response.json({ success: false });

  let sendCalled = false;
  const response = await worker.fetch(
    submission(),
    environment(async () => {
      sendCalled = true;
      return { messageId: "unexpected" };
    }),
  );

  assert.equal(response.status, 400);
  assert.equal(sendCalled, false);
});

test("rejects malformed contact data before contacting Turnstile", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    assert.fail("Turnstile must not be called for invalid form data.");
  };

  const response = await worker.fetch(
    submission({ email: "not-an-email" }),
    environment(),
  );

  assert.equal(response.status, 400);
});

test("returns a public Turnstile key without exposing the secret", async () => {
  const response = await worker.fetch(
    new Request("https://tem-ai.com/api/config"),
    environment(),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { siteKey: "test-site-key" });
});

test("adds the contact form script to the supplied site HTML", async () => {
  const env = environment();
  env.ASSETS.fetch = async () =>
    new Response("<html><body>site</body></html>", {
      headers: { "Content-Type": "text/html", "Content-Length": "32" },
    });

  const response = await worker.fetch(new Request("https://tem-ai.com/"), env);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /<script src="\/contact\.js" defer><\/script>/);
  assert.equal(response.headers.get("content-length"), null);
});

test("reports email delivery errors instead of claiming success", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    Response.json({
      success: true,
      action: "contact",
      hostname: "tem-ai.com",
    });

  const response = await worker.fetch(
    submission(),
    environment(async () => {
      throw new Error("Email service unavailable");
    }),
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "Your message could not be sent. Please try again later.",
  });
});
