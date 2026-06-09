// FormSpy Content Script v5 — bug-fixed
// Fixes:
//  1. boot() no longer wipes formTrackerData on page load
//  2. popup now sees saved data immediately on open (even before typing)
//  3. persist uses a debounce + snapshot to prevent race conditions
//  4. experience section labels resolved correctly

// ─── Storage keys ────────────────────────────────────────────────────────────

function getPageKey()   { return `page::${location.origin}${location.pathname}`; }
function getDomainKey() { return `domain::${location.hostname}`; }

// ─── Label extraction ─────────────────────────────────────────────────────────

function getFieldLabel(el) {
  // 1. <label for="id">
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label?.innerText.trim()) return label.innerText.trim();
  }
  // 2. aria-label
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();
  // 3. aria-labelledby
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const t = document.getElementById(labelledBy)?.innerText.trim();
    if (t) return t;
  }
  // 4. Wrapping <label> (input nested inside label)
  const wrapping = el.closest("label");
  if (wrapping) {
    const clone = wrapping.cloneNode(true);
    clone.querySelectorAll("input,select,textarea").forEach(n => n.remove());
    const t = clone.innerText.trim();
    if (t) return t;
  }
  // 5. Nearest preceding sibling or parent label / legend
  //    Walk up — but use the FIRST label found inside the container,
  //    only if it's not a descendant of a different input's container.
  let parent = el.parentElement;
  for (let i = 0; i < 5; i++) {
    if (!parent) break;
    // Check for a <label> that is a sibling (not wrapping another input)
    for (const lbl of parent.querySelectorAll("label")) {
      if (lbl.contains(el)) continue;           // wrapping label already handled
      if (lbl.querySelector("input,select,textarea")) continue; // wraps a different input
      const t = lbl.innerText.trim();
      if (t) return t;
    }
    const legend = parent.querySelector("legend");
    if (legend?.innerText.trim()) return legend.innerText.trim();
    parent = parent.parentElement;
  }
  // 6. placeholder
  if (el.placeholder?.trim()) return el.placeholder.trim();
  // 7. name / id fallback
  return el.name || el.id || el.type || "unknown";
}

function sanitizeKey(key) {
  return key.replace(/\s+/g, " ").replace(/[^\w\s\-\/&]/g, "").trim().slice(0, 60);
}

// ─── Repeated-field detection ─────────────────────────────────────────────────

// All chained :not() on a single input rule so that an input[type='submit']
// doesn't sneak in by satisfying a different :not() in the list.
const SELECTOR = [
  "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']):not([type='image'])",
  "textarea",
  "select"
].join(", ");

// Cache label→elements map; rebuilt on scanAndAttach
let labelMap = {}; // { sanitizedLabel: [el, el, ...] }

function rebuildLabelMap() {
  labelMap = {};
  document.querySelectorAll(SELECTOR).forEach(el => {
    // skip pure button-type inputs even if selector leaks them
    if (["submit","button","reset","image","hidden"].includes(el.type)) return;
    const lbl = sanitizeKey(getFieldLabel(el)) || "field";
    if (!labelMap[lbl]) labelMap[lbl] = [];
    if (!labelMap[lbl].includes(el)) labelMap[lbl].push(el);
  });
}

function getLabelIndex(el) {
  const label = sanitizeKey(getFieldLabel(el)) || "field";
  const arr   = labelMap[label] || [el];
  const index = arr.indexOf(el);
  return { label, index: Math.max(index, 0), total: arr.length, group: arr };
}

// A radio group sharing one legend/label maps multiple elements to one label,
// but conceptually it's a single-choice scalar — not a repeating-field array.
function isRadioGroup(els) {
  return els.length > 1 && els.every(e => e.type === "radio");
}

// ─── In-memory page state ─────────────────────────────────────────────────────

const pageData = {}; // { label: scalar | array }
const attached = new WeakSet();

function getValue(el) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "radio")    return el.checked ? el.value : null;
  if (el.tagName === "SELECT") return el.options[el.selectedIndex]?.text || el.value;
  return el.value;
}

function handleChange(el) {
  const value = getValue(el);
  if (el.type === "radio" && value === null) return;

  const { label, index, total, group } = getLabelIndex(el);
  const isEmpty = value === "" || value === undefined || value === null || value === false;

  // Radio groups share a label across siblings — treat as scalar single-choice.
  if (total === 1 || isRadioGroup(group)) {
    if (isEmpty) delete pageData[label];
    else         pageData[label] = value;
  } else {
    // Ensure array of correct length
    if (!Array.isArray(pageData[label])) {
      const prev = pageData[label];
      pageData[label] = Array(total).fill(null);
      if (prev !== undefined && prev !== null) pageData[label][0] = prev;
    }
    while (pageData[label].length < total) pageData[label].push(null);

    pageData[label][index] = isEmpty ? null : value;

    // Prune trailing nulls
    const arr = pageData[label];
    let last = -1;
    arr.forEach((v, i) => { if (v !== null && v !== undefined) last = i; });
    if (last === -1) delete pageData[label];
    else             pageData[label] = arr.slice(0, last + 1);
  }

  schedulePersist();
}

