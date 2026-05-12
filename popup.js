// FormSpy popup.js

let currentData = {};   // live fields on this page
let currentTab  = "fields";

// ─── DOM refs ────────────────────────────────────────────────

const fieldList    = document.getElementById("field-list");
const jsonView     = document.getElementById("json-view");
const emptyState   = document.getElementById("empty-state");
const jsonEmpty    = document.getElementById("json-empty");
const savedEmpty   = document.getElementById("saved-empty");
const profileList  = document.getElementById("profile-list");
const statusPill   = document.getElementById("status-pill");
const countBadge   = document.getElementById("count-badge");
const savedBadge   = document.getElementById("saved-badge");
const toast        = document.getElementById("toast");

// ─── Helpers ─────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function syntaxHighlight(json) {
  return json
    .replace(/("[\w\s\-\/&]+")\s*:/g, '<span class="key">$1</span>:')
    .replace(/:\s*(".*?")/g,           ': <span class="str">$1</span>')
    .replace(/:\s*(true|false)/g,      ': <span class="bool">$1</span>')
    .replace(/:\s*(\d+\.?\d*)/g,       ': <span class="num">$1</span>');
}

function showToast(msg, duration = 1800) {
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), duration);
}

function saveCurrentData() {
  chrome.storage.local.set({ formTrackerData: currentData });
}

function urlLabel(key) {
  // key format: "page::https://example.com/path" or "domain::example.com"
  try {
    if (key.startsWith("page::"))   return key.replace("page::", "");
    if (key.startsWith("domain::")) return "🌐 " + key.replace("domain::", "");
  } catch (_) {}
  return key;
}

// ─── TAB SWITCHING ───────────────────────────────────────────

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentTab = tab.dataset.tab;

    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    document.getElementById(`panel-${currentTab}`).classList.add("active");

    document.getElementById("fields-toolbar").style.display = currentTab === "saved" ? "none" : "flex";
    document.getElementById("saved-toolbar").style.display  = currentTab === "saved" ? "flex"  : "none";

    if (currentTab === "json")  renderJson();
    if (currentTab === "saved") renderSaved();
  });
});

// ─── FIELDS PANEL ────────────────────────────────────────────

function renderFields() {
  const keys = Object.keys(currentData);
  countBadge.textContent = keys.length;

  if (keys.length === 0) {
    emptyState.style.display  = "block";
    fieldList.style.display   = "none";
    statusPill.textContent    = "● waiting";
    statusPill.className      = "status-pill empty";
    return;
  }

  emptyState.style.display = "none";
  fieldList.style.display  = "flex";
  statusPill.textContent   = `● ${keys.length} field${keys.length !== 1 ? "s" : ""}`;
  statusPill.className     = "status-pill";

  const editingKey = fieldList.querySelector(".field-item.editing")?.dataset.key || null;

  fieldList.innerHTML = keys.map(key => {
    const val       = currentData[key];
    const isArray   = Array.isArray(val);
    const isBool    = typeof val === "boolean";
    const isEditing = key === editingKey;

    let dispVal, editVal;
    if (isArray) {
      // Show each array entry as a numbered chip row
      dispVal = val.map((v, i) =>
        `<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 3px 2px 0;
          background:rgba(74,240,196,0.08);border:1px solid rgba(74,240,196,0.2);
          border-radius:4px;padding:2px 6px;font-size:11px;">
          <span style="color:var(--muted);font-size:9px;">${i + 1}</span>
          <span>${escapeHtml(String(v ?? ""))}</span>
        </span>`
      ).join("");
      editVal = val.map(v => v ?? "").join(" | ");
    } else {
      dispVal = isBool ? (val ? "✓ checked" : "✗ unchecked") : escapeHtml(String(val));
      editVal = String(val);
    }

    const hint = isArray
      ? `<div style="font-size:9px;color:var(--muted);margin-top:4px;">repeating group · ${val.length} entries · edit with " | " separator</div>`
      : "";

    return `
      <div class="field-item${isEditing ? " editing" : ""}" data-key="${escapeHtml(key)}">
        <div class="field-row">
          <div class="field-content">
            <div class="field-key">${escapeHtml(key)}</div>
            <div class="field-value${isBool ? " boolean" : ""}">${dispVal}</div>
            ${hint}
          </div>
          <div class="field-actions">
            <button class="icon-btn edit-btn" data-key="${escapeHtml(key)}" title="Edit">✎</button>
            <button class="icon-btn del del-btn" data-key="${escapeHtml(key)}" title="Delete">✕</button>
          </div>
        </div>
        <div class="edit-row">
          <input class="edit-input" type="text" value="${escapeHtml(editVal)}" data-key="${escapeHtml(key)}" />
          <button class="save-btn" data-key="${escapeHtml(key)}">Save</button>
          <button class="cancel-btn" data-key="${escapeHtml(key)}">✕</button>
        </div>
      </div>`;
  }).join("");

  if (editingKey) {
    const inp = fieldList.querySelector(`.edit-input[data-key="${editingKey}"]`);
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }

  attachFieldEvents();
}

