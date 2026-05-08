# FormSpy — Chrome Extension v6

A Chrome extension that **tracks**, **saves**, and **autofills** form fields across any webpage — including repeating sections like Work Experience and Education.

---

## Features

- **Live field tracking** — captures every input, select, textarea, checkbox, and radio as you type
- **Multi-field / repeating groups** — fields with the same label (e.g. three "Company" inputs) are stored as ordered arrays `["Acme", "Beta Inc", "Gamma Ltd"]`
- **Autofill** — re-fills saved values on return visits using fuzzy label matching
- **Per-page + per-domain storage** — saves data scoped to both the exact URL path and the domain
- **Popup UI** with three tabs:
  - **Fields** — view, edit, and delete individual tracked fields
  - **JSON** — syntax-highlighted raw data
  - **Saved** — browse, expand, copy, and delete all saved profiles
- **MV3 compliant** — no inline event handlers, no eval, fully Manifest V3 safe

---

## File Structure

```
form-spy-extension/
├── manifest.json          # Chrome Extension Manifest v3
├── content.js             # Content script: tracking, autofill, storage
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic (tabs, render, edit, delete)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── test-page.html         # General test form (all input types)
├── multi-field-test.html  # Repeating-group test page (Experience / Education / Skills)
└── test-suite.html        # Self-contained automated test runner (no build needed)
```

---

## Installation

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select this folder
5. The FormSpy icon will appear in your toolbar

---

## Test Pages

Open these directly in your browser (no server needed):

| File | Purpose |
|---|---|
| `test-page.html` | All input types — text, select, radio, checkbox, range, textarea |
| `multi-field-test.html` | 3× Work Experience + 2× Education + 4× Skills — repeating same-label fields with live debug overlay |
| `test-suite.html` | 22 automated tests across 7 suites — label extraction, array storage, autofill round-trip, edge cases |

---

## How Multi-Field Storage Works

When multiple inputs share the same label (e.g. three "Job Title" fields across experience entries), the extension stores them as a positional array:

```json
{
  "Job Title":   ["Senior Engineer", "Product Manager", "Data Scientist"],
  "Company":     ["Acme Corp", "Beta Inc", "Gamma Ltd"],
  "Start Year":  ["2020", "2017", "2014"],
  "End Year":    ["2023", "2020", "2017"]
}
```

On autofill, each value is written back to the correct positional input. Sparse entries (unfilled slots) are stored as `null` and skipped during autofill.

---

## Permissions Used

| Permission | Reason |
|---|---|
| `activeTab` | Read the active tab URL for per-page storage keys |
| `scripting` | Inject autofill trigger from popup |
| `storage` | Persist tracked field data |
| `tabs` | Query active tab for autofill and persist-on-edit |