// ─── Debounced persist (fixes race condition) ─────────────────────────────────

let persistTimer = null;

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistToDB, 150);
}

function persistToDB() {
  // Snapshot current data to avoid mutation during async get
  const snapshot = JSON.parse(JSON.stringify(pageData));

  const pageKey   = getPageKey();
  const domainKey = getDomainKey();

  chrome.storage.local.get([pageKey, domainKey], result => {
    function mergeData(existing, incoming) {
      const out = { ...existing };
      for (const [k, v] of Object.entries(incoming)) {
        if (Array.isArray(v)) {
          const exArr = Array.isArray(out[k]) ? out[k] : (out[k] != null ? [out[k]] : []);
          const len   = Math.max(exArr.length, v.length);
          out[k] = Array.from({ length: len }, (_, i) =>
            (v[i] != null) ? v[i] : (exArr[i] ?? null)
          );
          while (out[k].length && out[k][out[k].length - 1] == null) out[k].pop();
          if (!out[k].length) delete out[k];
        } else {
          out[k] = v;
        }
      }
      return out;
    }

    const merged       = mergeData(result[pageKey]   || {}, snapshot);
    const domainMerged = mergeData(result[domainKey] || {}, snapshot);

    chrome.storage.local.set({
      [pageKey]:       merged,
      [domainKey]:     domainMerged,
      formTrackerData: snapshot,   // live view for popup (snapshot, not reference)
    });
  });
}

// ─── Track element ────────────────────────────────────────────────────────────

function trackElement(el) {
  if (attached.has(el)) return;
  if (["submit","button","reset","image","hidden"].includes(el.type)) return;
  attached.add(el);
  el.addEventListener("input",  () => handleChange(el));
  el.addEventListener("change", () => handleChange(el));
  el.addEventListener("blur",   () => handleChange(el));
}

function scanAndAttach() {
  rebuildLabelMap();
  document.querySelectorAll(SELECTOR).forEach(trackElement);
}

// ─── Fuzzy matching ───────────────────────────────────────────────────────────

// Common multi-word labels that must collapse to a single canonical token
// BEFORE tokenization, otherwise "First Name" and "Name" both expose a "name"
// token that the synonym map then aliases to "fullname", producing false
// matches (saved fullname autofilled into "First Name" inputs).
const BIGRAMS = {
  "first name":    "firstname",
  "last name":     "lastname",
  "middle name":   "middlename",
  "full name":     "fullname",
  "user name":     "username",
  "email address": "email",
  "phone number":  "phone",
  "mobile number": "phone",
  "date of birth": "birthdate",
  "zip code":      "zip",
  "postal code":   "zip",
  "post code":     "zip",
  "street address":"address",
  "address line 1":"address",
  "address line 2":"address2",
  "job title":     "jobtitle",
};

function normalizeBigrams(str) {
  let s = " " + String(str).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim() + " ";
  for (const [bg, canonical] of Object.entries(BIGRAMS)) {
    s = s.split(" " + bg + " ").join(" " + canonical + " ");
  }
  return s.trim();
}

function tokenize(str) {
  return normalizeBigrams(str).split(/\s+/).filter(Boolean);
}

function similarity(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (!ta.size || !tb.size) return 0;
  let overlap = 0;
  ta.forEach(t => { if (tb.has(t)) overlap++; });
  return overlap / Math.max(ta.size, tb.size);
}

// ─── Semantic / synonym matching ──────────────────────────────────────────────

