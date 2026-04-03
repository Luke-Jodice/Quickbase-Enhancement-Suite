// ==UserScript==
// @name         Quickbase Legacy Form Editor — Field Search
// @namespace    https://quickbase.com/userscripts
// @version      1.0
// @description  Adds a search/filter input to the legacy form editor's field list
// @match        https://*.quickbase.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── Styles ──────────────────────────────────────────────────────────────
  GM_addStyle(`
    #qb-field-search-wrap {
      position: sticky;
      top: 0;
      z-index: 100;
      background: #f4f4f4;
      padding: 6px 8px;
      border-bottom: 1px solid #ccc;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #qb-field-search {
      flex: 1;
      padding: 4px 8px;
      font-size: 13px;
      border: 1px solid #999;
      border-radius: 3px;
      outline: none;
    }
    #qb-field-search:focus {
      border-color: #4a90d9;
      box-shadow: 0 0 0 2px rgba(74,144,217,0.25);
    }
    #qb-field-search-count {
      font-size: 11px;
      color: #666;
      white-space: nowrap;
      min-width: 50px;
      text-align: right;
    }
    #mainDivTable tr[id^="row"].qb-search-hidden {
      display: none !important;
    }
    #mainDivTable tr[id^="row"] select option.qb-search-highlight {
      background: #fff3b0;
    }
  `);

  // ── Helpers ─────────────────────────────────────────────────────────────

  /** Get the visible field label from a row's <select> */
  function getFieldLabel(row) {
    const sel = row.querySelector('select[id^="sel"]');
    if (!sel) return '';
    const opt = sel.options[sel.selectedIndex];
    if (!opt) return '';
    const text = opt.textContent.trim();
    // Ignore placeholder / separator options
    if (text === 'Make a Selection...' || text.startsWith('---')) return '';
    return text;
  }

  function filterRows(query) {
    const table = document.getElementById('mainDivTable');
    if (!table) return;

    const rows = table.querySelectorAll('tr[id^="row"]');
    const q = query.toLowerCase().trim();
    let visible = 0;

    rows.forEach((row) => {
      if (!q) {
        row.classList.remove('qb-search-hidden');
        visible++;
        return;
      }

      // Only match against the currently selected/assigned field name
      const label = getFieldLabel(row);
      const match = label !== '' && label.toLowerCase().includes(q);

      row.classList.toggle('qb-search-hidden', !match);
      if (match) visible++;
    });

    // Update counter
    const counter = document.getElementById('qb-field-search-count');
    if (counter) {
      counter.textContent = q ? `${visible} / ${rows.length}` : `${rows.length} rows`;
    }
  }

  // ── Injection ───────────────────────────────────────────────────────────

  function inject() {
    const mainDiv = document.getElementById('mainDiv');
    const table = document.getElementById('mainDivTable');
    if (!mainDiv || !table) return false;
    if (document.getElementById('qb-field-search-wrap')) return true; // already injected

    // Build search bar
    const wrap = document.createElement('div');
    wrap.id = 'qb-field-search-wrap';

    const input = document.createElement('input');
    input.id = 'qb-field-search';
    input.type = 'text';
    input.placeholder = 'Search fields…';
    input.autocomplete = 'off';
    input.spellcheck = false;

    const count = document.createElement('span');
    count.id = 'qb-field-search-count';

    wrap.appendChild(input);
    wrap.appendChild(count);

    // Insert at the top of mainDiv, before the table
    mainDiv.insertBefore(wrap, mainDiv.firstChild);

    // Wire up events
    input.addEventListener('input', () => filterRows(input.value));

    // Ctrl+F / Cmd+F shortcut to focus the search (only when form editor is visible)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        const searchInput = document.getElementById('qb-field-search');
        if (searchInput && searchInput.offsetParent !== null) {
          e.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
      }
    });

    // Escape to clear & restore
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        filterRows('');
        input.blur();
      }
    });

    // Initial count
    filterRows('');

    console.log('[QB Form Search] Injected successfully');
    return true;
  }

  // ── Bootstrap: wait for the form editor to mount ────────────────────────

  // Try immediately
  if (inject()) return;

  // Poll briefly in case the DOM is almost ready
  let attempts = 0;
  const poll = setInterval(() => {
    if (inject() || ++attempts > 50) clearInterval(poll);
  }, 200);

  // Also watch for SPA re-renders that might rebuild the editor
  const observer = new MutationObserver(() => {
    // Re-inject if our search bar got removed but the table is back
    if (!document.getElementById('qb-field-search-wrap') && document.getElementById('mainDivTable')) {
      inject();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();