function attachFieldEvents() {
  fieldList.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      fieldList.querySelectorAll(".field-item.editing").forEach(el => el.classList.remove("editing"));
      const item = fieldList.querySelector(`.field-item[data-key="${btn.dataset.key}"]`);
      if (item) { item.classList.add("editing"); item.querySelector(".edit-input")?.focus(); }
    });
  });

  fieldList.querySelectorAll(".cancel-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      fieldList.querySelector(`.field-item[data-key="${btn.dataset.key}"]`)?.classList.remove("editing");
    });
  });

  fieldList.querySelectorAll(".save-btn").forEach(btn => {
    btn.addEventListener("click", () => commitEdit(btn.dataset.key));
  });

  fieldList.querySelectorAll(".edit-input").forEach(inp => {
    inp.addEventListener("keydown", e => {
      if (e.key === "Enter")  commitEdit(inp.dataset.key);
      if (e.key === "Escape") fieldList.querySelector(`.field-item[data-key="${inp.dataset.key}"]`)?.classList.remove("editing");
    });
  });

  fieldList.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      delete currentData[btn.dataset.key];
      persistEdit();
      renderFields();
      showToast("Field deleted");
    });
  });
}

function commitEdit(key) {
  const inp = fieldList.querySelector(`.edit-input[data-key="${key}"]`);
  if (!inp) return;
  const raw = inp.value;
  if (raw.trim() === "") {
    delete currentData[key];
    showToast("Field removed");
  } else {
    // If the existing value was an array, parse pipe-separated input back into array
    const existing = currentData[key];
    if (Array.isArray(existing) || raw.includes(" | ")) {
      const parts = raw.split(" | ").map(s => s.trim()).filter(s => s !== "");
      currentData[key] = parts.length === 1 ? parts[0] : parts;
    } else {
      currentData[key] = raw;
    }
    showToast("Saved ✓");
  }
  persistEdit();
  renderFields();
}

// When popup edits a field, also update the saved DB entry for this page/domain
function persistEdit() {
  saveCurrentData();

  // Update the saved page/domain records too
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]?.url) return;
    try {
      const url       = new URL(tabs[0].url);
      const pageKey   = `page::${url.origin}${url.pathname}`;
      const domainKey = `domain::${url.hostname}`;
      chrome.storage.local.get([pageKey, domainKey], result => {
        const updates = {};

        // For the page key, replace entirely with currentData so that
        // deleted fields don't linger. Always write (even if key didn't exist).
        updates[pageKey] = { ...currentData };

        // For the domain key, merge so other paths on this domain aren't lost,
        // but honour deletions by removing keys absent from currentData that
        // were previously contributed by this page.
        const domainBase = result[domainKey] || {};
        const domainPrev = result[pageKey]   || {};
        const merged = { ...domainBase };
        // Remove keys that used to be in this page's record but are now gone
        for (const k of Object.keys(domainPrev)) {
          if (!(k in currentData)) delete merged[k];
        }
        // Apply current edits
        Object.assign(merged, currentData);
        updates[domainKey] = merged;

        chrome.storage.local.set(updates);
      });
    } catch (_) {}
  });
}

// ─── JSON PANEL ──────────────────────────────────────────────

function renderJson() {
  const keys = Object.keys(currentData);
  if (keys.length === 0) {
    jsonEmpty.style.display = "block";
    jsonView.style.display  = "none";
    return;
  }
  jsonEmpty.style.display = "none";
  jsonView.style.display  = "block";
  jsonView.innerHTML = `<pre>${syntaxHighlight(escapeHtml(JSON.stringify(currentData, null, 2)))}</pre>`;
}

// ─── SAVED PANEL ─────────────────────────────────────────────

