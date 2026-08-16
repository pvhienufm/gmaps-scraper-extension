// Background service worker: fetch a business website and extract contact info.
//
// Content scripts can't read cross-origin responses (CORS blocks the body); the
// service worker can, thanks to host_permissions. It pulls emails from mailto:
// links and page text, optionally follows one "contact" page, and records
// social handles. The content script messages it one website URL at a time.

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Reject strings that look like emails but aren't (asset filenames, vendor noise).
const BAD_EMAIL_EXT = /\.(png|jpe?g|gif|webp|svg|css|js)$/i;
const BAD_EMAIL_DOMAIN =
  /(sentry|wixpress|example\.(com|org)|godaddy|schema\.org|w3\.org|googleapis|gstatic|cloudflare|\.png|\.jpg)/i;

const SOCIAL_RES = {
  facebook: /https?:\/\/(?:www\.|m\.)?facebook\.com\/[^\s"'<>)]+/i,
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>)]+/i,
  tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/@[^\s"'<>)]+/i,
  youtube: /https?:\/\/(?:www\.)?youtube\.com\/[^\s"'<>)]+/i,
  zalo: /https?:\/\/zalo\.me\/[^\s"'<>)]+/i,
};

async function fetchText(url, timeout = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") || "";
    if (ct && !/text|html|xml/i.test(ct)) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function extractEmails(html) {
  const found = new Set();
  // mailto: links are the most reliable signal.
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    try {
      found.add(decodeURIComponent(m[1]).toLowerCase());
    } catch {
      found.add(m[1].toLowerCase());
    }
  }
  for (const m of html.match(EMAIL_RE) || []) {
    const e = m.toLowerCase();
    if (!BAD_EMAIL_EXT.test(e) && !BAD_EMAIL_DOMAIN.test(e)) found.add(e);
  }
  return [...found].slice(0, 5);
}

function extractSocials(html) {
  const out = [];
  for (const re of Object.values(SOCIAL_RES)) {
    const m = html.match(re);
    if (m) out.push(m[0]);
  }
  return out;
}

// Find a same-purpose "contact" link to follow when the homepage has no email.
function findContactUrl(html, base) {
  const re = /href\s*=\s*["']([^"']+)["'][^>]*>([^<]{0,40})/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const text = m[2] || "";
    if (/contact|li[eê]n.?h[eệ]/i.test(href + text)) {
      try {
        return new URL(href, base).href;
      } catch {
        /* ignore malformed */
      }
    }
  }
  return null;
}

async function enrichSite(url) {
  const html = await fetchText(url);
  if (!html) return { email: "", socials: "" };
  let emails = extractEmails(html);
  const socials = extractSocials(html);
  if (!emails.length) {
    const contact = findContactUrl(html, url);
    if (contact && contact !== url) {
      const chtml = await fetchText(contact);
      if (chtml) {
        emails = extractEmails(chtml);
        if (!socials.length) socials.push(...extractSocials(chtml));
      }
    }
  }
  return {
    email: emails.join("; "),
    socials: [...new Set(socials)].join(" | "),
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "enrichSite") {
    enrichSite(msg.url)
      .then(sendResponse)
      .catch(() => sendResponse({ email: "", socials: "" }));
    return true; // keep the channel open for the async response
  }
});
