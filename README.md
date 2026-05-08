# FormSpy — Stop Filling the Same Form Twice

You've been there. A job application asks for your last three employers. A visa form wants every address you've lived at. An onboarding flow makes you re-enter the same name, email, and phone you typed yesterday on a different site.

**FormSpy fixes that.** Fill a form once — it remembers everything and fills it back in for you next time, automatically.

---

## The Problem

Redundant forms are everywhere:

- **Job boards** — Indeed, LinkedIn, Greenhouse, Lever, Workday all ask for the same work history
- **Government / visa portals** — same personal details, repeated across dozens of fields
- **Freelance platforms** — Upwork, Toptal, Fiverr all want the same bio, skills, and rates
- **Healthcare intake forms** — same insurance info and medical history, every new provider
- **Conference / event signups** — name, company, job title, over and over

Every time you close the tab, that work is gone. FormSpy makes sure it isn't.

---

## How It Works

1. **Fill a form normally.** FormSpy runs silently in the background and captures every field as you type — no extra steps.
2. **It saves everything.** Your answers are stored by page and domain, persisted across sessions.
3. **Visit the form again** (or a similar one on the same site). Click **⚡ Autofill** in the popup. Done.

FormSpy uses **fuzzy label matching** — so even if a field is labelled "Phone Number" on one site and "Mobile" on another, it figures out the right value to use.

---

## Handles Repeating Sections

Most autofill tools break on forms with repeated blocks — like adding three past employers or two degrees. FormSpy handles these natively.

Each entry is stored in order:

```json
{
  "Job Title":  ["Senior Engineer", "Product Manager", "Data Scientist"],
  "Company":    ["Acme Corp", "Beta Inc", "Gamma Ltd"],
  "Start Year": ["2020", "2017", "2014"],
  "End Year":   ["2023", "2020", "2017"]
}
```

On autofill, each value lands in the right slot — first job in the first row, second in the second, and so on.

---

## Popup

Click the FormSpy icon in your Chrome toolbar to:

| Tab | What you can do |
|---|---|
| **Fields** | See everything tracked on the current page. Edit or delete individual values. |
| **JSON** | Copy the raw data — useful for pasting into other tools or scripts. |
| **Saved** | Browse all saved profiles across every site. Expand, copy, clear, or delete any entry. |

---

## Installation

1. Clone or download this repo
2. Go to `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select this folder
5. FormSpy appears in your toolbar — ready to go

---

## File Structure

```
form-spy-extension/
├── manifest.json          # Chrome Extension Manifest v3
├── content.js             # Tracks fields, handles autofill, persists data
├── popup.html             # Extension popup UI
├── popup.js               # Popup: tabs, render, edit, delete
├── icons/
├── test-page.html         # All input types (text, select, radio, checkbox…)
├── multi-field-test.html  # Repeating sections — Experience / Education / Skills
└── test-suite.html        # 22 automated tests, runs in any browser, no build needed
```

---

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Scope saved data to the current page URL |
| `scripting` | Trigger autofill from the popup |
| `storage` | Persist your form data across sessions |
| `tabs` | Read the active tab URL |
