# Privacy Policy — GMaps Scraper

_Last updated: 2026-08-16_

GMaps Scraper is a browser extension that runs entirely on your own device. It
does not have a backend server and its author does not receive, store, or see
any data you collect.

## What the extension accesses

- **Google Maps page content** — when you click **Start**, the extension reads
  the business listings currently shown in your Google Maps tab (name, rating,
  reviews, category, price, address, phone, website, hours, plus code,
  coordinates, and the place URL).
- **Business websites** — if you enable **Fetch emails + socials**, the
  extension's background worker fetches the public website of each listing to
  extract publicly listed email addresses and social-media links. This requires
  broad host access ("Read your data on all websites"); it is used only to
  request those business websites.
- **Google account (optional)** — if you use **Sign in with Google → Sheet**,
  the extension requests Google Sheets/Drive permission via Google OAuth so it
  can create a spreadsheet in *your* Drive and write your results into it. Tokens
  are handled by Chrome's identity service; the author never sees them.

## What happens to your data

- Collected rows stay in the browser tab until you export them (CSV, JSON,
  clipboard, your Google Sheet, or a webhook URL you provide).
- Your panel settings are saved locally via `chrome.storage.local`.
- Nothing is transmitted to the author or any third party other than the
  destinations you explicitly choose (Google's APIs, or a webhook URL you enter).

## Your controls

- Email enrichment and Google sign-in are optional and off unless you enable
  them.
- Uninstalling the extension removes its locally stored settings.

## Responsible use

Scraping Google Maps may conflict with Google's Terms of Service. Keep volumes
low and use the data responsibly. You are responsible for how you use anything
you collect.

## Contact

vietinsiders@gmail.com
