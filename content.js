// GMaps Scraper — content script.
//
// A small launcher button (bottom-right) opens a config panel. From there you
// can scrape a Google Maps search results list OR the single place currently
// open, enrich with details + emails, filter, and export to CSV/JSON/clipboard,
// a Google Sheet via OAuth ("Sign in with Google"), or an Apps Script webhook.
//
// Selectors mirror the Playwright scraper in ~/vietnam-directory/scraper/
// google_maps.py. Google's markup is obfuscated and changes periodically — if
// fields go blank, refresh the class names / data-item-id hooks below.

(() => {
  "use strict";

  const FEED = 'div[role="feed"]';
  const CARD = "div.Nv2PK";
  const LINK = "a.hfpxzc";
  const H1 = "h1.DUwDvf"; // place title in the detail panel

  const COORDS_RE = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/;
  const FALLBACK_COORDS_RE = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
  const PRICE_RE = /[₫$€£]|\d\s*[–-]\s*\d/;
  const HOURS_RE = /\b(Open|Closed|Closes|Opens|24 hours|Temporarily|Permanently)\b/i;
  const NAME_JUNK_RE = /\s*[·⋅]\s*(Visited link|Sponsored|Ad)\s*$/i;
  const DAY_RE = /(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/g;
  const SOCIAL_HOST_RE = /(facebook|instagram|tiktok|youtube|zalo|linkedin)\./i;

  const COLUMNS = [
    "name", "rating", "reviews", "category", "price", "address", "phone",
    "website", "email", "socials", "hours", "plus_code", "lat", "lng", "url",
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const blankRow = () => Object.fromEntries(COLUMNS.map((c) => [c, ""]));

  const DEFAULTS = {
    maxResults: 100,
    fetchDetails: true,
    fetchEmails: true,
    minRating: 0,
    minReviews: 0,
    onlyWithWebsite: false,
    noWebsite: false,
    onlyWithPhone: false,
    fields: Object.fromEntries(COLUMNS.map((c) => [c, true])),
    sheetUrl: "",
  };

  const state = { running: false, stop: false, rows: [] };
  let cfg = structuredClone(DEFAULTS);

  const loadCfg = async () => {
    try {
      const saved = await chrome.storage.local.get("cfg");
      if (saved.cfg) cfg = { ...DEFAULTS, ...saved.cfg, fields: { ...DEFAULTS.fields, ...saved.cfg.fields } };
    } catch {
      /* storage unavailable */
    }
  };
  const saveCfg = () => {
    try { chrome.storage.local.set({ cfg }); } catch { /* ignore */ }
  };

  // ---- feed extraction (fast) --------------------------------------------

  const parseCoords = (url) => {
    const m = COORDS_RE.exec(url) || FALLBACK_COORDS_RE.exec(url);
    return m ? { lat: m[1], lng: m[2] } : { lat: "", lng: "" };
  };

  const parseInfo = (card) => {
    const lines = [
      ...new Set(
        [...card.querySelectorAll("div.W4Efsd")]
          .filter((el) => !el.querySelector("div.W4Efsd") && !el.querySelector("span.MW4etd"))
          .map((el) => el.textContent.replace(/\s+/g, " ").trim())
          .filter(Boolean)
      ),
    ];
    let category = "", price = "", address = "";
    for (const line of lines) {
      for (const seg of line.split(/[·⋅]/).map((s) => s.trim()).filter(Boolean)) {
        if (!price && PRICE_RE.test(seg)) price = seg;
        else if (HOURS_RE.test(seg)) continue;
        else if (!category) category = seg;
        else if (!address && seg !== category) address = seg;
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
      category, price, address,
      website: card.querySelector('a[data-value="Website"]')?.href || "",
      lat, lng, url,
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

  async function autoScroll(max, onProgress) {
    const feed = document.querySelector(FEED);
    if (!feed) return;
    let stagnant = 0;
    for (let i = 0; i < 60 && !state.stop; i++) {
      const before = collect().length;
      onProgress(before);
      if (before >= max) break;
      feed.scrollBy(0, feed.scrollHeight);
      await sleep(1600);
      const after = collect().length;
      if (after === before) {
        if (++stagnant >= 3) break;
      } else stagnant = 0;
    }
  }

  // ---- detail panel extraction (slow) ------------------------------------

  const ariaValue = (sel) => {
    const el = document.querySelector(sel);
    const label = el?.getAttribute("aria-label") || "";
    if (!label) return "";
    return label.includes(":") ? label.split(":").slice(1).join(":").trim() : label.trim();
  };

  const formatHours = (raw) => {
    if (!raw) return "";
    const cleaned = raw
      .replace(/[\uE000-\uF8FF]/g, "") // strip Google Material icon glyphs (PUA)
      .replace(/Suggest new hours/gi, " ")
      .replace(/Hide open hours.*$/i, " ")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned
      .replace(DAY_RE, "\n$1 ")
      .split("\n")
      .map((s) => s.replace(/[,;]\s*$/, "").trim())
      .filter(Boolean)
      .join("; ");
  };

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

  const waitFor = async (fn, timeout = 8000, step = 200) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  };

  const placeLoaded = () => {
    const h = document.querySelector(H1);
    return h && h.textContent.trim() ? h : null;
  };

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

  async function enrichEmail(row) {
    if (!row.website) return;
    if (SOCIAL_HOST_RE.test(row.website)) { row.socials = row.website; return; }
    try {
      const info = await chrome.runtime.sendMessage({ type: "enrichSite", url: row.website });
      if (info) {
        if (info.email) row.email = info.email;
        if (info.socials) row.socials = info.socials;
      }
    } catch { /* worker unavailable */ }
  }

  async function enrich(rows, onProgress, withEmail) {
    for (let i = 0; i < rows.length && !state.stop; i++) {
      const row = rows[i];
      onProgress(i + 1, rows.length, row.name);
      let ok = null;
      for (let attempt = 0; attempt < 2 && !ok && !state.stop; attempt++) {
        const anchor = await locateAnchor(row.url);
        if (!anchor) break;
        anchor.scrollIntoView({ block: "center" });
        anchor.click();
        ok = await waitFor(placeLoaded, 8000);
      }
      if (ok) {
        await sleep(400);
        const d = extractDetail();
        for (const k of Object.keys(d)) if (d[k]) row[k] = d[k];
        if (withEmail) await enrichEmail(row);
      }
      history.back();
      await waitFor(() => document.querySelector(FEED));
      await sleep(600);
    }
  }

  // Scrape the single place currently open in the detail panel (no feed).
  async function scrapeSinglePlace() {
    const h = await waitFor(placeLoaded, 5000);
    if (!h) return null;
    await sleep(300);
    const row = blankRow();
    row.name = cleanName(h.textContent);
    row.url = location.href;
    const { lat, lng } = parseCoords(location.href);
    row.lat = lat; row.lng = lng;
    const d = extractDetail();
    for (const k of Object.keys(d)) if (d[k]) row[k] = d[k];
    if (cfg.fetchEmails) await enrichEmail(row);
    return row;
  }

  // ---- filter + export ----------------------------------------------------

  const applyFilters = (rows) =>
    rows.filter((r) => {
      if ((parseFloat(r.rating) || 0) < cfg.minRating) return false;
      if ((parseInt(r.reviews) || 0) < cfg.minReviews) return false;
      if (cfg.onlyWithWebsite && !r.website) return false;
      if (cfg.noWebsite && r.website) return false;
      if (cfg.onlyWithPhone && !r.phone) return false;
      return true;
    });

  const selectedFields = () => COLUMNS.filter((c) => cfg.fields[c]);

  const csvCell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCSV = (rows) => {
    const cols = selectedFields();
    return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
  };
  const toJSON = (rows) => {
    const cols = selectedFields();
    return JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), null, 2);
  };
  const toSheetPayload = (rows) => {
    const cols = selectedFields();
    return { columns: cols, rows: rows.map((r) => cols.map((c) => r[c])), title: `GMaps export ${new Date().toLocaleString()}` };
  };

  const downloadFile = (text, ext, mime) => {
    const blob = new Blob([ext === "csv" ? "﻿" + text : text], { type: mime });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const a = document.createElement("a");
    a.href = url;
    a.download = `gmaps-${stamp}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // OAuth ("Sign in with Google"): the worker creates a new Sheet in the user's
  // Drive and returns its URL. No per-user setup — just consent.
  async function sheetsOAuthExport(rows) {
    status("Signing in with Google…");
    try {
      const res = await chrome.runtime.sendMessage({ type: "sheetsExport", payload: toSheetPayload(rows) });
      if (res?.ok) {
        status(`✓ Created Sheet with ${res.added} rows`);
        window.open(res.url, "_blank");
      } else {
        status(res?.error?.includes("auth") ? "Google sign-in not set up yet (see README)" : `Sheet error: ${res?.error || "failed"}`);
      }
    } catch (e) {
      status("Sheet error — see console");
      console.error("[gmaps-scraper]", e);
    }
  }

  // Fallback: Apps Script webhook (advanced; needs a deployed script URL).
  async function pushToWebhook(rows) {
    if (!cfg.sheetUrl) return status("Paste the Apps Script webhook URL first");
    status("Sending to webhook…");
    try {
      const res = await chrome.runtime.sendMessage({ type: "pushSheet", url: cfg.sheetUrl, payload: toSheetPayload(rows) });
      status(res?.ok ? `✓ Added ${res.added} rows` : `Webhook error: ${res?.error || "failed"}`);
    } catch (e) {
      status("Webhook error — see console");
      console.error("[gmaps-scraper]", e);
    }
  }

  // ---- run ----------------------------------------------------------------

  let statusEl, countEl, progFill;
  const status = (t) => statusEl && (statusEl.textContent = t);
  const setCount = () => countEl && (countEl.textContent = `${state.rows.length} rows`);
  const setProgress = (p) => progFill && (progFill.style.width = `${Math.max(0, Math.min(100, p))}%`);

  async function run() {
    if (state.running) return;
    state.running = true;
    state.stop = false;
    setProgress(0);
    try {
      if (document.querySelector(FEED)) {
        // list flow
        status("Scrolling results…");
        await autoScroll(cfg.maxResults, (n) => {
          status(`Scrolling… found ${n}`);
          setProgress((n / cfg.maxResults) * 100);
        });
        let rows = collect().slice(0, cfg.maxResults);
        if (cfg.fetchDetails && !state.stop) {
          await enrich(rows, (i, n, name) => {
            status(`Enriching ${i}/${n}: ${name.slice(0, 24)}`);
            setProgress((i / n) * 100);
          }, cfg.fetchEmails);
        }
        state.rows = applyFilters(rows);
      } else if (placeLoaded() || location.href.includes("/maps/place/")) {
        // single-place flow
        status("Reading this place…");
        setProgress(40);
        const row = await scrapeSinglePlace();
        state.rows = row ? applyFilters([row]) : [];
      } else {
        status("Open a search or a place first");
        return;
      }
      setProgress(100);
      setCount();
      status(state.stop ? `Stopped — ${state.rows.length} rows` : `Done — ${state.rows.length} rows`);
    } catch (e) {
      console.error("[gmaps-scraper]", e);
      status("Error — see console");
    } finally {
      state.running = false;
    }
  }

  // ---- UI -----------------------------------------------------------------

  const css = (el, styles) => Object.assign(el.style, styles);
  const mk = (tag, styles, text) => {
    const el = document.createElement(tag);
    if (styles) css(el, styles);
    if (text != null) el.textContent = text;
    return el;
  };

  function buildUI() {
    // Launcher: small round button, bottom-right, clear of the left search box.
    const fab = mk("button", {
      position: "fixed", right: "16px", bottom: "16px", zIndex: "100000",
      width: "48px", height: "48px", borderRadius: "50%", border: "none",
      background: "#1a73e8", color: "#fff", fontSize: "20px", cursor: "pointer",
      boxShadow: "0 3px 12px rgba(0,0,0,.3)",
    }, "📍");
    fab.title = "GMaps Scraper";

    const panel = mk("div", {
      position: "fixed", right: "16px", bottom: "72px", zIndex: "100000",
      width: "280px", maxHeight: "82vh", overflowY: "auto", display: "none",
      background: "#fff", color: "#202124", borderRadius: "10px",
      boxShadow: "0 4px 20px rgba(0,0,0,.28)", padding: "12px 14px",
      font: "13px/1.4 system-ui, sans-serif",
    });
    fab.onclick = () => { panel.style.display = panel.style.display === "none" ? "block" : "none"; };

    panel.append(mk("b", { display: "block", fontSize: "14px", marginBottom: "6px" }, "GMaps Scraper"));

    const label = (t) => mk("div", { fontWeight: "600", margin: "10px 0 4px" }, t);
    const row = () => mk("div", { display: "flex", gap: "6px", alignItems: "center", margin: "3px 0" });

    const numberInput = (key, min, step) => {
      const inp = mk("input");
      Object.assign(inp, { type: "number", value: cfg[key], min, step });
      css(inp, { width: "62px", padding: "3px 5px", border: "1px solid #dadce0", borderRadius: "6px" });
      inp.oninput = () => { cfg[key] = Number(inp.value) || 0; saveCfg(); };
      return inp;
    };
    const checkbox = (key, text) => {
      const wrap = row();
      const inp = mk("input");
      inp.type = "checkbox";
      inp.checked = !!cfg[key];
      inp.onchange = () => { cfg[key] = inp.checked; saveCfg(); };
      wrap.append(inp, mk("span", null, text));
      return wrap;
    };
    const btn = (text, bg) => mk("button", {
      flex: "1", padding: "8px 0", background: bg, color: "#fff", border: "none",
      borderRadius: "7px", fontWeight: "600", cursor: "pointer",
    }, text);

    const limitRow = row();
    limitRow.append(mk("span", null, "Max results"), numberInput("maxResults", 1, 10));
    panel.append(limitRow);
    panel.append(checkbox("fetchDetails", "Fetch details (address, phone, hours)"));
    panel.append(checkbox("fetchEmails", "Fetch emails + socials"));

    panel.append(label("Filters"));
    const rr = row();
    rr.append(mk("span", null, "Min ★"), numberInput("minRating", 0, 0.1),
              mk("span", null, "reviews"), numberInput("minReviews", 0, 10));
    panel.append(rr);
    panel.append(checkbox("onlyWithWebsite", "Only with website"));
    panel.append(checkbox("noWebsite", "Only WITHOUT website"));
    panel.append(checkbox("onlyWithPhone", "Only with phone"));

    panel.append(label("Export fields"));
    const grid = mk("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" });
    for (const c of COLUMNS) {
      const wrap = mk("label", { display: "flex", gap: "5px", alignItems: "center", fontSize: "12px" });
      const inp = mk("input");
      inp.type = "checkbox";
      inp.checked = !!cfg.fields[c];
      inp.onchange = () => { cfg.fields[c] = inp.checked; saveCfg(); };
      wrap.append(inp, mk("span", null, c));
      grid.append(wrap);
    }
    panel.append(grid);

    // run + progress
    const runRow = mk("div", { display: "flex", gap: "6px", margin: "12px 0 6px" });
    const startBtn = btn("▶ Start", "#1a73e8");
    const stopBtn = btn("■ Stop", "#5f6368");
    startBtn.onclick = run;
    stopBtn.onclick = () => { state.stop = true; status("Stopping…"); };
    runRow.append(startBtn, stopBtn);
    panel.append(runRow);

    const track = mk("div", { height: "6px", background: "#e8eaed", borderRadius: "3px", overflow: "hidden", margin: "2px 0 6px" });
    progFill = mk("div", { height: "100%", width: "0%", background: "#1a73e8", transition: "width .2s" });
    track.append(progFill);
    panel.append(track);

    statusEl = mk("div", { fontSize: "12px", color: "#5f6368", minHeight: "16px" }, "Idle");
    countEl = mk("span", { fontWeight: "600", color: "#188038" }, "0 rows");
    const statusRow = mk("div", { display: "flex", justifyContent: "space-between", gap: "8px", margin: "0 0 8px" });
    statusRow.append(statusEl, countEl);
    panel.append(statusRow);

    // exports
    const guardExport = (fn) => () => {
      if (!state.rows.length) return status("Nothing to export — run first");
      fn();
    };
    const exportRow = mk("div", { display: "flex", gap: "6px" });
    const csvBtn = btn("CSV", "#188038");
    const jsonBtn = btn("JSON", "#188038");
    const copyBtn = btn("Copy", "#188038");
    csvBtn.onclick = guardExport(() => downloadFile(toCSV(state.rows), "csv", "text/csv;charset=utf-8;"));
    jsonBtn.onclick = guardExport(() => downloadFile(toJSON(state.rows), "json", "application/json"));
    copyBtn.onclick = guardExport(async () => { await navigator.clipboard.writeText(toCSV(state.rows)); status("Copied CSV"); });
    exportRow.append(csvBtn, jsonBtn, copyBtn);
    panel.append(exportRow);

    // Google Sheets (OAuth — no per-user setup)
    const sheetBtn = btn("↗ Sign in with Google → Sheet", "#0f9d58");
    css(sheetBtn, { width: "100%", marginTop: "8px" });
    sheetBtn.onclick = guardExport(() => sheetsOAuthExport(state.rows));
    panel.append(sheetBtn);

    // Advanced: Apps Script webhook fallback
    const adv = mk("details", { marginTop: "8px", fontSize: "12px", color: "#5f6368" });
    adv.append(mk("summary", { cursor: "pointer" }, "Advanced: Apps Script webhook"));
    const sheetInput = mk("input");
    sheetInput.type = "text";
    sheetInput.placeholder = "https://script.google.com/macros/s/…/exec";
    sheetInput.value = cfg.sheetUrl || "";
    css(sheetInput, { width: "100%", boxSizing: "border-box", padding: "5px 6px", border: "1px solid #dadce0", borderRadius: "6px", fontSize: "11px", margin: "6px 0" });
    sheetInput.oninput = () => { cfg.sheetUrl = sheetInput.value.trim(); saveCfg(); };
    const hookBtn = btn("Send to webhook", "#188038");
    css(hookBtn, { width: "100%" });
    hookBtn.onclick = guardExport(() => pushToWebhook(state.rows));
    adv.append(sheetInput, hookBtn);
    panel.append(adv);

    document.body.append(fab, panel);
  }

  loadCfg().then(buildUI);
})();
