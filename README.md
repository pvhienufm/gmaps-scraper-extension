# GMaps Scraper (local prototype)

Minimal Manifest V3 Chrome extension that scrapes the **visible Google Maps
search results feed** and exports a CSV. Runs entirely in your own browser tab —
no server, no API key, uses your own IP/session.

Ports the extraction logic from the Playwright scraper in
`~/vietnam-directory/scraper/google_maps.py` (feed scroll loop, rating/review
parsing, lat/lng from the place URL).

## Load it locally

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top-right)
3. Click **Load unpacked** → select this folder (`~/gmaps-scraper-extension`)
4. Go to https://www.google.com/maps and search, e.g. `hotels in Da Lat`
5. Click the round **📍 button** at the bottom-right to open the panel

Columns available: name, rating, reviews, category, price, address, phone,
website, email, socials, hours, plus_code, lat, lng, url.

## Config panel

- **Max results** — cap how many listings to scrape.
- **Fetch details** — open each place for authoritative address, phone, website,
  hours, plus code (`data-item-id` buttons). Off = fast feed-only scrape.
- **Fetch emails + socials** — background-fetch each business website and pull
  email (from `mailto:` links + page text, following one "contact" page) and
  social handles. Needs details on.
- **Filters** — min rating, min reviews, only-with-website, **only WITHOUT
  website** (lead-gen: businesses to sell a site to), only-with-phone.
- **Export fields** — tick which columns land in the export.
- **Start / Stop** — a progress bar + step text show scrolling / enriching
  (`i/n` + place name); Stop halts mid-run.
- **Export** — CSV / JSON download or Copy CSV to clipboard, on the filtered rows.

Works on both a **search results list** and a **single place** you have open
(no list needed). Config is remembered via `chrome.storage.local`. Details mode is
slow (~2–4 s/place) and takes over the tab; keep `Max results` modest.

## Export to Google Sheets

### Option A — "Sign in with Google" (best for end users, one-time dev setup)

The green **Sign in with Google → Sheet** button creates a new spreadsheet in the
user's Drive and opens it — the user just consents, no technical steps. To enable
it, the developer configures an OAuth client once:

1. Load the extension; copy its **ID** from `chrome://extensions` (stable while
   loaded from the same folder path).
2. In Google Cloud Console (a project with **Google Sheets API** + **Drive API**
   enabled): *APIs & Services → Credentials → Create OAuth client ID →
   Application type: **Chrome Extension*** → paste the extension ID.
3. Copy the client ID into `manifest.json` → `oauth2.client_id`.
4. *OAuth consent screen*: add the two scopes and add your Google account under
   **Test users** (needed while the app is unverified).
5. Reload the extension. (Publishing to the Web Store later gives a new ID —
   update the OAuth client then.)

### Option B — Apps Script webhook (advanced, under the "Advanced" toggle)

Zero OAuth, but each user must deploy `apps-script.gs`:

1. Open the target Sheet → **Extensions → Apps Script**, paste `apps-script.gs`.
2. **Deploy → New deployment → Web app**: *Execute as: Me*, *Who has access:
   Anyone*. Copy the `/exec` URL.
3. Paste it into the panel's **Advanced → Apps Script webhook** field, click
   **Send to webhook**. The URL is a shared secret; keep it private.

## Permissions

- `storage` — remembers your panel config between runs.
- `host_permissions: <all_urls>` — lets the background service worker fetch
  arbitrary business websites for emails (content scripts can't read cross-origin
  bodies — CORS). Chrome shows this as "Read your data on all websites". Nothing
  is sent anywhere; fetches happen from your machine.

## Email limitations

Email works best when the "website" is a real domain. It won't find emails when:
the site is a Facebook/Instagram page (login wall — the handle is recorded under
`socials` instead), the address is Cloudflare-obfuscated (`[email protected]`),
or the email only renders via JavaScript (the worker reads raw HTML, not JS).

## Known fragility

Google's markup is obfuscated and changes periodically. If columns go blank,
update the selectors near the top of `content.js`: feed uses `Nv2PK`, `hfpxzc`,
`MW4etd`, `UY7F9`, `W4Efsd`; the detail panel uses `data-item-id` hooks
(`address`, `phone:tel:`, `authority`, `oloc`) plus `h1.DUwDvf` / `.t39EBf`.

## Next steps

- **Results preview table** + select/deselect rows before export.
- **Persist results** across tab reloads (currently config persists, rows don't).
- **Reviews & photos** scraping for directory use.
- Package for the Chrome Web Store (data-extraction extensions face review; keep a
  sideload `.zip` / Edge fallback).
