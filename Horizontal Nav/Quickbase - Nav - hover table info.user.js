// ==UserScript==
// @name         Quickbase — Hover Table Schema Summary
// @namespace    https://quickbase.com/userscripts
// @version      2.1
// @description  Summarizes table schema using API_GetSchema or REST API with automatic App Token discovery.
// @match        https://*.quickbase.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==


//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
//NOTE: This script would require the user to disable "Require Application Tokens" from the App Properties Page
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~


(function () {
  'use strict';

  // ── Configuration & State ────────────────────────────────────────────────
  const CONFIG = {
    debug: true,
    offset: 15
  };

  let state = {
    tooltip: null,
    lastTarget: null,
    ticket: null,
    apiCache: new Map(),
    elementCache: new WeakMap()
  };

  // ── Styles ──────────────────────────────────────────────────────────────
  function injectStyles() {
    GM_addStyle(`
      #qb-schema-popup {
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
      .qb-tt-header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #e1e3e6; margin-bottom: 8px; padding-bottom: 4px; }
      .qb-tt-name { font-weight: 700; font-size: 14px; color: #5b2f91; }
      .qb-tt-id { font-family: monospace; font-size: 10px; color: #636c7a; }
      .qb-tt-section { margin-bottom: 8px; }
      .qb-tt-label { color: #636c7a; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px; }
      .qb-tt-value { font-size: 12px; color: #272b32; font-weight: 500; }
      .qb-tt-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; background: #f4f5f6; padding: 6px; border-radius: 6px; margin-bottom: 8px; }
      .qb-tt-stat-box { display: flex; flex-direction: column; }
      .qb-tt-desc { font-size: 11px; color: #4b5563; font-style: italic; line-height: 1.3; }
      .qb-tt-loading { font-size: 11px; color: #636c7a; font-style: italic; display: flex; align-items: center; gap: 8px; }
    `);
  }

  const log = (msg, ...args) => {
    if (CONFIG.debug) {
      console.log(`%c[QB Schema] ${msg}`, 'color: #4a90d9; font-weight: bold;', ...args);
    }
  };

  // ── Auth & Discovery ────────────────────────────────────────────────────
  async function ensureTicket() {
    if (state.ticket) return state.ticket;
    try {
      const resp = await fetch('/db/main?a=API_GetUserInfo', { method: 'GET' });
      const text = await resp.text();
      const xml = new DOMParser().parseFromString(text, 'text/xml');
      state.ticket = xml.querySelector('ticket')?.textContent;
      return state.ticket;
    } catch (e) {
      return null;
    }
  }

  // ── API Logic ───────────────────────────────────────────────────────────
  async function fetchTableSchema(dbid) {
    if (state.apiCache.has(dbid)) return state.apiCache.get(dbid);

    try {
      const ticket = await ensureTicket();
      let params = ticket ? `&ticket=${ticket}` : '';

      const response = await fetch(`/db/${dbid}?a=API_GetSchema${params}`, { method: 'GET' });
      const text = await response.text();
      const xml = new DOMParser().parseFromString(text, 'text/xml');
      const errCode = xml.querySelector('errcode')?.textContent;

      if (errCode === '0') {
          const tableNode = xml.querySelector('table');
          const fields = Array.from(tableNode.querySelectorAll('field'));
          const formulaCount = fields.filter(f => f.getAttribute('mode') === 'virtual' || f.querySelector('formula')).length;
          const refCount = fields.filter(f => f.getAttribute('mode') === 'reference' || f.querySelector('masterdbid')).length;

          const summary = {
            name: tableNode.querySelector('name')?.textContent || 'Unnamed Table',
            desc: tableNode.querySelector('desc')?.textContent || 'No description.',
            fieldCount: fields.length,
            formulaCount: formulaCount,
            refCount: refCount,
            keyField: tableNode.querySelector('key_fid')?.textContent || '3',
            id: dbid
          };
          state.apiCache.set(dbid, summary);
          return summary;
      } else {
          log(`API_GetSchema Failed for ${dbid} - Errcode ${errCode}: ${xml.querySelector('errtext')?.textContent}`);
      }
    } catch (e) {
        log('Schema Fetch Error:', e);
    }

    return null;
  }

  // ── Tooltip Management ──────────────────────────────────────────────────
  function createTooltip() {
    if (document.getElementById('qb-schema-popup')) return;
    state.tooltip = document.createElement('div');
    state.tooltip.id = 'qb-schema-popup';
    document.body.appendChild(state.tooltip);
  }

  function updateTooltip(html, x, y) {
    if (!state.tooltip) return;
    if (html) state.tooltip.innerHTML = html;
    
    let left = x + CONFIG.offset;
    let top = y + CONFIG.offset;
    
    if (left + 320 > window.innerWidth) left = x - 335;
    if (top + 200 > window.innerHeight) top = y - 215;

    state.tooltip.style.left = `${left}px`;
    state.tooltip.style.top = `${top}px`;
    state.tooltip.style.display = 'block';
  }

  // ── Initialization ──────────────────────────────────────────────────────
  function init() {
    injectStyles();
    createTooltip();
    log('Schema Summarizer v2.1 (Dual-API) Initialized.');

    document.addEventListener('mousemove', (e) => {
      if (state.tooltip && state.tooltip.style.display === 'block') {
        updateTooltip(null, e.clientX, e.clientY);
      }
    }, { passive: true });

    document.addEventListener('mouseover', async (e) => {
      const target = e.target.closest('.css-ta74hp');
      if (!target || target === state.lastTarget) return;
      
      state.lastTarget = target;
      
      let dbid = state.elementCache.get(target);
      if (!dbid) {
        const link = target.closest('a') || target.querySelector('a');
        if (!link || !link.href) return;
        const url = link.href;
        const match = url.match(/\/table\/([^/?#]+)/) || url.match(/\/db\/([^/?#]+)/);
        dbid = match ? match[1] : null;
        if (dbid) state.elementCache.set(target, dbid);
      }

      if (!dbid) return;

      updateTooltip(`<div class="qb-tt-loading">Summarizing ${dbid}...</div>`, e.clientX, e.clientY);

      const schema = await fetchTableSchema(dbid);
      
      if (schema && state.lastTarget === target) {
        const html = `
          <div class="qb-tt-header">
            <span class="qb-tt-name">${schema.name}</span>
            <span class="qb-tt-id">${schema.id}</span>
          </div>
          
          <div class="qb-tt-section">
            <span class="qb-tt-label">Description</span>
            <div class="qb-tt-desc">${schema.desc}</div>
          </div>

          <div class="qb-tt-stats">
            <div class="qb-tt-stat-box">
              <span class="qb-tt-label">Total Fields</span>
              <span class="qb-tt-value">${schema.fieldCount}</span>
            </div>
            <div class="qb-tt-stat-box">
              <span class="qb-tt-label">Key FID</span>
              <span class="qb-tt-value">#${schema.keyField}</span>
            </div>
            <div class="qb-tt-stat-box">
              <span class="qb-tt-label">Formulas</span>
              <span class="qb-tt-value">${schema.formulaCount}</span>
            </div>
            <div class="qb-tt-stat-box">
              <span class="qb-tt-label">Relationships</span>
              <span class="qb-tt-value">${schema.refCount}</span>
            </div>
          </div>
        `;
        updateTooltip(html, e.clientX, e.clientY);
      }
    }, true);

    document.addEventListener('mouseout', (e) => {
      const target = e.target.closest('.css-ta74hp');
      if (target) {
        state.lastTarget = null;
        if (state.tooltip) state.tooltip.style.display = 'none';
      }
    }, true);
  }

  init();
})();
