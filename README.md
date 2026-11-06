# TEM website

The site is served as a Cloudflare Worker with static assets. The contact form uses
Cloudflare Turnstile for bot protection and Cloudflare Email Sending to deliver
messages to `mark.gillis.ktyc@gmail.com`.

## Cloudflare setup

1. In Cloudflare Email Service, onboard `tem-ai.com` and complete its DNS/domain
   verification. This project uses `website@tem-ai.com` as the sender.
2. Create a Turnstile widget for the hostnames where the site will run (for
   example, `tem-ai.com` and `www.tem-ai.com`). Replace
   `REPLACE_WITH_TURNSTILE_SITE_KEY` in `wrangler.toml` with the widget's site
   key.
3. Install dependencies and authenticate Wrangler:

   ```sh
   npm install
   npx wrangler login
   ```

4. Store the Turnstile secret as a Worker secret:

   ```sh
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

5. Deploy the site:

   ```sh
   npm run deploy
   ```

6. In the Cloudflare dashboard, add the deployed Worker as a custom domain for
   the website. Ensure the domain is covered by the Turnstile widget's hostname
   list. The email binding is restricted to the sender and recipient above.

The sender address is set to `website@tem-ai.com` based on the domain shown in
the supplied site sample. If that is not a domain you control, update
`EMAIL_FROM` and the `allowed_sender_addresses` entry in `wrangler.toml` to an
onboarded Email Service sender address before deploying.

## Local checks

```sh
npm test
```
