const CONTACT_RECIPIENT = "mark.gillis.ktyc@gmail.com";
const MAX_BODY_BYTES = 12_000;

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readJsonBody(request) {
  const reader = request.body?.getReader();
  if (!reader) {
    return { error: "empty" };
  }

  const decoder = new TextDecoder();
  let text = "";
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return { error: "too_large" };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: "invalid_json" };
  }
}

function validateFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const token =
    typeof body.turnstileToken === "string" ? body.turnstileToken : "";

  if (
    !name ||
    name.length > 120 ||
    !email ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !message ||
    message.length > 5_000 ||
    !token ||
    token.length > 2_048
  ) {
    return null;
  }

  return { name, email, message, token };
}

async function handleContact(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return jsonResponse({ error: "Expected a JSON request." }, 415);
  }

  const parsed = await readJsonBody(request);
  if (parsed.error === "too_large") {
    return jsonResponse({ error: "The message is too large." }, 413);
  }
  if (parsed.error) {
    return jsonResponse({ error: "Please submit a valid contact form." }, 400);
  }

  const body = parsed.value;
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof body.website === "string" &&
    body.website.trim()
  ) {
    return jsonResponse({ ok: true });
  }

  const fields = validateFields(body);
  if (!fields) {
    return jsonResponse(
      { error: "Please check your name, email, and message, then try again." },
      400,
    );
  }

  if (!env.TURNSTILE_SECRET_KEY || !env.EMAIL_FROM || !env.EMAIL) {
    console.error("Contact form is missing a required Cloudflare binding or secret.");
    return jsonResponse(
      { error: "The contact form is not configured yet. Please try again later." },
      503,
    );
  }

  let verificationResponse;
  try {
    verificationResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: fields.token,
        }),
      },
    );
  } catch (error) {
    console.error("Turnstile verification request failed.", error);
    return jsonResponse(
      { error: "We could not verify the captcha. Please try again." },
      502,
    );
  }

  if (!verificationResponse.ok) {
    console.error("Turnstile verification returned HTTP", verificationResponse.status);
    return jsonResponse(
      { error: "We could not verify the captcha. Please try again." },
      502,
    );
  }

  let verification;
  try {
    verification = await verificationResponse.json();
  } catch (error) {
    console.error("Turnstile returned an invalid response.", error);
    return jsonResponse(
      { error: "We could not verify the captcha. Please try again." },
      502,
    );
  }

  const hostname = new URL(request.url).hostname;
  if (
    !verification.success ||
    verification.action !== "contact" ||
    verification.hostname !== hostname
  ) {
    return jsonResponse(
      { error: "Captcha verification failed. Please try again." },
      400,
    );
  }

  try {
    await env.EMAIL.send({
      from: env.EMAIL_FROM,
      to: CONTACT_RECIPIENT,
      replyTo: fields.email,
      subject: "New website contact form submission",
      text: `Name: ${fields.name}\nEmail: ${fields.email}\n\n${fields.message}`,
    });
  } catch (error) {
    console.error(
      "Contact email delivery failed.",
      error instanceof Error ? error.message : "Unknown email service error",
    );
    return jsonResponse(
      { error: "Your message could not be sent. Please try again later." },
      502,
    );
  }

  return jsonResponse({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/config" && request.method === "GET") {
      if (
        !env.TURNSTILE_SITE_KEY ||
        env.TURNSTILE_SITE_KEY === "REPLACE_WITH_TURNSTILE_SITE_KEY"
      ) {
        return jsonResponse({ error: "Turnstile is not configured." }, 503);
      }
      return jsonResponse({ siteKey: env.TURNSTILE_SITE_KEY });
    }

    if (url.pathname === "/api/contact") {
      return handleContact(request, env);
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const assetResponse = await env.ASSETS.fetch(request);
      const contentType = assetResponse.headers.get("content-type") || "";
      if (!assetResponse.ok || !contentType.includes("text/html")) {
        return assetResponse;
      }

      const html = await assetResponse.text();
      const updatedHtml = html.replace(
        /<\/body>/i,
        '  <script src="/contact.js" defer></script>\n</body>',
      );
      const headers = new Headers(assetResponse.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      headers.delete("etag");
      return new Response(updatedHtml, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers,
      });
    }

    return env.ASSETS.fetch(request);
  },
};
