// ProductImportAi — the "Read with AI" step of the products import modal
// (AdminProductsView). Ported from icelandicstore #306/#314 (their modal code
// lived inside AdminProductsView; here it is a component so the view's hunk is
// three lines). SHIPS DARK: nothing renders unless GET …/import/ai-config says
// `enabled` (PRODUCT_IMPORT_AI_ENABLED on the server).
//
// What it does, for a PDF the admin picked:
//  - offers "Read with AI" (primary when the normal reader found nothing);
//  - splits the PDF into page chunks in the browser (pdf-lib, vendored as
//    public/js/vendor/pdf-lib.esm.min.js, loaded only when pressed) and sends
//    them one at a time (utils/aiPdfChunks.js: keeps finished chunks, one
//    retry for busy/502/503/network, stops on a spent budget, Stop aborts);
//  - lists what the reader could not confirm, per row and page;
//  - prices what it read: markup on cost → ISK, and an ISK-per-EUR rate → EUR
//    (utils/importMarkup.js), always from the rows AS READ;
//  - hands the rows to the modal's own preview → apply (never writes).
// Every string the model produced is escaped. Tokens only (admin-products.css).
import { t } from '../i18n/i18n.js';
import { escHtml } from '../utils/escHtml.js';
import { runAiChunks, emptyRunStatusKey } from '../utils/aiPdfChunks.js';
import {
  parseMarkupPercent, parseEurRate, applyPricing, hasCostOnlyRows, hasEurlessRows,
} from '../utils/importMarkup.js';
import { adminProductImportAiConfig, adminProductImportAiExtract } from '../services/adminProducts.js';

// Literal keys so check:i18n can see every label.
const FLAG_KEY = {
  barcode:          'adminProducts.importAiFlag.barcode',
  supplier_code:    'adminProducts.importAiFlag.supplier_code',
  price:            'adminProducts.importAiFlag.price',
  price_eur:        'adminProducts.importAiFlag.price_eur',
  existing_product: 'adminProducts.importAiFlag.existing_product',
  sku_derived:      'adminProducts.importAiFlag.sku_derived',
};
const flagText = (f) => (FLAG_KEY[f] ? t(FLAG_KEY[f]) : String(f));

async function loadPdfLib() {
  return import('../vendor/pdf-lib.esm.min.js');
}

/**
 * @param {HTMLElement} container  an empty element inside the modal
 * @param {{ onRows: (rows: object[]) => void }} opts  called with rows ready for /preview
 * @returns {{ setFile: (file: File|null, o?: { readerFailed?: boolean }) => void, destroy: () => void }}
 */
