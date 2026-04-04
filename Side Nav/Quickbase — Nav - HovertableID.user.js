// ==UserScript==
// @name         Quickbase — Side Nav — Hover Table ID
// @namespace    https://quickbase.com/userscripts
// @version      1.8
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

  const HOVER_DELAY = 400;

  let state = {
    tooltip: null,
    lastTarget: null,
    hoverTimer: null,
    pendingCoords: null,
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

    const TABLE_LINK_SEL = 'a[href*="/table/"]';

    // Position tracking
    document.addEventListener('mousemove', (e) => {
      if (state.hoverTimer && state.lastTarget) {
        state.pendingCoords = { x: e.clientX, y: e.clientY };
      }
      if (state.tooltip && state.tooltip.style.display === 'block') {
        updateTooltip(null, e.clientX, e.clientY);
      }
    }, { passive: true });

    // Hover logic with delay
    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest(TABLE_LINK_SEL);
      if (!target || target === state.lastTarget) return;

      clearTimeout(state.hoverTimer);
      state.lastTarget = target;
      state.pendingCoords = { x: e.clientX, y: e.clientY };

      state.hoverTimer = setTimeout(() => {
        if (state.lastTarget !== target) return;

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

        const c = state.pendingCoords || { x: e.clientX, y: e.clientY };
        updateTooltip(tableid, c.x, c.y);
      }, HOVER_DELAY);
    }, true);

    document.addEventListener('mouseout', (e) => {
      const target = e.target.closest(TABLE_LINK_SEL);
      if (target) {
        clearTimeout(state.hoverTimer);
        state.hoverTimer = null;
        state.pendingCoords = null;
        state.lastTarget = null;
        if (state.tooltip) state.tooltip.style.display = 'none';
      }
    }, true);
  }

  // Bootstrap
  init();
})();
