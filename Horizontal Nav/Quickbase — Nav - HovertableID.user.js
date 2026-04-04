// ==UserScript==
// @name         Quickbase — Hover URL (Cached)
// @namespace    https://quickbase.com/userscripts
// @version      1.7
// @description  Displays the table DBID when hovering over table links in the Quickbase nav.
// @match        https://*.quickbase.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── Configuration & State ────────────────────────────────────────────────
  const CONFIG = {
    debug: true,
    offset: 12
  };

  let state = {
    tooltip: null,
    lastTarget: null,
    // WeakMap is perfect for caching element-specific data without memory leaks
    cache: new WeakMap() 
  };

  // ── Styles ──────────────────────────────────────────────────────────────
  function injectStyles() {
    GM_addStyle(`
      #qb-url-popup {
        position: fixed;
        z-index: 999999;
        background: #ffffff;
        color: #272b32;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.12);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        padding: 12px;
        pointer-events: none;
        display: none;
        max-width: 340px;
        line-height: 1.5;
        border: 1px solid #e1e3e6;
      }
    `);
  }

  const log = (msg, ...args) => {
    if (CONFIG.debug) {
      console.log(`%c[QB URL Hover] ${msg}`, 'color: #4a90d9; font-weight: bold;', ...args);
    }
  };

  // ── Tooltip Management ──────────────────────────────────────────────────
  function createTooltip() {
    if (document.getElementById('qb-url-popup')) return;
    state.tooltip = document.createElement('div');
    state.tooltip.id = 'qb-url-popup';
    document.body.appendChild(state.tooltip);
  }

  function updateTooltip(content, x, y) {
    if (!state.tooltip) return;
    if (content) state.tooltip.textContent = content;
    
    state.tooltip.style.left = `${x + CONFIG.offset}px`;
    state.tooltip.style.top = `${y + CONFIG.offset}px`;
    state.tooltip.style.display = 'block';
  }

  // ── Initialization ──────────────────────────────────────────────────────
  function init() {
    injectStyles();
    createTooltip();
    log('Initialized with Caching.');

    // 1. Position tracking (high frequency, but very cheap)
    document.addEventListener('mousemove', (e) => {
      if (state.tooltip && state.tooltip.style.display === 'block') {
        updateTooltip(null, e.clientX, e.clientY);
      }
    }, { passive: true });

    // Use a[href*="/table/"] to match table links regardless of CSS-in-JS class names.
    const TABLE_LINK_SEL = 'a[href*="/table/"]';

    // 2. Hover Logic (only fires once per element entry)
    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest(TABLE_LINK_SEL);
      if (!target || target === state.lastTarget) return;

      state.lastTarget = target;

      // Check Cache first
      let tableid = state.cache.get(target);

      if (!tableid) {
        const match = target.href.match(/\/table\/([^/?#]+)/);
        tableid = match ? match[1] : null;
        if (!tableid) return;
        state.cache.set(target, tableid);
        log(`Resolved & Cached: "${target.textContent.trim().substring(0, 20)}..."`);
      } else {
        log(`Cache Hit: "${target.textContent.trim().substring(0, 20)}..."`);
      }

      updateTooltip(tableid, e.clientX, e.clientY);
    }, true);

    document.addEventListener('mouseout', (e) => {
      const target = e.target.closest(TABLE_LINK_SEL);
      if (target) {
        state.lastTarget = null;
        if (state.tooltip) state.tooltip.style.display = 'none';
      }
    }, true);
  }

  // Bootstrap
  init();
})();
