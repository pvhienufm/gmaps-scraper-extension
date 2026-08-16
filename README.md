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
5. Click one of the two buttons at the top of the page

Both auto-scroll the results feed to lazy-load listings, then download
`gmaps-<timestamp>.csv` with columns: name, rating, reviews, category, price,
address, phone, website, email, socials, hours, plus_code, lat, lng, url.

## Two modes

- **⬇ Scrape (fast)** — reads the results feed only. Seconds. Reliable fields:
  name, rating, reviews, category, price, coords. Address/phone/hours are often
  blank here (Google doesn't put them in the card).
- **⬇ Scrape + details + emails (green)** — after scrolling, opens each place and
  reads the authoritative **address, phone, website, hours, plus code** from the
  detail panel's `data-item-id` buttons, then fetches the business website in the
  background to pull **email** (from `mailto:` links + page text, following one
  "contact" page if needed) and **social** handles. Slow (~2–4 s/place) and takes
  over the tab while running. Best for modest result counts.

## Permissions

The green mode needs `host_permissions: <all_urls>` so the background service
worker can fetch arbitrary business websites (content scripts can't read
cross-origin bodies — CORS). Chrome shows this as "Read your data on all
websites". Nothing is sent anywhere; fetches happen from your machine.

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

## Next steps (toward a sellable product)

- **Email enrichment** (#3): visit each website, regex emails + social handles —
  the highest-value field, not available on Maps itself.
- **Lead-gen filters**: min rating, min reviews, has-website / no-website.
- **Freemium gate**: limit free exports to ~15 rows; unlock bulk + Sheets export
  behind a license key checked against a tiny backend.
- Package for the Chrome Web Store (data-extraction extensions face review; keep a
  sideload `.zip` / Edge fallback).