export function mountImportAi(container, { onRows }) {
  let config = null;
  let file = null;
  let asRead = [];
  let ctrl = null;
  let destroyed = false;
  const configReady = adminProductImportAiConfig().then((c) => { config = c; return c; });

  container.className = 'prod-import-ai';
  container.hidden = true;
  container.innerHTML = `
    <p class="admin-shop__hint" id="prod-ai-intro"></p>
    <div class="prod-import-ai__actions">
      <button type="button" class="btn btn--outline btn--sm" id="prod-ai-read">${escHtml(t('adminProducts.importAiRead'))}</button>
      <button type="button" class="btn btn--ghost btn--sm" id="prod-ai-stop" hidden>${escHtml(t('adminProducts.importAiStop'))}</button>
    </div>
    <p class="admin-shop__hint" id="prod-ai-progress" role="status" aria-live="polite"></p>
    <p class="admin-shop__error" id="prod-ai-error" role="alert"></p>
    <fieldset class="prod-import-ai__pricing" id="prod-ai-pricing" hidden>
      <legend>${escHtml(t('adminProducts.importAiPricing'))}</legend>
      <div class="prod-import-ai__field" id="prod-ai-markup-wrap">
        <label for="prod-ai-markup">${escHtml(t('adminProducts.importAiMarkup'))}</label>
        <input type="text" inputmode="decimal" id="prod-ai-markup" class="form-input" autocomplete="off" aria-describedby="prod-ai-markup-hint prod-ai-markup-err">
        <span class="form-hint" id="prod-ai-markup-hint">${escHtml(t('adminProducts.importAiMarkupHint'))}</span>
        <span class="prod-import-ai__err" id="prod-ai-markup-err"></span>
      </div>
      <div class="prod-import-ai__field" id="prod-ai-eur-wrap">
        <label for="prod-ai-eur">${escHtml(t('adminProducts.importAiEurRate'))}</label>
        <input type="text" inputmode="decimal" id="prod-ai-eur" class="form-input" autocomplete="off" aria-describedby="prod-ai-eur-hint prod-ai-eur-err">
        <span class="form-hint" id="prod-ai-eur-hint">${escHtml(t('adminProducts.importAiEurRateHint'))}</span>
        <span class="prod-import-ai__err" id="prod-ai-eur-err"></span>
      </div>
    </fieldset>
    <div id="prod-ai-notes"></div>`;
  const $ = (sel) => container.querySelector(sel);
  const readBtn = $('#prod-ai-read');
  const stopBtn = $('#prod-ai-stop');
  const progress = $('#prod-ai-progress');
  const errorEl = $('#prod-ai-error');

  function paintNotes() {
    const flagged = asRead.filter(r => Array.isArray(r.__uncertain) && r.__uncertain.length);
    const single = asRead.filter(r => !r.__variant).length;
    $('#prod-ai-notes').innerHTML = `
      ${single ? `<p class="admin-shop__hint">${escHtml(t('adminProducts.importAiSingles', { n: single }))}</p>` : ''}
      ${flagged.length ? `<p class="prod-import-ai__notes-h">${escHtml(t('adminProducts.importAiCheck', { n: flagged.length }))}</p>
        <ul class="prod-import-ai__notes">${flagged.slice(0, 50).map(r => `
          <li>${r.__page ? `<span class="prod-import-ai__page">${escHtml(t('adminProducts.importAiPage', { n: r.__page }))}</span> ` : ''}${escHtml(r.name)}${r.sku ? ` <code>${escHtml(r.sku)}</code>` : ''} — ${escHtml(r.__uncertain.map(flagText).join(', '))}</li>`).join('')}
        </ul>` : ''}`;
  }

  // Re-price from the rows AS READ and hand them to the preview. An invalid
  // field marks itself and sends nothing.
  function emitPriced() {
    const mk = $('#prod-ai-markup'), eu = $('#prod-ai-eur');
    const m = parseMarkupPercent(mk.value);
    const e = parseEurRate(eu.value);
    const mark = (input, errEl, ok, key) => {
      if (ok) { input.removeAttribute('aria-invalid'); errEl.textContent = ''; }
      else { input.setAttribute('aria-invalid', 'true'); errEl.textContent = t(key); }
    };
    mark(mk, $('#prod-ai-markup-err'), m.ok, m.reason === 'too_high' ? 'adminProducts.importAiMarkupTooHigh' : 'adminProducts.importAiMarkupInvalid');
    mark(eu, $('#prod-ai-eur-err'), e.ok, 'adminProducts.importAiEurRateInvalid');
    if (!m.ok || !e.ok) return;
    const { rows } = applyPricing(asRead, { percent: m.percent, eurRate: e.rate });
    onRows(rows);
  }
  $('#prod-ai-markup').addEventListener('change', emitPriced);
  $('#prod-ai-eur').addEventListener('change', emitPriced);

  async function read() {
    if (!file) return;
    errorEl.textContent = '';
    progress.textContent = t('adminProducts.importAiLoading');
    readBtn.disabled = true;
    stopBtn.hidden = false;
    ctrl = new AbortController();
    let result;
    try {
      const { PDFDocument } = await loadPdfLib();
      const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const pageCount = src.getPageCount();
      const maxFile = Number(config.maxFilePages) || pageCount;
      if (pageCount > maxFile) {
        errorEl.textContent = t('adminProducts.importAiTooLong', { n: pageCount, max: maxFile });
        return;
      }
      const extractChunk = async (from, to, signal) => {
        const out = await PDFDocument.create();
        const idx = [];
        for (let i = from - 1; i < to; i += 1) idx.push(i);
        const copied = await out.copyPages(src, idx);
        copied.forEach(p => out.addPage(p));
        const bytes = await out.save();
        return adminProductImportAiExtract(new Blob([bytes], { type: 'application/pdf' }), { from, to, signal });
      };
      result = await runAiChunks({
        pageCount, chunkPages: Number(config.chunkPages) || 3, extractChunk, signal: ctrl.signal,
        onProgress: (ev) => {
          if (destroyed) return;
          if (ev.type === 'start') progress.textContent = t('adminProducts.importAiProgress', { from: ev.from, to: ev.to, total: ev.pageCount });
          if (ev.type === 'retry') progress.textContent = t('adminProducts.importAiRetry', { from: ev.from, to: ev.to });
        },
      });
    } catch (err) {
      errorEl.textContent = err && err.message ? err.message : String(err);
      return;
    } finally {
      readBtn.disabled = false;
      stopBtn.hidden = true;
      ctrl = null;
    }
    if (destroyed || !result) return;
    asRead = result.rows;
    if (result.aborted) progress.textContent = t('adminProducts.importAiStopped', { n: asRead.length });
    else if (result.failed) {
      progress.textContent = '';
      errorEl.textContent = t('adminProducts.importAiChunkFailed', { from: result.failed.from, to: result.failed.to, n: asRead.length })
        + (result.failed.message ? ` (${result.failed.message})` : '');
    } else {
      const key = emptyRunStatusKey(result);
      progress.textContent = key ? t(key) : t('adminProducts.importAiDone', { n: asRead.length });
    }
    $('#prod-ai-pricing').hidden = !(hasCostOnlyRows(asRead) || hasEurlessRows(asRead));
    $('#prod-ai-markup-wrap').hidden = !hasCostOnlyRows(asRead);
    $('#prod-ai-eur-wrap').hidden = !hasEurlessRows(asRead);
    paintNotes();
    if (asRead.length) emitPriced();
  }
  readBtn.addEventListener('click', read);
  stopBtn.addEventListener('click', () => { if (ctrl) ctrl.abort(); });

  return {
    async setFile(f, { readerFailed = false } = {}) {
      file = f || null;
      asRead = [];
      errorEl.textContent = '';
      progress.textContent = '';
      $('#prod-ai-notes').innerHTML = '';
      $('#prod-ai-pricing').hidden = true;
      const cfg = config || await configReady;
      const isPdf = Boolean(file) && (/\.pdf$/i.test(file.name || '') || file.type === 'application/pdf');
      container.hidden = destroyed || !cfg.enabled || !isPdf;
      if (container.hidden) return;
      readBtn.className = `btn btn--sm ${readerFailed ? 'btn--primary' : 'btn--outline'}`;
      $('#prod-ai-intro').textContent = t(readerFailed ? 'adminProducts.importAiIntroFailed' : 'adminProducts.importAiIntro',
        { n: Number(cfg.remainingPages) || 0 });
    },
    destroy() { destroyed = true; if (ctrl) ctrl.abort(); },
  };
}
