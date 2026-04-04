# Quickbase Enhancement Suite

Tampermonkey userscripts that fill the gaps in the Quickbase developer experience. Autocomplete, search, hover tooltips, schema summaries — small tools that save real time.

---

## At a Glance

| Script | Trigger | What it does |
|--------|---------|-------------|
| [Field Autocomplete](#field-autocomplete) | `Ctrl + [` | Autocomplete `[FieldName]` references in the formula editor |
| [Function Autocomplete](#function-autocomplete) | `Ctrl + Space` | Autocomplete formula functions with parameter signatures |
| [Field Marker Tooltips](#field-marker-tooltips) | Hover | Show field type, FID, and table on hover over field markers |
| [Legacy Form Field Search](#legacy-form-field-search) | `Ctrl + F` | Filter the field list in the legacy form editor |
| [Hover Table Info](#hover-table-info) | Hover | Schema stats (field counts, types, formulas, relationships) on table links |
| [Hover Table ID](#hover-table-id) | Hover | Quickly reveals the raw DBID when hovering over table links |
| [Report Field Labels](#report-field-labels) | Automatic | Injects field type labels into column headers with formula hover previews |

---

## Formula Editor

### Field Autocomplete

> `Formula Editor/Quickbase Formula — Field Autocomplete.user.js` — v4.0

Press **Ctrl+[** in the formula editor to open a filterable dropdown of every field available in the formula helper. Inserts the full `[FieldName]` reference on selection.

<details>
<summary>Features</summary>

- Fuzzy filtering with highlighted matches
- Field type labels alongside each field name
- Keyboard-driven: arrow keys to navigate, Tab/Enter to insert, Esc to close
- Auto-positions near the cursor and flips when near viewport edges
- Inserts a bracket pair automatically if triggered outside existing brackets

</details>

### Function Autocomplete

> `Formula Editor/Quickbase Formula — Function Autocomplete.user.js` — v1.0

Press **Ctrl+Space** to autocomplete Quickbase formula functions. Scrapes function data from the built-in Formula Functions dialog on first use, including parameter signatures and descriptions.

<details>
<summary>Features</summary>

- Shows function name, parameter signature, and overload count
- Description tooltip on hover for each function
- Deduplicates overloaded functions with a `+N` badge
- Inserts `FunctionName(` and places the cursor ready for arguments
- Caches function data after first collection

</details>

### Field Marker Tooltips

> `Formula Editor/Quickbase Formula — Field Marker Tooltips.user.js` — v1.5

Hover over any `[FieldName]` marker in the formula editor to see a tooltip with the field's metadata pulled from the page.

<details>
<summary>Features</summary>

- Displays field name, FID, type, and source table
- Resolves field data from `gTableInfo` and `formulaHelper`
- Prioritizes the current table when field names exist across multiple tables
- Yields to Quickbase's own error/warning overlays to avoid conflicts
- Works around Ace editor's pointer-events:none layers via bounding-rect hit-testing

</details>

---

## Legacy Form Editor

### Legacy Form Field Search

> `Legacy Form Editor/Quickbase Legacy Form Editor — Field Search.user.js` — v1.0

Adds a sticky search bar to the top of the legacy form editor's field list. Filters rows in real-time as you type.

<details>
<summary>Features</summary>

- Sticky search bar pinned above the field table
- Real-time row filtering with visible/total count
- **Ctrl+F** focuses the search bar when the form editor is visible
- **Esc** clears the filter and restores all rows
- Re-injects automatically if the editor is rebuilt by SPA navigation

</details>

---

## Side Nav

### Hover Table Info

> `Side Nav/Quickbase - Nav - hover table info.user.js` — v3.3

Hover over any table link in the sidebar to see a schema summary tooltip. Reads directly from `gTableInfo` — no API calls, no app tokens, instant display.

<details>
<summary>Features</summary>

- Shows table name, DBID, alias, key field, and field count
- Field type breakdown as tags (e.g. "42 Text", "12 Phone", "5 URL")
- Full stats (formulas, relationships) shown when hovering the current table
- Compact view for other tables (field data is partially loaded by Quickbase)
- 400ms hover delay to avoid accidental triggers when mousing past links

</details>

### Hover Table ID

> `Side Nav/Quickbase — Nav - HovertableID.user.js` — v1.8

A lightweight tooltip that reveals the raw DBID (Table ID) when hovering over table links in the sidebar. Built for developers who just need to grab a table ID quickly.

<details>
<summary>Features</summary>

- Displays the table DBID parsed from the link URL
- WeakMap caching to prevent redundant parsing
- 400ms hover delay for a natural feel
- Minimal, unobtrusive tooltip styling

</details>

---

## Table Report

### Report Field Labels

> `Table Report/Quickbase - Report - Field Type Labels.user.js` — v1.9

Injects an elegant, italicized field type label immediately underneath each column header natively within Quickbase table reports. Provides instant visual indication of field categories (Formula, Lookup, Summary, Scalar) using distinct prefixes and colors.

<details>
<summary>Features</summary>

- Field category coloring (`ƒ` for formula, `⇠` for lookup, `Σ` for summary)
- Identifies "Virtual" formula fields even when Quickbase strips their payload
- Hover over formula fields to see a beautifully formatted tooltip displaying the active formula text
- Dynamically fetches and natively caches formula definitions using internal XML schema APIs (`API_GetSchema`) seamlessly via the browser session—no App Tokens required
- Automatically strips whitespace and truncates massive formulas at 5 lines for a clean, dense preview
- Custom inline lexer parses and italicizes Quickbase `//` code comments automatically
- MutationObserver integration handles dynamic column reordering and Single Page App (SPA) navigation flawlessly

</details>

---

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Open any `.user.js` file in this repo and click **Raw** — Tampermonkey will prompt to install.
   - Or: Tampermonkey Dashboard > **+** tab > paste the script > save.
3. Navigate to any `*.quickbase.com` page. Scripts activate automatically on matching pages.

## Requirements

- A modern browser with [Tampermonkey](https://www.tampermonkey.net/) or a compatible userscript manager
- Access to a Quickbase application

## License

[MIT](LICENSE)
