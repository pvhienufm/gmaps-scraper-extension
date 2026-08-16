// GMaps Scraper — content script.
//
// Runs inside the user's own Google Maps tab. Two modes:
//   1. Fast    — scroll the results feed, read each card (name, rating,
//                reviews, category, price, coords). One page, seconds.
//   2. Details — additionally open each place to read the authoritative
//                address, phone, website, hours, plus code from the detail
//                panel's data-item-id buttons. Slower, hijacks the tab.
//
// Selectors mirror the Playwright scraper in ~/vietnam-directory/scraper/
// google_maps.py. Google's markup is obfuscated and changes periodically — if
// fields go blank, refresh the class names / data-item-id hooks below.

(() => {
  "use strict";

  const FEED = 'div[role="feed"]';
  const CARD = "div.Nv2PK"; // one result card in the feed
  const LINK = "a.hfpxzc"; // anchor whose aria-label is the place name

  const COORDS_RE = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/;
  const FALLBACK_COORDS_RE = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
  const PRICE_RE = /[₫$€£]|\d\s*[–-]\s*\d/;
  const HOURS_RE = /\b(Open|Closed|Closes|Opens|24 hours|Temporarily|Permanently)\b/i;
  const NAME_JUNK_RE = /\s*[·⋅]\s*(Visited link|Sponsored|Ad)\s*$/i;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const COLUMNS = [
    "name",
    "rating",
    "reviews",
    "category",
    "price",
    "address",
    "phone",
    "website",
    "email",
    "socials",
    "hours",
    "plus_code",
    "lat",
    "lng",
    "url",
  ];

  // Websites that are really social pages — don't fetch them for email, just
  // record the handle from the URL itself.
  const SOCIAL_HOST_RE = /(facebook|instagram|tiktok|youtube|zalo|linkedin)\./i;

  const blankRow = () => Object.fromEntries(COLUMNS.map((c) => [c, ""]));

  // ---- feed extraction (fast) --------------------------------------------

  const parseCoords = (url) => {
    const m = COORDS_RE.exec(url) || FALLBACK_COORDS_RE.exec(url);
    return m ? { lat: m[1], lng: m[2] } : { lat: "", lng: "" };
  };

  // Read the meta lines of a card. The rating lives in its own .W4Efsd (drop
  // it), the rest hold "Category · Price", a neighbourhood/address line, and an
  // "Open · Closes 10 PM" line. Google mixes middot (·) and dot-operator (⋅).
  const parseInfo = (card) => {
    const lines = [
      ...new Set(
        [...card.querySelectorAll("div.W4Efsd")]
          .filter(
            (el) =>
              !el.querySelector("div.W4Efsd") && !el.querySelector("span.MW4etd")
          )
          .map((el) => el.textContent.replace(/\s+/g, " ").trim())
          .filter(Boolean)
      ),
    ];
    let category = "";
    let price = "";
    let address = "";
    for (const line of lines) {
      for (const seg of line.split(/[·⋅]/).map((s) => s.trim()).filter(Boolean)) {
        if (!price && PRICE_RE.test(seg)) {
          price = seg;
        } else if (HOURS_RE.test(seg)) {
          // skip open/closed status in fast mode
        } else if (!category) {
          category = seg;
        } else if (!address && seg !== category) {
          address = seg;
        }
      }
    }
    return { category, price, address };
  };

  const cleanName = (raw) => (raw || "").replace(NAME_JUNK_RE, "").trim();

  const extractCard = (card) => {
    const link = card.querySelector(LINK);
    if (!link) return null;
    const name = cleanName(link.getAttribute("aria-label"));
    if (!name) return null;
    const url = link.href || "";
    const row = blankRow();
    const { lat, lng } = parseCoords(url);
    const { category, price, address } = parseInfo(card);
    Object.assign(row, {
      name,
      rating: (card.querySelector("span.MW4etd")?.textContent || "").trim(),
      reviews: (card.querySelector("span.UY7F9")?.textContent || "").replace(/[^\d]/g, ""),
      category,
      price,
      address,
      website: card.querySelector('a[data-value="Website"]')?.href || "",
      lat,
      lng,
      url,
    });
    return row;
  };

  const collect = () => {
    const rows = [];
    const seen = new Set();
    for (const card of document.querySelectorAll(CARD)) {
      const row = extractCard(card);
      if (row && !seen.has(row.url)) {
        seen.add(row.url);
        rows.push(row);
      }
    }
    return rows;
  };

  // Scroll the feed until it stops growing ("You've reached the end of the
  // list"), mirroring the Playwright scroll loop.
  async function autoScroll(max, onProgress) {
    const feed = document.querySelector(FEED);
    if (!feed) return;
    let stagnant = 0;
    for (let i = 0; i < 40; i++) {
      const before = collect().length;
      onProgress(before);
      if (before >= max) break;
      feed.scrollBy(0, feed.scrollHeight);
      await sleep(1600);
      const after = collect().length;
      if (after === before) {
        if (++stagnant >= 3) break;
      } else {
        stagnant = 0;
      }
    }
  }

  // ---- detail panel extraction (slow) ------------------------------------

  const ariaValue = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return "";
    const label = el.getAttribute("aria-label") || "";
    if (!label) return "";
    return label.includes(":") ? label.split(":").slice(1).join(":").trim() : label.trim();
  };

  // Google jams the weekly hours together with no separators and appends UI
  // cruft ("Suggest new hours"). Split on weekday names and drop the cruft.
  const DAY_RE = /(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/g;
  const formatHours = (raw) => {
    if (!raw) return "";
    const cleaned = raw
      .replace(/[\uE000-\uF8FF]/g, "") // strip Google Material icon glyphs (PUA)
      .replace(/Suggest new hours/gi, " ")
      .replace(/Hide open hours.*$/i, " ")
      .replace(/ /g, " ") // narrow no-break space inside times
      .replace(/\s+/g, " ")
      .trim();
    return cleaned
      .replace(DAY_RE, "\n$1 ")
      .split("\n")
      .map((s) => s.replace(/[,;]\s*$/, "").trim())
      .filter(Boolean)
      .join("; ");
  };

  // Price band shown in the detail header ("₫₫", "$$", or "₫100,000–200,000").
  const findPrice = (panel) => {
    for (const s of panel.querySelectorAll("span")) {
      const t = s.textContent.trim();
      if (/^[₫$€£]{1,4}$/.test(t) || /^[₫$][\s]?\d[\d.,]*\s*[–-]\s*\d/.test(t)) return t;
    }
    return "";
  };

  const extractDetail = () => {
    const out = {};
    const panel = document.querySelector('div[role="main"]') || document;
    out.address = ariaValue('button[data-item-id="address"]');
    const phoneBtn = document.querySelector('button[data-item-id^="phone:tel:"]');
    if (phoneBtn) out.phone = phoneBtn.getAttribute("data-item-id").replace("phone:tel:", "").trim();
    const site = document.querySelector('a[data-item-id="authority"]');
    if (site) out.website = site.href;
    out.plus_code = ariaValue('button[data-item-id="oloc"]');
    const cat = document.querySelector("button.DkEaL") || document.querySelector('button[jsaction*="category"]');
    if (cat) out.category = cat.textContent.trim();
    out.price = findPrice(panel);
    const hours = document.querySelector(".t39EBf") || document.querySelector('[jsaction*="openhours"]');
    if (hours) out.hours = formatHours(hours.getAttribute("aria-label") || hours.textContent || "");
    return out;
  };

  const waitFor = async (fn, timeout = 7000, step = 200) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  };

  // Feed virtualises: an anchor may unload after we navigate away. Re-find it
  // by href, scrolling the feed to force a re-render if needed.
  async function locateAnchor(url) {
    const feed = document.querySelector(FEED);
    for (let i = 0; i < 8; i++) {
      const a = [...document.querySelectorAll(LINK)].find((x) => x.href === url);
      if (a) return a;
      if (feed) feed.scrollBy(0, feed.scrollHeight);
      await sleep(600);
    }
    return null;
  }

  // Ask the background worker to fetch the website and pull emails/socials.
  async function enrichEmail(row) {
    if (!row.website) return;
    if (SOCIAL_HOST_RE.test(row.website)) {
      row.socials = row.website; // the "website" is itself a social page
      return;
    }
    try {
      const info = await chrome.runtime.sendMessage({ type: "enrichSite", url: row.website });
      if (info) {
        if (info.email) row.email = info.email;
        if (info.socials) row.socials = info.socials;
      }
    } catch {
      /* worker unavailable — leave email blank */
    }
  }

  // Open each place, enrich its row from the detail panel, fetch emails, go back.
  async function enrich(rows, onProgress, withEmail) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      onProgress(i + 1, rows.length);
      const placeLoaded = () => {
        const h = document.querySelector("h1.DUwDvf");
        return h && h.textContent.trim() ? h : null;
      };
      // Two attempts: the feed sometimes eats the first click before the panel
      // navigates, which is what leaves rows with only the short feed address.
      let ok = null;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        const anchor = await locateAnchor(row.url);
        if (!anchor) break;
        anchor.scrollIntoView({ block: "center" });
        anchor.click();
        ok = await waitFor(placeLoaded, 8000);
      }
      if (ok) {
        await sleep(400); // let the info buttons render
        const d = extractDetail();
        for (const k of Object.keys(d)) if (d[k]) row[k] = d[k];
        if (withEmail) await enrichEmail(row);
      }
      history.back();
      await waitFor(() => document.querySelector(FEED));
      await sleep(600);
    }
  }

  // ---- CSV ----------------------------------------------------------------

  const csvCell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const toCSV = (rows) =>
    [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\n");

  const download = (rows) => {
    const blob = new Blob(["﻿" + toCSV(rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const a = document.createElement("a");
    a.href = url;
    a.download = `gmaps-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- UI -----------------------------------------------------------------

  const bar = document.createElement("div");
  Object.assign(bar.style, {
    position: "fixed",
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "99999",
    display: "flex",
    gap: "8px",
  });

  const mkButton = (label, bg) => {
    const b = document.createElement("button");
    Object.assign(b.style, {
      padding: "10px 16px",
      background: bg,
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      font: "600 13px/1.2 system-ui, sans-serif",
      boxShadow: "0 2px 8px rgba(0,0,0,.25)",
      cursor: "pointer",
    });
    b.textContent = label;
    return b;
  };

  const fast = mkButton("⬇ Scrape (fast)", "#1a73e8");
  const full = mkButton("⬇ Scrape + details + emails", "#188038");
  bar.append(fast, full);

  let running = false;

  const guard = async (btn, base, task) => {
    if (running) return;
    if (!document.querySelector(FEED)) {
      btn.textContent = "Open a search first";
      setTimeout(() => (btn.textContent = base), 2000);
      return;
    }
    running = true;
    fast.disabled = full.disabled = true;
    const idle = btn.style.background;
    btn.style.background = "#5f6368";
    try {
      await task((t) => (btn.textContent = t));
    } catch (e) {
      console.error("[gmaps-scraper]", e);
      btn.textContent = "Error — see console";
    } finally {
      running = false;
      fast.disabled = full.disabled = false;
      btn.style.background = idle;
      setTimeout(() => (btn.textContent = base), 4000);
    }
  };

  fast.addEventListener("click", () =>
    guard(fast, "⬇ Scrape (fast)", async (label) => {
      await autoScroll(300, (n) => label(`Scrolling… ${n}`));
      const rows = collect();
      if (!rows.length) return label("No results found");
      download(rows);
      label(`✓ ${rows.length} rows → CSV`);
    })
  );

  full.addEventListener("click", () =>
    guard(full, "⬇ Scrape + details + emails", async (label) => {
      await autoScroll(300, (n) => label(`Scrolling… ${n}`));
      const rows = collect();
      if (!rows.length) return label("No results found");
      await enrich(rows, (i, n) => label(`Enriching ${i}/${n}`), true);
      download(rows);
      label(`✓ ${rows.length} rows → CSV`);
    })
  );

  document.body.appendChild(bar);
})();
