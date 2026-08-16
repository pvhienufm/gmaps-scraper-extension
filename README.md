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
5. Use the **config panel** that appears top-left

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
- **Start / Stop** — Stop halts scrolling/enrichment mid-run.
- **Export** — CSV / JSON download or Copy CSV to clipboard, on the filtered rows.

Config is remembered between runs via `chrome.storage.local`.

Details mode is slow (~2–4 s/place) and takes over the tab while running; keep
`Max results` modest.

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

- **Google Sheets export** — push results straight into a sheet (OAuth via
  `chrome.identity`, or an Apps Script webhook).
- **Results preview table** + select/deselect rows before export.
- **Persist results** across tab reloads (currently config persists, rows don't).
- **Reviews & photos** scraping for directory use.
- Package for the Chrome Web Store (data-extraction extensions face review; keep a
  sideload `.zip` / Edge fallback).
