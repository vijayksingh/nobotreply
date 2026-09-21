# no bot reply

**Stop sending AI-written replies under your own name. Write something real, or say nothing at all.**

A single-page site in the spirit of [noslopgrenade.com](https://noslopgrenade.com) and
[nohello.net](https://nohello.net), available in 18 languages.

The premise: an AI reply sent from a human account is a lie about who is talking.
It lands in a DM, a comment thread, a reply, an inbox — same shape every time, nobody
typed it. Either write something a human would actually say, or don't reply at all.

---

## Performance

Every page is **one HTTP request**. No framework, no web fonts, no image files, no
external CSS or JS, no analytics, no cookies.

| metric | value |
| --- | --- |
| HTML per page (raw) | ~24 KB |
| HTML per page (gzipped) | **~7.5 KB** |
| Render-blocking subresources | **0** |
| Requests to first paint | **1** |
| Third-party requests | **0** |
| External dependencies | **0** |

CSS is inlined into each page (copied from `src/style.css` at build time), avatars are
inline SVG data URIs, and the two behavioural scripts — the expand toggle and the share
button — are ~600 bytes of vanilla JS total. Fonts are the system stack, so text paints
immediately.

### The `no-transform` header is load-bearing

Cloudflare's proxy **rewrites your HTML at the edge** and injects a bot-verification
script called [Precursor](https://developers.cloudflare.com/cloudflare-challenges/precursor/)
before `</body>`. That script then pulls in a further ~34 KB of JavaScript. Measured on
the live domain, mobile Lighthouse profile:

| | requests | transferred | bootup | TBT | performance |
| --- | --- | --- | --- | --- | --- |
| injection on | 9 | 43 KB | 1.6 s | **760 ms** | **82** |
| injection off | 4 | 9 KB | 0.0 s | **0 ms** | **100** |

[Cloudflare's own docs](https://developers.cloudflare.com/web-analytics/get-started/)
note that a `public, no-transform` cache directive stops the proxy from modifying the
payload. So `dist/_headers` sets it on the HTML, and the injection stops. Verified: the
served HTML is byte-for-byte the generated file.

This is a deliberate trade, and it is reversible — delete `no-transform` from the `/*`
block in `build.mjs` and redeploy to get Precursor back. What it does **not** affect:

- **Bot Fight Mode** and all server-side bot/DDoS/WAF protection — untouched, those run
  at the edge regardless of what is injected into the page.
- **Challenges and interstitials** — a real challenge is a served response, not a payload
  rewrite, so it still works.

What it *does* stop is Precursor's continuous client-side verification loop on this
domain, and Cloudflare's automatic Web Analytics beacon injection. Precursor cannot be
deferred — it is a security script whose whole job is to run in-page, so the only choice
is run or don't. For a static page with no forms, logins or API there is nothing for the
client-side loop to protect.

### If you want Web Analytics back, for free

Web Analytics is **not** currently enabled for `nobotreply.com` (the account has it on
five other zones). If you add it, don't use the automatic setup — that injects the
beacon into the HTML, which is exactly what `no-transform` suppresses. Instead set the
site tag and the build emits an idle-loaded loader:

```bash
CF_ANALYTICS_TOKEN=<site tag> npm run build
```

The beacon is then created inside a `requestIdleCallback`, so it is fetched after the
page is interactive and contributes nothing to blocking time. Find the tag under
Analytics & Logs → Web Analytics → *site* → Manage site → JS snippet. It is public — it
ships in the HTML of every site that uses it.

## Layout

```
build.mjs              zero-dependency static site generator
content/
  en.json              source of truth — every other locale mirrors its keys
  ar.json … vi.json    17 translations
src/style.css          the single stylesheet, inlined into every page
public/                copied verbatim into dist/ (favicon, og-image)
tools/
  og-card.html         the social card, authored as real HTML + inline SVG
  make-og.sh           renders og-card.html -> public/og-image.png at 2x
  verify.mjs           335 assertions across all generated pages
  shot.sh              headless-Chrome screenshot helper
dist/                  generated output — deploy this directory
```

### The social card

`tools/og-card.html` is the source; `npm run og` renders it. It is written as
plain HTML with **inline SVG for every icon** — the bubble mark, the ✕/✓ discs and
the muted dash — so nothing depends on a font glyph, an emoji set or an external
asset. Chrome renders it at 2x and Pillow downsamples with Lanczos, because at 1x
the small icons come out visibly soft.

To change the copy or the layout, edit the HTML and re-run `npm run og`. The card
is deliberately one image for all locales; `og:locale` still varies per page.

## Commands

```bash
npm run build          # generate dist/
npm run build:strict   # same, but fail if any translation is missing or malformed
npm run verify         # check every generated page (links, hreflang, JS, budget)
npm run check          # build:strict + verify — what CI runs
npm run serve          # build and preview on http://localhost:8080
npm run og             # regenerate the social preview image
```

Requires Node 18+. There are no dependencies to install — `wrangler` is a dev
dependency only needed for deploying.

## Adding or editing a language

1. Copy `content/en.json` to `content/<code>.json`.
2. Translate the **values only** — never the keys.
3. Keep `[text](url)`, `**bold**` and `*italic*` markers intact; keep
   `siteLabel` as `nobotreply.com`; keep `h1` lowercase with its trailing period.
4. Set `lang`, `name` (native name) and `dir` (`rtl` for right-to-left scripts).
5. Add the code to `ORDER` and `OG_LOCALE` in `build.mjs`, plus `more`/`less`/
   `copied`/`language` strings in the `UI` map.
6. `npm run check`.

The build fails loudly on a missing key, a malformed link, or a `lang` that
disagrees with its filename, so a bad translation can't ship silently.

## CI/CD

Two GitHub Actions workflows in `.github/workflows/`.

### `ci.yml` — checks (no secrets, no network, seconds)

Runs on every push to `main` and every pull request. Strict build, the full
verifier, then uploads `dist/` as a build artifact. Nothing here can deploy.

### `deploy.yml` — ships to production

Runs on a push to `main`, on a `v*` tag, or manually from the Actions tab.

### Re-deploying on demand with a tag

```bash
git tag v1.0.1
git push origin v1.0.1
```

That is the whole retrigger. Any `v*` tag builds, verifies and deploys to
`https://nobotreply.com`, whatever changed since the last release. To re-ship the
current commit unchanged, tag `HEAD` again with a new version.

You can also use the **Run workflow** button in the Actions tab, which takes an
optional `reason` string that lands in the run summary.

### How the deploy actually works

Not `wrangler-action`, deliberately:

> The Cloudflare token in `/opt/infra/secrets/cloudflare.env` is **IP-restricted
> to the infra machine**, so a GitHub runner cannot use it. That restriction is worth
> keeping.

So the job builds and verifies on the runner, then streams the source over SSH to
the infra machine, which runs the real deploy with the token that never leaves it:

```
GitHub runner ──tar over ssh──▶ the infra machine ──wrangler──▶ Cloudflare Pages
   build + verify                 forced command            nobotreply.com
```

The SSH key is a dedicated `nobotreply-ci-deploy` ed25519 with a forced
`command=` in `authorized_keys`, so it can do exactly one thing:

```
restrict,command="~/bin/nobotreply-ci-deploy" ssh-ed25519 AAAA… nobotreply-ci-deploy
```

To revoke CI's access, delete that line from
the deploy user’s `~/.ssh/authorized_keys` and the `DEPLOY_SSH_KEY` secret.

| Secret | Purpose |
| --- | --- |
| `DEPLOY_SSH_KEY` | private half of `nobotreply-ci-deploy` |
| `DEPLOY_KNOWN_HOSTS` | pinned host key for the infra machine |
| `DEPLOY_HOST` | the infra machine's address |
| `DEPLOY_USER` | the deploy user |

If you ever want CI to call Cloudflare directly instead, create a token with
`Account → Cloudflare Pages → Edit`, leave **Client IP Address Filtering off**,
and swap the last two steps of `deploy.yml` for `cloudflare/wrangler-action@v3`.

## Deploying by hand

Live at **https://nobotreply.com** (Cloudflare Pages project `nobotreply`).

From this machine — syncs the tree and deploys on the infra host:

```bash
scripts/push.sh
```

Or on the infra machine (`the infra machine`), from `~/projects/nobotreply`:

```bash
npm install            # once — installs wrangler, the only dev dependency
scripts/deploy.sh      # strict build + verify + wrangler pages deploy
```


`scripts/wrangler-infra` wraps wrangler so the Cloudflare token is read from
`/opt/infra/secrets/cloudflare.env` and handed only to the wrangler process —
matching how the other projects on that machine are set up.

### Custom domain

Both `nobotreply.com` and `www.nobotreply.com` are attached to the Pages project.
`www` is 301'd to the apex by `public/_redirects`, so it never serves a duplicate.

Two proxied CNAMEs are needed:

```
nobotreply.com      CNAME  nobotreply.pages.dev  (proxied)
www.nobotreply.com  CNAME  nobotreply.pages.dev  (proxied)
```

```bash
sudo scripts/reconcile-dns.sh   # creates/updates both records
```

That script needs the Cloudflare API token to include the `nobotreply.com` zone.
The token in `/opt/infra/secrets/cloudflare.env` has `DNS:Edit` scoped to
**specific zones** — it currently covers only `unlocalhosted.com`, so DNS calls
for any other zone (including this one) return `403 Authentication error`.

Fix either way:

- **Token** — My Profile → API Tokens → edit the token → the `DNS` permission's
  Zone Resources → Include → All zones (or add `nobotreply.com`), then re-run
  the script.
- **Manual** — DNS → Records → Add record, twice, using the two CNAMEs above
  with Proxy enabled.

`Pages:Edit` is account-wide, which is why deploying works regardless.

### Any other host

`dist/` is plain static files.

```bash
npx netlify deploy --prod --dir=dist
npx vercel deploy --prod dist
```

`dist/_headers` sets immutable caching for the favicon and og-image on hosts that
read it (Cloudflare Pages, Netlify). Set the domain in one place — the `SITE`
constant in `build.mjs` — and rebuild to update every canonical URL, `hreflang`
alternate and sitemap entry.

## Accessibility & correctness

- Semantic landmarks, one `<h1>`, `<html lang>` (and `dir="rtl"` for Arabic).
- Visible focus rings on every interactive element; the expand toggle is a real
  `<button>` with `aria-expanded` and `aria-controls`.
- Arabic gets `letter-spacing: 0` — negative tracking breaks Arabic letter joining.
- RTL layout uses logical properties (`padding-inline-start`, `inset-inline-start`).
- CJK and Arabic wordmarks get a reduced `h1` size so they stay inside the measure.
- Respects `prefers-reduced-motion`.
- Canonical plus 18 `hreflang` alternates and `x-default` on every page, with a
  matching `sitemap.xml`.

---

Made by [Vijay Singh](https://github.com/vijayksingh) ·
[GitHub](https://github.com/vijayksingh) ·
[LinkedIn](https://www.linkedin.com/in/iamvijaysingh/) ·
[X](https://twitter.com/dprophecyguy)

Inspired by [noslopgrenade.com](https://noslopgrenade.com) and
[nohello.net](https://nohello.net).
