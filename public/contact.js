const contactSection = document.querySelector("#contact");
const contactButton = document.querySelector("#contact-button");
const contactNote = document.querySelector("#contact-note");

if (contactSection && contactButton && contactNote) {
  const form = document.createElement("form");
  form.className = "contact-form";
  form.innerHTML = `
    <label for="contact-name">Your name</label>
    <input id="contact-name" name="name" autocomplete="name" maxlength="120" required>
    <label for="contact-email">Email address</label>
    <input id="contact-email" name="email" type="email" autocomplete="email" maxlength="254" required>
    <label for="contact-message">How can I help?</label>
    <textarea id="contact-message" name="message" rows="5" maxlength="5000" required></textarea>
    <div class="contact-trap" aria-hidden="true">
      <label for="contact-website">Leave this field empty</label>
      <input id="contact-website" name="website" tabindex="-1" autocomplete="off">
    </div>
    <div id="turnstile-widget"></div>
    <p id="contact-status" role="status" aria-live="polite"></p>
    <button class="button red" type="submit" disabled>Send message →</button>
  `;

  const style = document.createElement("style");
  style.textContent = `
    .contact-form { max-width: 520px; margin: 32px auto 0; text-align: left; }
    .contact-form label { text-align: left; }
    .contact-form textarea { resize: vertical; }
    .contact-form #turnstile-widget { margin-top: 20px; }
    .contact-form #contact-status { min-height: 1.5em; margin: 12px 0 0; font-size: 13px; }
    .contact-trap { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
    .contact-form button:disabled { cursor: wait; opacity: .7; }
  `;
  document.head.append(style);

  contactButton.replaceWith(form);
  contactNote.remove();

  const submitButton = form.querySelector('button[type="submit"]');
  const status = form.querySelector("#contact-status");
  const turnstileContainer = form.querySelector("#turnstile-widget");
  let turnstileToken = "";
  let widgetId;

  async function initializeTurnstile() {
    try {
      const configResponse = await fetch("/api/config", { cache: "no-store" });
      if (!configResponse.ok) throw new Error("Turnstile configuration is unavailable.");
      const { siteKey } = await configResponse.json();
      if (!siteKey) throw new Error("Turnstile site key is missing.");

      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = () => {
        widgetId = window.turnstile.render(turnstileContainer, {
          sitekey: siteKey,
          action: "contact",
          callback(token) {
            turnstileToken = token;
            submitButton.disabled = false;
          },
          "expired-callback"() {
            turnstileToken = "";
            submitButton.disabled = true;
          },
          "error-callback"() {
            turnstileToken = "";
            submitButton.disabled = true;
            status.textContent = "Captcha could not load. Please refresh and try again.";
          },
        });
      };
      script.onerror = () => {
        status.textContent = "Captcha could not load. Please refresh and try again.";
      };
      document.head.append(script);
    } catch (error) {
      status.textContent = error.message;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!turnstileToken || !form.reportValidity()) return;

    submitButton.disabled = true;
    status.textContent = "Sending your message…";
    const data = new FormData(form);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          message: data.get("message"),
          website: data.get("website"),
          turnstileToken,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        status.textContent = result.error || "Your message could not be sent. Please try again.";
        turnstileToken = "";
        window.turnstile.reset(widgetId);
        return;
      }

      form.reset();
      status.textContent = "Thanks — your message has been sent.";
      turnstileToken = "";
      window.turnstile.reset(widgetId);
    } catch {
      status.textContent = "We could not send your message. Please try again.";
      turnstileToken = "";
      window.turnstile.reset(widgetId);
    } finally {
      submitButton.disabled = true;
    }
  });

  initializeTurnstile();
}