function renderSaved() {
  chrome.storage.local.get(null, allData => {
    // Collect only page:: and domain:: keys
    const entries = Object.entries(allData).filter(([k]) =>
      (k.startsWith("page::") || k.startsWith("domain::")) && Object.keys(allData[k]).length > 0
    );

    savedBadge.textContent = entries.length;
    savedBadge.className   = entries.length ? "badge" : "badge dim";

    if (entries.length === 0) {
      savedEmpty.style.display   = "block";
      profileList.style.display  = "none";
      return;
    }

    savedEmpty.style.display  = "none";
    profileList.style.display = "flex";

    profileList.innerHTML = entries.map(([storageKey, data]) => {
      const fields     = Object.entries(data);
      const label      = urlLabel(storageKey);
      const fieldCount = fields.length;
      const isPage     = storageKey.startsWith("page::");

      // Render arrays as numbered chips, scalars as plain text
      const fieldsHtml = fields.slice(0, 8).map(([k, v]) => {
        let valHtml;
        if (Array.isArray(v)) {
          valHtml = v.map((item, i) =>
            `<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 3px 2px 0;
              background:rgba(74,240,196,0.08);border:1px solid rgba(74,240,196,0.2);
              border-radius:4px;padding:2px 6px;font-size:10px;">
              <span style="color:var(--muted);font-size:9px;">${i + 1}</span>
              <span>${escapeHtml(String(item ?? ""))}</span>
            </span>`
          ).join("");
        } else {
          valHtml = escapeHtml(String(v));
        }
        return `
          <div class="profile-field">
            <span class="pf-key">${escapeHtml(k)}</span>
            <span class="pf-val">${valHtml}</span>
          </div>`;
      }).join("") + (fields.length > 8 ? `<div class="profile-field"><span class="pf-key" style="color:var(--muted)">+${fields.length - 8} more…</span></div>` : "");

      // NOTE: no inline onclick= attributes — MV3 CSP blocks them.
      // data-key carries the storage key; attachSavedEvents() wires up listeners.
      return `
        <div class="profile-card" data-storage-key="${escapeHtml(storageKey)}">
          <div class="profile-header">
            <div class="profile-meta">
              <div class="profile-url" title="${escapeHtml(label)}">${isPage ? "📄" : "🌐"} ${escapeHtml(label)}</div>
              <div class="profile-stats">${fieldCount} field${fieldCount !== 1 ? "s" : ""} saved</div>
            </div>
            <div class="profile-actions">
              <button class="sm-btn del" data-action="delete" data-key="${escapeHtml(storageKey)}">✕ Delete</button>
            </div>
            <span class="profile-toggle">▶</span>
          </div>
          <div class="profile-body">
            <div class="profile-fields">${fieldsHtml}</div>
            <div class="profile-footer">
              <button class="sm-btn" data-action="copy" data-key="${escapeHtml(storageKey)}">⎘ Copy JSON</button>
              <button class="sm-btn del" data-action="clear" data-key="${escapeHtml(storageKey)}">🗑 Clear fields</button>
            </div>
          </div>
        </div>`;
    }).join("");

    attachSavedEvents();
  });
}

function attachSavedEvents() {
  // Toggle expand/collapse — click anywhere on the header except action buttons
  profileList.querySelectorAll(".profile-header").forEach(header => {
    header.addEventListener("click", e => {
      if (e.target.closest(".profile-actions")) return;
      header.closest(".profile-card").classList.toggle("open");
    });
  });

  // Action buttons: delete / copy / clear
  profileList.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const key = btn.dataset.key;
      const action = btn.dataset.action;
      if (action === "delete") {
        chrome.storage.local.remove(key, () => { showToast("Profile deleted"); renderSaved(); });
      } else if (action === "copy") {
        chrome.storage.local.get(key, result => {
          navigator.clipboard.writeText(JSON.stringify(result[key] || {}, null, 2))
            .then(() => showToast("Copied!"));
        });
      } else if (action === "clear") {
        chrome.storage.local.set({ [key]: {} }, () => { showToast("Profile cleared"); renderSaved(); });
      }
    });
  });
}

// ─── TOOLBAR BUTTONS ─────────────────────────────────────────

document.getElementById("btn-refresh").addEventListener("click", loadData);

document.getElementById("btn-copy").addEventListener("click", () => {
  navigator.clipboard.writeText(JSON.stringify(currentData, null, 2)).then(() => showToast("Copied!"));
});

document.getElementById("btn-autofill").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "autofill" });
      showToast("⚡ Autofilling…");
    }
  });
});

document.getElementById("btn-clear").addEventListener("click", () => {
  currentData = {};
  // Clear the live key and the underlying page/domain storage keys
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const keysToRemove = ["formTrackerData"];
    if (tabs[0]?.url) {
      try {
        const url = new URL(tabs[0].url);
        keysToRemove.push(`page::${url.origin}${url.pathname}`);
        keysToRemove.push(`domain::${url.hostname}`);
      } catch (_) {}
    }
    chrome.storage.local.remove(keysToRemove);
    chrome.storage.local.set({ formTrackerData: {} });
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: "clear" });
  });
  renderFields();
  showToast("Cleared");
});

document.getElementById("btn-clear-all").addEventListener("click", () => {
  chrome.storage.local.get(null, allData => {
    const keysToRemove = Object.keys(allData).filter(k => k.startsWith("page::") || k.startsWith("domain::"));
    chrome.storage.local.remove(keysToRemove, () => {
      showToast("All profiles cleared");
      renderSaved();
    });
  });
});

// ─── DATA LOADING ────────────────────────────────────────────

function loadData() {
  chrome.storage.local.get("formTrackerData", result => {
    currentData = result.formTrackerData || {};
    if (currentTab === "fields") renderFields();
    if (currentTab === "json")   renderJson();
  });

  // Update saved badge count
  chrome.storage.local.get(null, allData => {
    const count = Object.keys(allData).filter(k =>
      (k.startsWith("page::") || k.startsWith("domain::")) && Object.keys(allData[k] || {}).length > 0
    ).length;
    savedBadge.textContent = count;
    savedBadge.className   = count ? "badge" : "badge dim";
  });
}

// Live updates from content script
chrome.storage.onChanged.addListener(changes => {
  if (changes.formTrackerData) {
    const isEditing = !!fieldList.querySelector(".field-item.editing");
    if (!isEditing) {
      currentData = changes.formTrackerData.newValue || {};
      if (currentTab === "fields") renderFields();
      if (currentTab === "json")   renderJson();
    }
  }
});

loadData();