const SYNONYMS = {
  // Name fields
  "firstname": "firstname", "fname": "firstname", "givenname": "firstname",
  "forename": "firstname", "first": "firstname",
  "lastname": "lastname",  "lname": "lastname",  "surname": "lastname",
  "familyname": "lastname", "last": "lastname",
  "middlename": "middlename", "mname": "middlename", "middle": "middlename",
  "fullname": "fullname", "name": "fullname", "displayname": "fullname",
  // Contact
  "email": "email", "emailaddress": "email", "mail": "email",
  "emailid": "email", "e-mail": "email",
  "phone": "phone", "phonenumber": "phone", "telephone": "phone",
  "tel": "phone", "mobile": "phone", "cell": "phone", "cellphone": "phone",
  "contactnumber": "phone",
  // Address
  "address": "address", "streetaddress": "address", "street": "address",
  "address1": "address", "addressline1": "address",
  "address2": "address2", "apt": "address2", "suite": "address2",
  "addressline2": "address2",
  "city": "city", "town": "city", "locality": "city",
  "state": "state", "province": "state", "region": "state",
  "zip": "zip", "zipcode": "zip", "postalcode": "zip",
  "postcode": "zip", "pincode": "zip",
  "country": "country", "nation": "country",
  // Auth
  "username": "username", "user": "username", "login": "username",
  "userid": "username", "handle": "username",
  "password": "password", "pass": "password", "passwd": "password",
  "passphrase": "password", "pin": "password",
  // Personal info
  "dob": "birthdate", "dateofbirth": "birthdate", "birthday": "birthdate",
  "birthdate": "birthdate", "birthyear": "birthdate",
  "gender": "gender", "sex": "gender",
  "age": "age",
  // Organization / work
  "company": "company", "organization": "company", "org": "company",
  "employer": "company", "workplace": "company", "business": "company",
  "jobtitle": "jobtitle", "title": "jobtitle", "position": "jobtitle",
  "role": "jobtitle", "occupation": "jobtitle", "designation": "jobtitle",
  "department": "department", "division": "department",
  // Web
  "website": "website", "url": "website", "homepage": "website",
  "linkedin": "linkedin", "linkedinurl": "linkedin",
  "github": "github", "githuburl": "github",
  // Misc
  "description": "description", "bio": "description", "about": "description",
  "summary": "description", "notes": "description",
  "message": "message", "comment": "message", "feedback": "message",
};

/**
 * Converts a label string to a set of canonical tokens using the SYNONYMS map.
 * Tokens not in the map pass through unchanged.
 */
function toCanonical(label) {
  return tokenize(label).map(t => {
    // Strip common noise suffixes before lookup
    const clean = t.replace(/[^a-z0-9]/g, "");
    return SYNONYMS[clean] || clean;
  });
}

/**
 * Jaccard similarity on canonical token sets — semantic-aware.
 */
function semanticSim(a, b) {
  const ta = new Set(toCanonical(a));
  const tb = new Set(toCanonical(b));
  if (!ta.size || !tb.size) return 0;
  let overlap = 0;
  ta.forEach(t => { if (tb.has(t)) overlap++; });
  return overlap / (ta.size + tb.size - overlap);
}

/**
 * Like findBestMatch but first tries exact token match, then semantic match,
 * then falls back to the original Jaccard similarity.
 */
function semanticFindBestMatch(fieldLabel, savedData) {
  const THRESHOLD = 0.4; // slightly lower because canonical sets are smaller
  let bestKey = null, bestScore = 0;

  for (const savedKey of Object.keys(savedData)) {
    // Combine semantic and raw scores (weighted average)
    const semScore = semanticSim(fieldLabel, savedKey);
    const rawScore = similarity(fieldLabel, savedKey);
    const score = Math.max(semScore, rawScore);
    if (score > bestScore) { bestScore = score; bestKey = savedKey; }
  }
  return bestScore >= THRESHOLD ? { key: bestKey, value: savedData[bestKey] } : null;
}

// ─── Autofill ─────────────────────────────────────────────────────────────────

/**
 * Returns true if the field already has a user-supplied value and should not
 * be overwritten by autofill.
 *
 * - text/textarea/etc: non-empty value string
 * - checkbox: already checked
 * - radio group (els = all radios sharing this label): any sibling is checked
 * - select: a non-default option is selected (selectedIndex > 0 OR value !== "")
 */
function isAlreadyFilled(el, siblingEls) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "radio")    return (siblingEls || [el]).some(r => r.checked);
  if (el.tagName === "SELECT") {
    // First option is treated as a placeholder when it has empty value OR is
    // disabled — both are common patterns. In that case the select is only
    // "filled" if the user picked something past index 0.
    const first = el.options[0];
    const hasPlaceholder = !!first && (first.value === "" || first.disabled);
    if (hasPlaceholder) return el.selectedIndex > 0;
    return !!el.value?.trim();
  }
  return !!el.value?.trim();
}

