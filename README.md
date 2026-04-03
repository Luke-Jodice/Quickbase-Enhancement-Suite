# Quickbase Enhancement Suite

A collection of Tampermonkey userscripts that improve the Quickbase development experience.

## Scripts

### Formula Field Autocomplete
**File:** `Quickbase Formula — Field Autocomplete.user.js` | **Version:** 4.0

Adds field name autocomplete to the Quickbase formula editor (Ace Editor). Press **Ctrl+[** to open a dropdown of all available fields from the formula helper. Type to filter, use arrow keys to navigate, and press **Tab** or **Enter** to insert the selected `[FieldName]` reference.

**Features:**
- Fuzzy filtering with highlighted matches
- Field type labels displayed alongside field names
- Keyboard-driven workflow (Ctrl+[, arrows, Tab/Enter, Esc)
- Auto-positions near the cursor and adjusts for viewport edges
- Auto-inserts bracket pair if triggered outside existing brackets

### Legacy Form Editor Field Search
**File:** `Quickbase Legacy Form Editor — Field Search.user.js` | **Version:** 1.0

Adds a search bar to the top of the legacy form editor's field list, letting you quickly filter rows by field name.

**Features:**
- Sticky search bar at the top of the field list
- Real-time filtering as you type with row count display
- **Ctrl+F** focuses the search bar when the form editor is visible
- **Esc** clears the search and restores all rows
- Automatically re-injects if the editor is rebuilt by SPA navigation

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Click on a script file above and select **Raw** to trigger the Tampermonkey install prompt.
   - Or open Tampermonkey Dashboard > **+** tab > paste the script contents > **File > Save**.
3. Navigate to any `*.quickbase.com` page and the scripts will activate automatically.

## Requirements

- A modern browser with [Tampermonkey](https://www.tampermonkey.net/) (or a compatible userscript manager)
- Access to a Quickbase application

## License

MIT