function autofillElement(el, value) {
  if (typeof value === "boolean") {
    if (el.type === "checkbox") { el.checked = value; el.dispatchEvent(new Event("change", { bubbles: true })); }
    return;
  }
  if (el.tagName === "SELECT") {
    const target = String(value).trim().toLowerCase();
    if (!target) return; // never match an empty placeholder
    for (const opt of el.options) {
      const optText  = (opt.text  || "").trim().toLowerCase();
      const optValue = (opt.value || "").trim().toLowerCase();
      if (optText === target || optValue === target) {
        el.value = opt.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        break;
      }
    }
    return;
  }
  if (el.type === "radio") {
    if (el.value.toLowerCase() === String(value).toLowerCase()) {
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }
  el.value = value;
  el.dispatchEvent(new Event("input",  { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function runAutofill(savedData) {
  if (!savedData || !Object.keys(savedData).length) return;

  rebuildLabelMap(); // ensure fresh map

  let filled = 0;

  for (const [pageLabel, els] of Object.entries(labelMap)) {
    const match = semanticFindBestMatch(pageLabel, savedData);
    if (!match) continue;

    let savedValue = match.value;

    // Backward-compat: older versions saved radio groups as arrays. If the
    // current page's matching elements are a radio group, collapse to scalar.
    if (Array.isArray(savedValue) && isRadioGroup(els)) {
      savedValue = savedValue.find(v => v != null) ?? null;
      if (savedValue == null) continue;
    }

    if (Array.isArray(savedValue)) {
      savedValue.forEach((val, i) => {
        if (val == null) return;
        const el = els[i];
        if (!el || isAlreadyFilled(el, els)) return;
        autofillElement(el, val);
        filled++;
      });
    } else {
      // For radio groups every sibling must be iterated so autofillElement can
      // find the right option; track whether we already counted this group.
      let radioGroupCounted = false;
      els.forEach((el, i) => {
        if (isAlreadyFilled(el, els)) return;
        if (el.type === "radio") {
          autofillElement(el, savedValue);
          if (!radioGroupCounted) { filled++; radioGroupCounted = true; }
        } else {
          if (i > 0) return; // only first instance for scalar non-radio fields
          autofillElement(el, savedValue);
          filled++;
        }
      });
    }
  }

  if (filled > 0) showAutofillBanner(filled);
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function showAutofillBanner(count) {
  document.getElementById("formspy-banner")?.remove();
  const banner = document.createElement("div");
  banner.id = "formspy-banner";
  banner.innerHTML = `
    <div style="position:fixed;bottom:20px;right:20px;z-index:2147483647;
      background:#0d0d0f;color:#e8e8f0;
      font-family:'JetBrains Mono',monospace,sans-serif;font-size:12px;
      padding:12px 16px;border-radius:8px;border:1px solid #2a2a32;
      box-shadow:0 8px 32px rgba(0,0,0,0.5);display:flex;align-items:center;gap:10px;
      animation:formspy-in 0.3s ease;">
      <span style="color:#7fff6e;font-size:16px;">⬡</span>
      <span><b style="color:#7fff6e">FormSpy</b> autofilled <b style="color:#4af0c4">${count}</b> field${count !== 1 ? "s" : ""}</span>
      <button onclick="document.getElementById('formspy-banner').remove()"
        style="background:none;border:none;color:#5a5a6e;cursor:pointer;font-size:14px;padding:0 0 0 6px;">✕</button>
    </div>
    <style>@keyframes formspy-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}</style>`;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 5000);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
// FIX: We do NOT wipe formTrackerData on boot. Instead we:
//  a) Load saved page data and expose it to the popup immediately
//  b) Run autofill
//  c) Start tracking
//  Only after the user starts typing do we overwrite formTrackerData with live data.

function boot() {
  const pageKey   = getPageKey();
  const domainKey = getDomainKey();

  scanAndAttach(); // attach listeners immediately, don't wait for storage

  chrome.storage.local.get([pageKey, domainKey], result => {
    // Prefer page-specific saved data, fall back to domain
    const saved = (result[pageKey] && Object.keys(result[pageKey]).length)
      ? result[pageKey]
      : (result[domainKey] || {});

    // FIX: expose saved data to popup right away (so popup isn't blank on open)
    //      Only set if pageData is still empty (user hasn't typed yet)
    if (!Object.keys(pageData).length && Object.keys(saved).length) {
      chrome.storage.local.set({ formTrackerData: saved });
    }

    // Autofill after short delay for page to settle
    setTimeout(() => runAutofill(saved), 400);
  });
}

boot();

// Watch for dynamically added fields (SPAs, lazy forms)
let scanDebounce = null;
const observer = new MutationObserver(() => {
  if (scanDebounce) clearTimeout(scanDebounce);
  scanDebounce = setTimeout(scanAndAttach, 200);
});
observer.observe(document.body, { childList: true, subtree: true });

// ─── Messages from popup ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === "clear") {
    Object.keys(pageData).forEach(k => delete pageData[k]);
    // popup already removed formTrackerData from storage; just clear in-memory state
  }
  if (msg.action === "autofill") {
    const pageKey   = getPageKey();
    const domainKey = getDomainKey();
    chrome.storage.local.get([pageKey, domainKey], result => {
      runAutofill(result[pageKey] || result[domainKey] || {});
    });
  }
});
