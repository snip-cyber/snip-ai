(() => {
  const API = 'https://snip-ai-omega.vercel.app/api/pdf-find';
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let pdfUrl = params.get('url') || '';
  const originalTabId = Number.parseInt(params.get('tabId') || '', 10);
  let authMode = 'login';
  let loadedPdfUrl = '';
  let viewerLoadPromise = null;

  // The viewer iframe is navigated exactly once per PDF (see init at the bottom).
  // Re-assigning iframe.src to the same document with only a different #page
  // fragment is a same-document navigation: the browser fires no 'load' event,
  // so the old code waited for an event that could never arrive and reported
  // "Timed out while opening the PDF". Page changes now go through the viewer API.
  let loadAttempt = 0;
  function viewerUrl(page = 1) {
    const url = new URL(chrome.runtime.getURL('web/viewer.html'));
    url.searchParams.set('file', pdfUrl);
    // A changed query string (unlike a changed fragment) forces a real reload.
    if (loadAttempt > 0) url.searchParams.set('snipReload', String(loadAttempt));
    url.hash = `page=${page}`;
    return url.toString();
  }

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  function withTimeout(promise, ms, message) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
    ]).finally(() => clearTimeout(timer));
  }

  // Waits for: viewer script present -> app initialized -> document opened ->
  // pages created. Each stage is reported so a timeout names what was missing.
  async function waitForPdfDocument(timeoutMs = 45000) {
    const viewer = $('pdf-viewer');
    const started = Date.now();
    let stage = 'viewer-script-not-loaded';
    let loadError = null;
    let watchedTask = null;
    while (Date.now() - started < timeoutMs) {
      try {
        const app = viewer?.contentWindow?.PDFViewerApplication;
        if (app) {
          stage = 'viewer-not-initialized';
          if (app.initialized) {
            stage = 'document-not-opened';
            const task = app.pdfLoadingTask;
            if (task && task !== watchedTask) {
              watchedTask = task;
              task.promise.catch(error => { loadError = error; });
            }
            if (loadError) {
              throw new Error(`PDF.js could not open this PDF (${loadError.name || 'Error'}: ${loadError.message || loadError}). The host may block access from the extension or the file may be unavailable.`);
            }
            if (app.pdfDocument && app.pdfViewer) {
              stage = 'pages-not-created';
              await withTimeout(app.pdfViewer.pagesPromise, Math.max(1000, timeoutMs - (Date.now() - started)), 'pages-not-created');
              return app;
            }
          }
        }
      } catch (error) {
        if (/PDF\.js could not open/.test(error?.message || '')) throw error;
        // Otherwise the viewer is still navigating; keep polling.
      }
      await delay(150);
    }
    throw new Error(`Timed out waiting for the PDF viewer (stalled at: ${stage}). Check that the PDF is reachable.`);
  }

  async function ensurePdfViewer(page) {
    const viewer = $('pdf-viewer');
    if (!viewer) throw new Error('The embedded PDF viewer is unavailable.');
    if (!pdfUrl) throw new Error('No PDF URL was provided.');
    if (!viewerLoadPromise) startViewerLoad(false);
    let app;
    try {
      app = await viewerLoadPromise;
    } catch (firstError) {
      // One genuine reload (distinct query string) for a viewer that failed to open.
      diag('viewer-load-failed-retrying', { message: firstError?.message || String(firstError) });
      startViewerLoad(true);
      app = await viewerLoadPromise;
    }
    if (!Number.isInteger(page) || page < 1 || page > app.pdfDocument.numPages) {
      throw new Error('The selected PDF page is outside the document.');
    }
    return app;
  }

  // Starts (or restarts) loading the document into the iframe. Only the first
  // call sets iframe.src; later calls reuse the same initialized viewer.
  function startViewerLoad(forceReload) {
    const viewer = $('pdf-viewer');
    loadedPdfUrl = '';
    if (forceReload) loadAttempt += 1;
    if (forceReload || !viewer.getAttribute('data-snip-loaded')) {
      viewer.setAttribute('data-snip-loaded', '1');
      viewer.src = viewerUrl(1);
    }
    viewerLoadPromise = waitForPdfDocument().then(app => { loadedPdfUrl = pdfUrl; return app; });
    viewerLoadPromise.catch(() => {});
    return viewerLoadPromise;
  }

  // Resolves once the text layer for `page` is rendered (event or DOM check).
  function waitForTextLayer(app, page, timeoutMs = 10000) {
    const isReady = () => {
      try {
        const view = app.pdfViewer.getPageView(page - 1);
        return !!(view?.textLayer?.renderingDone && view.textLayer.div?.childElementCount > 0);
      } catch (_) { return false; }
    };
    if (isReady()) return Promise.resolve(true);
    return new Promise(resolve => {
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(poll);
        app.eventBus.off('textlayerrendered', onRendered);
        resolve(value);
      };
      const onRendered = evt => { if (evt?.pageNumber === page) finish(true); };
      const timer = setTimeout(() => finish(isReady()), timeoutMs);
      const poll = setInterval(() => { if (isReady()) finish(true); }, 200);
      app.eventBus.on('textlayerrendered', onRendered);
    });
  }

  async function goToPageAndWait(app, page) {
    app.pdfViewer.currentPageNumber = page;
    return waitForTextLayer(app, page);
  }

  // True only when PDF.js has actually painted a selected highlight span on `page`.
  async function highlightRendered(app, page, timeoutMs = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const view = app.pdfViewer.getPageView(page - 1);
        const spans = view?.textLayer?.div?.querySelectorAll('.highlight.selected');
        if (spans && spans.length > 0) return true;
      } catch (_) {}
      await delay(100);
    }
    return false;
  }

  const pageTextCache = new WeakMap();
  const pdfIndexBuilds = new WeakMap();
  const INDEX_DB_NAME = 'snip-pdf-index-v2';
  const INDEX_STORE = 'pages';
  let indexDbPromise;

  function openIndexDb() {
    if (indexDbPromise) return indexDbPromise;
    indexDbPromise = new Promise(resolve => {
      if (!('indexedDB' in window)) { resolve(null); return; }
      let request;
      try { request = indexedDB.open(INDEX_DB_NAME, 1); }
      catch (_) { resolve(null); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(INDEX_STORE)) db.createObjectStore(INDEX_STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return indexDbPromise;
  }

  async function readIndexedPage(key) {
    const db = await openIndexDb();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const request = db.transaction(INDEX_STORE, 'readonly').objectStore(INDEX_STORE).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }

  async function writeIndexedPage(record) {
    const db = await openIndexDb();
    if (!db) return false;
    return new Promise(resolve => {
      try {
        const request = db.transaction(INDEX_STORE, 'readwrite').objectStore(INDEX_STORE).put(record);
        request.onsuccess = () => resolve(true);
        request.onerror = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }

  function pdfIdentity(app) {
    const doc = app.pdfDocument;
    const fingerprint = Array.isArray(doc?.fingerprints) ? doc.fingerprints[0] : '';
    // URL scopes the cache to this source; PDF.js fingerprint and page count
    // invalidate it when the file contents change at the same URL.
    return `${pdfUrl}::${fingerprint || 'no-fingerprint'}::${doc?.numPages || 0}`;
  }

  const HIGHLIGHT_PREFIX = 'snip_pdf_highlight_';
  const HIGHLIGHT_TTL = 24 * 60 * 60 * 1000;

  function highlightStorageKey(identity) {
    let hash = 2166136261;
    for (let i = 0; i < identity.length; i++) {
      hash ^= identity.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return HIGHLIGHT_PREFIX + (hash >>> 0).toString(16);
  }

  async function savePdfHighlight(app, evidence, page, quote) {
    try {
      const identity = pdfIdentity(app);
      const key = highlightStorageKey(identity);
      await chrome.storage.local.set({
        [key]: {
          identity,
          text: String(evidence || '').slice(0, 3000),
          quote: String(quote || '').slice(0, 1000),
          page,
          savedAt: Date.now(),
          expiresAt: Date.now() + HIGHLIGHT_TTL
        }
      });
    } catch (error) {
      diag('highlight-save-failed', { message: error?.message || String(error) });
    }
  }

  async function restoreSavedHighlight() {
    try {
      const app = await ensurePdfViewer(1);
      const identity = pdfIdentity(app);
      const key = highlightStorageKey(identity);
      const stored = await chrome.storage.local.get(key);
      const record = stored?.[key];

      if (!record) return;
      if (record.identity !== identity || !record.expiresAt || record.expiresAt <= Date.now()) {
        await chrome.storage.local.remove(key);
        return;
      }

      if (!Number.isInteger(record.page) || record.page < 1 || record.page > app.pdfDocument.numPages) {
        await chrome.storage.local.remove(key);
        return;
      }

      const restored = await findAndHighlightPassage(
        app, record.text, record.page, record.quote
      );

      if (restored.found) {
        diag('highlight-restored', { page: restored.matchedPage || record.page });
      } else {
        diag('highlight-restore-not-found', { page: record.page });
      }
    } catch (error) {
      diag('highlight-restore-failed', { message: error?.message || String(error) });
    }
  }

  function assemblePdfText(items) {
    // Reconstruct reading text from PDF.js text items without blindly
    // concatenating item strings. PDF.js often puts adjacent words in
    // separate items (especially in tables); joining them directly turns
    // `cash`, `and`, `cash`, `equivalents` into one unsearchable token.
    // Keep every original item and its geometry alongside the reconstructed
    // text so later precision improvements can use the source coordinates.
    const chunks = [];
    let previous = null;
    for (const item of items) {
      if (!item.str) { previous = item; continue; }
      let separator = '';
      if (previous && previous.str) {
        const prevTransform = previous.transform;
        const curTransform = item.transform;
        const prevY = prevTransform ? prevTransform[5] : null;
        const curY = curTransform ? curTransform[5] : null;
        const prevX = prevTransform ? prevTransform[4] : null;
        const curX = curTransform ? curTransform[4] : null;
        const prevHeight = Math.abs(previous.height || (prevTransform && prevTransform[3]) || 10);
        const curHeight = Math.abs(item.height || (curTransform && curTransform[3]) || 10);
        const lineTolerance = Math.max(2, Math.max(prevHeight, curHeight) * 0.45);
        const newLine = previous.hasEOL || (Number.isFinite(prevY) && Number.isFinite(curY) && Math.abs(curY - prevY) > lineTolerance);
        if (newLine) {
          separator = '\n';
        } else if (!/\s$/.test(previous.str) && !/^\s/.test(item.str)) {
          const prevWidth = Math.abs(previous.width || 0);
          const gap = Number.isFinite(prevX) && Number.isFinite(curX) ? curX - (prevX + prevWidth) : 0;
          const wordBoundary = /[\p{L}\p{N}]$/u.test(previous.str) && /^[\p{L}\p{N}]/u.test(item.str);
          const gapThreshold = Math.max(0.8, Math.min(3, Math.max(prevHeight, curHeight) * 0.14));
          if (gap > gapThreshold || (wordBoundary && gap >= -0.25)) separator = ' ';
        }
      }
      chunks.push(separator, item.str);
      previous = item;
    }
    return chunks.join('').replace(/[ \t\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\s+/g, ' ').trim();
  }

  async function getPageSearchText(app, pageNumber) {
    let documentCache = pageTextCache.get(app.pdfDocument);
    if (!documentCache) {
      documentCache = new Map();
      pageTextCache.set(app.pdfDocument, documentCache);
    }
    if (!documentCache.has(pageNumber)) {
      documentCache.set(pageNumber, (async () => {
        const key = `${pdfIdentity(app)}::page:${pageNumber}`;
        const saved = await readIndexedPage(key);
        if (saved && saved.identity === pdfIdentity(app) && typeof saved.text === 'string') {
          diag('pdf-index-cache-hit', { page: pageNumber, chars: saved.text.length });
          return saved.text;
        }
        const page = await app.pdfDocument.getPage(pageNumber);
        const content = await page.getTextContent({ includeMarkedContent: false });
        const items = content.items.filter(item => typeof item.str === 'string').map(item => ({
          str: item.str,
          hasEOL: !!item.hasEOL,
          transform: Array.isArray(item.transform) ? item.transform.slice(0, 6) : null,
          width: Number.isFinite(item.width) ? item.width : null,
          height: Number.isFinite(item.height) ? item.height : null,
          dir: item.dir || 'ltr'
        }));
        const text = assemblePdfText(items);
        await writeIndexedPage({ key, identity: pdfIdentity(app), page: pageNumber, text, items, indexedAt: Date.now() });
        diag('pdf-index-page-saved', { page: pageNumber, chars: text.length, items: items.length });
        return text;
      })());
    }
    return documentCache.get(pageNumber);
  }

  async function buildPdfIndex(app) {
    if (pdfIndexBuilds.has(app.pdfDocument)) return pdfIndexBuilds.get(app.pdfDocument);
    const task = (async () => {
      const total = Number(app?.pdfDocument?.numPages) || 0;
      if (!total) throw new Error('The PDF has no readable pages.');
      let indexed = 0;
      for (let page = 1; page <= total; page++) {
        await getPageSearchText(app, page);
        indexed++;
        if (page === 1 || page === total || page % 10 === 0) {
          diag('pdf-index-progress', { indexed, total });
        }
      }
      return { indexed, total };
    })();
    pdfIndexBuilds.set(app.pdfDocument, task);
    return task;
  }

  function evidenceTokens(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase()
      .replace(/[\u00ad\u200b\ufeff]/g, '')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, '')
      .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
  }

  function pageWordSpans(value) {
    const text = String(value || '').normalize('NFKC')
      .replace(/[\u00ad\u200b\ufeff]/g, '');
    const spans = [];
    const regex = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const next = { token: match[0].toLocaleLowerCase(), start: match.index, end: match.index + match[0].length };
      const previous = spans[spans.length - 1];
      // PDF text extraction often inserts a space between a line-end hyphen and
      // the continuation on the next line ("inter- national"). Treat that as
      // one word for matching, while preserving the original source range for
      // the eventual PDF.js find query.
      if (previous && /[-\u2010\u2011]\s+$/.test(text.slice(previous.end, next.start))) {
        previous.token += next.token;
        previous.end = next.end;
      } else {
        spans.push(next);
      }
    }
    return { text, spans };
  }

  // Find the longest verbatim word sequence shared by the backend evidence and
  // PDF.js's own extracted page text. Searching a phrase taken from the PDF
  // itself avoids many differences caused by line wrapping and item boundaries.
  function bestPagePhrase(pageText, evidenceText) {
    const { text, spans } = pageWordSpans(pageText);
    const evidence = evidenceTokens(evidenceText);
    if (spans.length < 4 || evidence.length < 4) return null;
    const pageNormalized = ` ${spans.map(span => span.token).join(' ')} `;
    const maxWords = Math.min(20, evidence.length);
    for (let words = maxWords; words >= 4; words--) {
      for (let start = 0; start + words <= evidence.length; start++) {
        const phrase = evidence.slice(start, start + words).join(' ');
        if (pageNormalized.includes(` ${phrase} `)) {
          // Keep the source punctuation and casing from the PDF itself so the
          // viewer's find controller receives a phrase faithful to its text layer.
          for (let pageStart = 0; pageStart + words <= spans.length; pageStart++) {
            let equal = true;
            for (let offset = 0; offset < words; offset++) {
              if (spans[pageStart + offset].token !== evidence[start + offset]) { equal = false; break; }
            }
            if (equal) {
              const first = spans[pageStart];
              const last = spans[pageStart + words - 1];
              return { query: text.slice(first.start, last.end).trim(), wordCount: words };
            }
          }
        }
      }
    }
    return null;
  }

  // Verify financial-table evidence against the actual extracted PDF page before
  // allowing a label-only anchor to count as a successful match. A repeated row
  // label is not enough: when the backend supplied numeric cells, those values
  // must also occur near that label on the candidate page.
  function verifyFinancialRowEvidence(pageText, evidenceText, quote = '') {
    const quoteText = String(quote || '').replace(/\s+/g, ' ').trim();
    const quoteHasCells = (quoteText.replace(/\b[A-Z]{1,3}\s*\d{1,3}\b/gi, ' ').match(/[-−]?\(?\d[\d,]*(?:\.\d+)?%?\)?/g) || []).length >= 2;
    const rowText = String(quoteHasCells ? quoteText : (evidenceText || quoteText)).replace(/\s+/g, ' ').trim();
    const normalized = rowText.replace(/\s*\([^)]*(?:note|see|refer|page)[^)]*\)\s*/ig, ' ');
    const label = labelOnlyQuote(rowText);
    const labelTokens = evidenceTokens(label);
    const afterLabel = normalized.slice(Math.max(0, normalized.toLocaleLowerCase().indexOf(label.toLocaleLowerCase())) + label.length)
      .replace(/\b[A-Z]{1,3}\s*\d{1,3}\b/gi, ' ');
    const numericCells = afterLabel.match(/[-−]?\(?\d[\d,]*(?:\.\d+)?%?\)?/g) || [];
    // Only apply this strict check to rows with a meaningful label and multiple
    // numeric cells; ordinary prose and non-financial evidence use other checks.
    if (numericCells.length < 2 || labelTokens.length < 3) return { applicable: false, valid: true };

    const { text, spans } = pageWordSpans(pageText);
    let labelAt = -1;
    for (let i = 0; i <= spans.length - labelTokens.length; i++) {
      if (labelTokens.every((token, offset) => spans[i + offset].token === token)) {
        labelAt = i;
        break;
      }
    }
    if (labelAt < 0) return { applicable: true, valid: false, reason: 'The row label is not present on the reported page.' };

    const expectedNumbers = numericCells.map(value => value.replace(/[−,()%]/g, '').replace(/^\(/, '').replace(/\)$/, ''));
    const tail = text.slice(spans[labelAt + labelTokens.length - 1].end,
      Math.min(text.length, spans[labelAt + labelTokens.length - 1].end + 240));
    const nearbyNumbers = (tail.match(/[-−]?\(?\d[\d,]*(?:\.\d+)?%?\)?/g) || [])
      .map(value => value.replace(/[−,()%]/g, '').replace(/^\(/, '').replace(/\)$/, ''));
    const missing = expectedNumbers.filter(value => !nearbyNumbers.includes(value));
    if (missing.length > 0) {
      return { applicable: true, valid: false, reason: 'The reported row label is present, but its numeric evidence does not match nearby cells on that page.', missing };
    }
    return { applicable: true, valid: true };
  }

  function labelOnlyQuote(quote) {
    let label = String(quote || '').replace(/\s+/g, ' ').trim();
    // Financial table quotes often combine a row label, note reference, and
    // numeric cell. Prefer the label itself so the selected highlight doesn't
    // spill over adjacent note numbers or financial values.
    label = label.replace(/\s*\([^)]*(?:note|see|refer|page)[^)]*\)\s*/ig, ' ');
    // Remove trailing financial values, then note-reference codes such as C12
    // (which commonly sit between the row label and numeric columns).
    label = label.replace(/[\s,]+(?:[-−]?\(?\d[\d,]*(?:\.\d+)?%?\)?)(?:[\s,]+(?:[-−]?\(?\d[\d,]*(?:\.\d+)?%?\)?))*\s*$/, '');
    label = label.replace(/[\s,;:–—-]+[A-Z]{1,3}\s*\d{1,3}[\s,;:]*$/i, '');
    return label.replace(/[\s,;:]+$/g, '').replace(/\s+/g, ' ').trim();
  }

  async function findAndHighlightPassage(app, evidenceText, expectedPage, quote = '') {
    const document = app.pdfDocument;
    if (!document || !app.eventBus || !app.findController) {
      return { found: false, reason: 'PDF.js search is not ready.' };
    }

    // Try the backend's page first, then inspect the rest of the PDF. This also
    // recovers when the backend reports a printed page number rather than the
    // physical PDF page index.
    const pageOrder = [expectedPage];
    for (let page = 1; page <= document.numPages; page++) {
      if (page !== expectedPage) pageOrder.push(page);
    }

    let best = null;
    let bestPage = null;
    // Prefer a label-only anchor before the backend's full label+figure quote.
    // This avoids highlighting neighboring numeric cells in financial tables.
    const anchors = [];
    const labelQuote = labelOnlyQuote(quote);
    if (labelQuote && evidenceTokens(labelQuote).length >= 3) anchors.push({ text: labelQuote, source: 'backend-label' });

    // The PDF evidence API may omit its optional `quote` field and return only a
    // full table row in `text`/`passage`. In that case, derive a label-only anchor
    // from the evidence itself before trying the full row; otherwise PDF.js can
    // highlight the note reference and adjacent numeric cells together.
    const evidenceLabelQuote = labelOnlyQuote(evidenceText);
    const hasMultipleTrailingNumericCells = /(?:\s+(?:[-−]?\(?\d[\d,]*(?:\.\d+)?%?\)?)){2,}\s*$/.test(String(evidenceText || '').replace(/\s*\([^)]*(?:note|see|refer|page)[^)]*\)\s*/ig, ' '));
    if (hasMultipleTrailingNumericCells && evidenceLabelQuote &&
        evidenceTokens(evidenceLabelQuote).length >= 3 &&
        evidenceTokens(evidenceLabelQuote).length < evidenceTokens(evidenceText).length &&
        evidenceLabelQuote !== labelQuote) {
      anchors.push({ text: evidenceLabelQuote, source: 'evidence-label' });
    }

    if (quote && evidenceTokens(quote).length >= 4) anchors.push({ text: quote, source: 'backend-quote' });
    anchors.push({ text: evidenceText, source: 'pdf-text-overlap' });
    let anchorSource = 'pdf-text-overlap';
    for (const anchor of anchors) {
      for (const pageNumber of pageOrder) {
        let pageText;
        try {
          pageText = await getPageSearchText(app, pageNumber);
        } catch (error) {
          diag('page-text-extraction-error', { page: pageNumber, message: error?.message || String(error) });
          continue;
        }
        const match = bestPagePhrase(pageText, anchor.text);
        if (match && (!best || match.wordCount > best.wordCount)) {
          best = match;
          bestPage = pageNumber;
          anchorSource = anchor.source;
          // Prefer the backend's own page when the quote is found there.
          if (match.wordCount >= 10 || (anchor.source === 'backend-quote' && pageNumber === expectedPage)) break;
        }
      }
      if (best) break;
    }

    // If the evidence is paraphrased, retain the old excerpt strategy as a
    // fallback. Prefer a phrase extracted from the actual PDF whenever possible.
    const normalized = String(evidenceText || '').replace(/\s+/g, ' ').trim();
    const queries = [];
    if (best?.query) {
      const words = best.query.split(/\s+/).filter(Boolean);
      const variants = [];
      for (let len = words.length; len >= 4; len--) {
        const windows = [];
        for (let start = 0; start + len <= words.length; start++) {
          const q = words.slice(start, start + len).join(' ');
          windows.push({ q, start, hasDigit: /\d/.test(q) });
        }
        // Prefer label text without digits and earlier text within a row; figures
        // frequently belong to adjacent table cells rather than the label.
        windows.sort((a, b) => (a.hasDigit - b.hasDigit) || (a.start - b.start));
        for (const w of windows) variants.push({ query: w.q, page: bestPage, source: len === words.length ? anchorSource : anchorSource + '-trimmed' });
        if (variants.length >= 14) break;
      }
      queries.push(...variants.slice(0, 14));
    }
    const lengths = [85, 42];
    const starts = [...new Set([0, Math.max(0, Math.floor(normalized.length / 2) - 20), Math.max(0, normalized.length - 65)])];
    for (const start of starts) {
      for (const length of lengths) {
        let query = normalized.slice(start, start + length);
        if (start > 0) query = query.replace(/^\S+\s/, '');                    // drop a cut-off leading word only
        if (start + length < normalized.length) query = query.replace(/\s+\S*$/, ''); // drop a cut-off trailing word only
        query = query.trim();
        if (query.length >= 18 && !queries.some(item => item.query === query)) {
          queries.push({ query, page: expectedPage, source: 'evidence-excerpt' });
        }
      }
    }

    const eventBus = app.eventBus;
    const findController = app.findController;
    for (const candidate of queries) {
      const query = candidate.query;
      const targetPage = candidate.page || expectedPage;
      // Set the target page before each query; PDF.js starts its search from
      // the current page. The selected match is still verified after the event.
      const layerReady = await goToPageAndWait(app, targetPage);
      if (!layerReady) diag('text-layer-not-ready', { page: targetPage });
      const result = await new Promise(resolve => {
        let settled = false;
        let timer;
        const finish = value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          eventBus.off('updatefindcontrolstate', onState);
          resolve(value);
        };
        const onState = async evt => {
          if (evt?.rawQuery !== query) return;
          if (evt?.state === 0) {
            // Allow the find controller to finish updating selected/pageMatches.
            await delay(100);
            // PDF.js may select the first occurrence elsewhere in the document,
            // even when this phrase also occurs on the evidence page. Prefer an
            // occurrence on the intended page before treating the attempt as a miss.
            const targetPageIdx = targetPage - 1;
            const targetMatches = findController.pageMatches?.[targetPageIdx];
            if (Array.isArray(targetMatches) && targetMatches.length > 0) {
              const selected = findController.selected;
              const matchIdx = Number(selected?.pageIdx) === targetPageIdx &&
                Number.isInteger(Number(selected?.matchIdx)) &&
                Number(selected.matchIdx) < targetMatches.length
                  ? Number(selected.matchIdx)
                  : 0;

              // PDF.js 3.11 exposes `selected` as a getter-only property.
              // Assigning `findController.selected = ...` silently does nothing,
              // so the UI can report the target page while the real selected
              // occurrence (and therefore its highlight) remains on another page.
              // This build is pinned to the bundled PDF.js 3.x viewer, whose
              // selection storage is `_selected`; verify it exists rather than
              // pretending a selection succeeded if the viewer implementation changes.
              if (!findController._selected || typeof findController._selected !== 'object') {
                finish({ found: false, query, reason: 'This PDF.js version does not expose a compatible match selector.' });
                return;
              }
              findController._selected = { pageIdx: targetPageIdx, matchIdx };
              app.pdfViewer.currentPageNumber = targetPage;
              eventBus.dispatch('updatetextlayermatches', {
                source: findController,
                pageIndex: targetPageIdx
              });
              await delay(180);
            }

            const selected = findController.selected;
            const selectedPage = Number(selected?.pageIdx);
            const selectedMatch = Number(selected?.matchIdx);
            const pageMatches = findController.pageMatches?.[selectedPage];
            if (!Number.isInteger(selectedPage) || selectedPage < 0 ||
                !Number.isInteger(selectedMatch) || selectedMatch < 0 ||
                !Array.isArray(pageMatches) || selectedMatch >= pageMatches.length) {
              finish({ found: false, query, reason: 'PDF.js reported a match without a valid selected occurrence.' });
              return;
            }
            const matchedPage = selectedPage + 1;
            if (matchedPage === targetPage) {
              app.pdfViewer.currentPageNumber = matchedPage;
              await waitForTextLayer(app, matchedPage);
              if (!(await highlightRendered(app, matchedPage))) {
                finish({ found: false, query, matchedPage, reason: 'PDF.js matched the phrase but no highlight was rendered on the page.' });
                return;
              }
              finish({ found: true, query, matchedPage, matchIdx: selectedMatch, source: candidate.source });
            } else {
              finish({ found: false, query, matchedPage, reason: 'The phrase matched a different page.' });
            }
          } else if (evt?.state === 1) {
            finish({ found: false, query, reason: 'PDF.js could not find this phrase.' });
          }
        };
        eventBus.on('updatefindcontrolstate', onState);
        timer = setTimeout(() => finish({ found: false, query, reason: 'PDF.js search timed out.' }), 3500);
        eventBus.dispatch('find', {
          source: window,
          type: 'find',
          query,
          phraseSearch: true,
          caseSensitive: false,
          entireWord: false,
          highlightAll: false,
          findPrevious: false
        });
      });
      diag('phrase-attempt', JSON.stringify({ page: targetPage, source: candidate.source, query, found: result.found, matchedPage: result.matchedPage || null, reason: result.reason || null }));
      if (result.found) {
        await delay(150);
        return result;
      }
    }
    return { found: false, query: queries[0]?.query || '', reason: best ? 'PDF.js could not highlight the matched evidence phrase.' : 'No sufficiently long verbatim phrase could be matched in the PDF text.' };
  }

  // Keep troubleshooting detail in the extension console without exposing
  // temporary diagnostic UI in the shipped popup.
  function diag(label, value) {
    console.info('[Snip PDF]', label, value);
  }

  function send(message) {
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(value);
      };
      const timeoutId = setTimeout(() => finish({
        ok: false,
        error: 'Snip did not receive a response. Please try again.'
      }), 16000);
      try {
        chrome.runtime.sendMessage(message, r => {
          if (chrome.runtime.lastError) finish({ok:false,error:chrome.runtime.lastError.message});
          else finish(r || {ok:false,error:'No response from Snip.'});
        });
      } catch (error) {
        finish({ok:false,error:error?.message || 'Could not contact Snip.'});
      }
    });
  }
  function usageText(x) {
    if (!x?.ok) return 'Plan unavailable';
    if (x.plan === 'unlimited') return 'Unlimited · no Snip limit';
    if (x.plan === 'anonymous' || x.plan === 'free') return `Free · ${x.remaining} of ${x.limit} searches left today`;
    if (x.plan === 'pro') return `Pro · ${x.remaining} of ${x.limit} Snips left this month`;
    return `Free · ${x.remaining} of ${x.limit} Snips left today`;
  }
  async function refresh() {
    const a = await send({type:'SNIP_AUTH_GET_SESSION'});
    const u = await send({type:'SNIP_GET_USAGE'});
    $('usage').textContent = usageText(u);
    // Only visually mark a plan when the entitlement/usage endpoint reports it.
    const isFree = !!u?.ok && (u.plan === 'free' || u.plan === 'anonymous');
    const isPro = !!u?.ok && u.plan === 'pro';
    const isUnlimited = !!u?.ok && u.plan === 'unlimited';
    $('free').classList.toggle('active-plan', isFree);
    $('pro').classList.toggle('active-plan', isPro);
    $('unlimited').classList.toggle('active-plan', isUnlimited);
    $('free').textContent = isFree ? '✓ CURRENT PLAN · Free · 10/day' : 'Free · $0 · 10 searches/day';
    $('pro').textContent = isPro ? '✓ CURRENT PLAN · Pro · 500/month' : 'Pro · $5/mo · 500 searches/month';
    $('unlimited').textContent = isUnlimited ? '✓ CURRENT PLAN · Unlimited' : 'Unlimited · $15/mo';
    const logged = !!a?.user;
    $('login').hidden = logged; $('signup').hidden = logged; $('logout').hidden = !logged;
    $('manage').hidden = !(u?.authenticated && (u.plan === 'pro' || u.plan === 'unlimited'));
    const exhausted = !!u?.ok && u.plan !== 'unlimited' && Number(u.remaining) <= 0;
    $('upgrade-copy').textContent = exhausted ? (u.plan === 'pro' ? 'Your Pro monthly searches are finished. Choose a plan to continue.' : 'Your free searches are finished. Choose a plan to continue.') : (isPro ? 'Pro is your current plan. You can manage it or compare other plans.' : isUnlimited ? 'Unlimited is your current plan. You can manage it or compare other plans.' : 'Choose Free to keep using Snip at no cost, or compare paid plans.');
    // Clear a stale paywall after login when this account still has allowance.
    $('upgrade').hidden = !exhausted;
  }
  function openAuth(mode) {
    authMode = mode; $('auth').hidden = false; $('auth-submit').textContent = mode === 'signup' ? 'Create account' : 'Log in'; $('auth-status').textContent=''; $('email').focus();
  }
  async function submitAuth() {
    const email = $('email').value.trim();
    const password = $('password').value;
    if (!email || !password) {
      $('auth-status').textContent = 'Enter your email and password.';
      return;
    }

    const submittingMode = authMode;
    const submit = $('auth-submit');
    submit.disabled = true;
    $('auth-status').textContent = submittingMode === 'signup' ? 'Creating your account…' : 'Logging in…';

    try {
      const r = await send({
        type: submittingMode === 'signup' ? 'SNIP_AUTH_SIGNUP' : 'SNIP_AUTH_LOGIN',
        email,
        password
      });

      if (!r?.ok) {
        $('auth-status').textContent = r?.error || 'Authentication failed. Please try again.';
        return;
      }

      if (submittingMode === 'signup') {
        // Supabase may require email confirmation before a session is issued.
        // Tell the user the correct next step instead of implying they can log in immediately.
        $('auth-status').textContent = r.needsEmailConfirmation
          ? 'Check your email to confirm your account, then log in.'
          : 'Account created. You can now log in.';
        authMode = 'login';
        submit.textContent = 'Log in';
        $('password').value = '';
        $('password').placeholder = 'Password';
        return;
      }

      const sessionState = await send({type: 'SNIP_AUTH_GET_SESSION'});
      if (!sessionState?.user) {
        $('auth-status').textContent = 'The request completed, but Snip could not verify your login. Please try logging in again.';
        return;
      }

      $('auth').hidden = true;
      $('email').value = '';
      $('password').value = '';
      await refresh();
      $('status').textContent = 'Logged in successfully.';
    } catch (error) {
      const message = error?.message || 'Authentication failed. Please try again.';
      $('auth-status').textContent = message;
    } finally {
      submit.disabled = false;
    }
  }
  let searchInProgress = false;
  async function search() {
    const question=$('question').value.trim(); if(!question || searchInProgress) return;
    searchInProgress = true;
    if(!pdfUrl){$('status').textContent='Could not identify this PDF.';searchInProgress=false;return;}
    $('find').disabled=true;$('status').textContent='Snip is searching the PDF…';
    diag('search-start', { question, pdfUrl });
    let reservationId = null;
    try {
      const reservation = await send({type:'SNIP_USAGE_RESERVE'});
      if (!reservation?.ok || !reservation.reservation_id) throw new Error(reservation?.error || 'Sign in to reserve a Snip search.');
      reservationId = reservation.reservation_id;
      const result = await send({type:'SNIP_BACKEND_PDF_FIND', question, url:pdfUrl, reservationId});
      if (!result?.ok) throw new Error(result?.error || 'PDF search failed.');
      const data = result.data || {};
      diag('api-response', { pageCount: data.pageCount, evidenceCount: Array.isArray(data.evidence) ? data.evidence.length : 0, error: data.error || null });
      if (data.error) throw new Error(data.error);
      const evidence=Array.isArray(data.evidence)?data.evidence:[];
      // Keep only usable evidence. Prefer the API's highest confidence/score
      // when supplied; otherwise preserve its ranked order.
      const candidates=evidence.map((item,index)=>({
        item,index,
        text:String(item?.text||item?.passage||'').replace(/\s+/g,' ').trim(),
        quote:String(item?.quote||'').replace(/\s+/g,' ').trim(),
        page:Number(item?.page),
        score:Number.isFinite(Number(item?.confidence))?Number(item.confidence):
              Number.isFinite(Number(item?.score))?Number(item.score):null
      })).filter(x=>{
        const pageCount = Number(data.pageCount);
        const pageCountKnown = Number.isInteger(pageCount) && pageCount > 0;
        return x.text && Number.isInteger(x.page) && x.page >= 1 && (!pageCountKnown || x.page <= pageCount);
      });
      if(!candidates.length) throw new Error("Snip couldn't find a reliable passage and page number in this PDF. Try a more specific question.");
      candidates.sort((a,b)=>{
        if(a.score!==null && b.score!==null && b.score!==a.score) return b.score-a.score;
        if(a.score!==null && b.score===null) return -1;
        if(a.score===null && b.score!==null) return 1;
        return a.index-b.index;
      });

      let app = null;
      // If a question explicitly asks about a year-end figure, a repeated table
      // label can occur in both the primary statements and supporting notes. Use
      // the local full-document index to prefer an occurrence near the primary
      // statement of financial position, rather than blindly accepting the first
      // API hit. This is a narrow tie-breaker; ordinary questions keep API order.
      const asksYearEnd = /\b(?:end of (?:the )?financial year|year[- ]end|at year end|year ended|reporting date)\b/i.test(question);
      const candidateLabel = labelOnlyQuote(candidates[0]?.quote || candidates[0]?.text || '');
      const labelTokens = evidenceTokens(candidateLabel);
      if (asksYearEnd && labelTokens.length >= 3 && labelTokens.length <= 8) {
        try {
          app = await ensurePdfViewer(candidates[0].page);
          await buildPdfIndex(app);
          const targetPhrase = labelTokens.join(' ');
          const localMatches = [];
          for (let pageNumber = 1; pageNumber <= app.pdfDocument.numPages; pageNumber++) {
            const pageText = await getPageSearchText(app, pageNumber);
            const pageTokens = evidenceTokens(pageText);
            let found = false;
            for (let i = 0; i <= pageTokens.length - labelTokens.length; i++) {
              if (labelTokens.every((token, offset) => pageTokens[i + offset] === token)) { found = true; break; }
            }
            if (!found) continue;
            const lower = pageText.toLocaleLowerCase();
            let contextRank = 0;
            if (lower.includes('statement of financial position')) contextRank += 10;
            if (lower.includes('total assets')) contextRank += 4;
            if (lower.includes('current assets')) contextRank += 2;
            if (/\bas at (?:29|30|31)\s+[a-z]+\s+20\d{2}\b/i.test(pageText)) contextRank += 2;
            if (lower.includes('cash flow statement') || lower.includes('statement of cash flows')) contextRank -= 3;
            if (contextRank > 0) localMatches.push({
              item: null, index: -1, text: candidateLabel, quote: candidateLabel,
              page: pageNumber, score: null, contextRank, localContextMatch: true
            });
          }
          if (localMatches.length) {
            const contextRank = Math.max(...localMatches.map(match => match.contextRank));
            const preferred = localMatches.filter(match => match.contextRank === contextRank);
            for (const match of preferred) {
              const existing = candidates.find(candidate => candidate.page === match.page);
              if (existing) {
                existing.localContextMatch = true;
                existing.contextRank = match.contextRank;
              } else {
                candidates.unshift(match);
              }
            }
            // Prefer contextual local matches to API-ranked repetitions only
            // when the document provides a clear primary-statement signal.
            if (contextRank >= 10) candidates.sort((a, b) =>
              Number(!!b.localContextMatch) - Number(!!a.localContextMatch) ||
              (b.contextRank || 0) - (a.contextRank || 0) ||
              ((b.score ?? -Infinity) - (a.score ?? -Infinity)) || a.index - b.index
            );
            diag('year-end-context-rerank', { label: targetPhrase, preferredPages: preferred.map(match => ({ page: match.page, contextRank: match.contextRank })) });
          }
        } catch (contextError) {
          diag('year-end-context-rerank-skipped', { message: contextError?.message || String(contextError) });
        }
      }
      diag('selected-evidence', { page: candidates[0].page, text: candidates[0].text.slice(0, 600), candidates: candidates.map(c => ({ page: c.page, score: c.score, contextRank: c.contextRank || null, text: c.text.slice(0, 180) })) });
      // Do not let one imperfect top-ranked passage decide the whole result.
      // PDF extraction and PDF.js can disagree on line wrapping, page labels,
      // and text normalization. Try up to three ranked evidence passages, each
      // on its own reported page, and only report success when PDF.js confirms
      // the selected match on that same page.
      let selected = candidates[0];
      let highlight = { found: false, query: '', reason: 'No evidence passage could be confirmed.' };
      for (const candidate of candidates.slice(0, 3)) {
        selected = candidate;
        try {
          app = await ensurePdfViewer(candidate.page);
          if (candidate.page > app.pdfDocument.numPages) {
            highlight = { found: false, reason: 'The backend page number exceeds the physical PDF page count.' };
            diag('evidence-attempt', { page: candidate.page, found: false, reason: highlight.reason });
            continue;
          }
          if (!pdfIndexBuilds.has(app.pdfDocument)) {
            $('status').textContent = 'Reading PDF pages and building a local search index…';
          }
          await buildPdfIndex(app);
          const candidatePageText = await getPageSearchText(app, candidate.page);
          const evidenceCheck = verifyFinancialRowEvidence(candidatePageText, candidate.text, candidate.quote);
          if (!evidenceCheck.valid) {
            highlight = { found: false, reason: evidenceCheck.reason || 'The evidence could not be verified against the candidate page.', stage: 'evidence-verification-failed' };
            diag('evidence-verification-failed', { page: candidate.page, reason: evidenceCheck.reason, missing: evidenceCheck.missing || [] });
            continue;
          }
          highlight = await findAndHighlightPassage(app, candidate.text, candidate.page, candidate.quote);
        } catch (attemptError) {
          highlight = { found: false, query: highlight?.query || '', reason: attemptError?.message || String(attemptError), stage: 'viewer-or-search-exception' };
        }
        diag('evidence-attempt', { page: candidate.page, found: highlight.found, query: highlight.query || '', reason: highlight.reason || null });
        if (highlight.found) break;
      }
      const { page } = selected;
      if (!highlight.found) {
        // Failed navigation/highlighting is not a completed Snip; preserve the
        // user's allowance and tell them honestly that the passage was not found.
        if (app?.pdfViewer && Number.isInteger(page) && page >= 1) app.pdfViewer.currentPageNumber = page;
        $('status').textContent = highlight.stage === 'viewer-or-search-exception'
          ? `Snip could not open or search this PDF: ${highlight.reason} Your search was not charged.`
          : highlight.stage === 'evidence-verification-failed'
            ? `Snip couldn't verify the reported evidence against the PDF text. It won't claim a match. Your search was not charged; try a more specific question.`
            : `Snip found possible evidence on page ${page}, but could not confirm a visible highlight. Your search was not charged; try rephrasing the question.`;
        diag('search-finished', { selectedPage: page, pageCount: data.pageCount, highlightFound: false, highlightQuery: highlight.query, highlightReason: highlight.reason || null });
        if (reservationId) await send({type:'SNIP_USAGE_RELEASE', reservationId});
        return;
      }
      const consumed=await send({type:'SNIP_USAGE_COMMIT', reservationId});
      if(!consumed?.ok||consumed.consumed===false){$('status').textContent='Your Snip limit was reached.';$('upgrade').hidden=false;return;}
      $('usage').textContent=usageText(consumed);
      await savePdfHighlight(app, selected.text, highlight.matchedPage || page, selected.quote || highlight.query);
      $('status').textContent = `Opened page ${highlight.matchedPage || page} and highlighted the matching passage.`;
      diag('search-finished', { selectedPage: highlight.matchedPage || page, pageCount: data.pageCount, highlightFound: true, highlightQuery: highlight.query, highlightReason: null });
    } catch(e){if(reservationId) await send({type:'SNIP_USAGE_RELEASE', reservationId}).catch(()=>{});diag('search-error', { message: e?.message || String(e) });$('status').textContent=e?.message||'Snip could not search this PDF.';}
    finally { searchInProgress = false; $('find').disabled=false; }
  }
  $('brief').onclick=createExecutiveBrief;
  $('find').onclick=search;$('question').addEventListener('keydown',e=>{if(e.key==='Enter')search();if(e.key==='Escape')window.close()});$('close').onclick=()=>window.close();
  $('login').onclick=()=>openAuth('login');$('signup').onclick=()=>openAuth('signup');$('auth-submit').onclick=submitAuth;$('auth-cancel').onclick=()=>{$('auth').hidden=true};$('logout').onclick=async()=>{const r=await send({type:'SNIP_AUTH_LOGOUT'});await refresh();$('status').textContent=r?.ok?'Logged out.':'Logged out locally; remote sign-out could not be confirmed.'};
  $('pricing').onclick=async()=>{await refresh();$('upgrade').hidden=false;};
  $('upgrade-close').onclick=()=>{$('upgrade').hidden=true;};
  $('free').onclick=async()=>{
    const r=await send({type:'SNIP_SELECT_FREE_PLAN'});
    if(!r?.ok){$('status').textContent=r?.error||'Could not select the Free plan.';return;}
    $('upgrade').hidden=true;
    await refresh();
    $('status').textContent='Free plan selected · 10 searches per day. No payment required.';
  };
  let paymentCheckInProgress = false;
  async function createExecutiveBrief() {
    const button = $("brief"), panel = $("brief-panel"), output = $("brief-output");
    if (!pdfUrl || !button || button.disabled) return;
    button.disabled = true;
    button.textContent = "Preparing…";
    $("status").textContent = "Reading the PDF and preparing its Executive Brief…";
    let reservationId = null;
    try {
      const reservation = await send({ type: "SNIP_USAGE_RESERVE" });
      if (!reservation?.ok || !reservation.reservation_id)
        throw new Error(reservation?.error || "Sign in to reserve a Snip search.");
      reservationId = reservation.reservation_id;
      const result = await send({ type: "SNIP_BACKEND_PDF_SUMMARY", url: pdfUrl, reservationId });
      if (!result?.ok || !result.data?.brief)
        throw new Error(result?.error || "Could not create the Executive Brief.");
      const data = result.data;
      const consumed = await send({ type: "SNIP_USAGE_COMMIT", reservationId });
      if (!consumed?.ok) throw new Error(consumed?.error || "Could not confirm usage.");
      $("usage").textContent = usageText(consumed);
      output.textContent = data.brief;
      panel.hidden = false;
      $("status").textContent = `Executive Brief ready · ${data.pagesUsed || data.pageCount || 0} pages analyzed.`;
      button.textContent = "Refresh Executive Brief";
    } catch (error) {
      if (reservationId) await send({ type: "SNIP_USAGE_RELEASE", reservationId }).catch(() => {});
      $("status").textContent = error?.message || "Could not create the Executive Brief.";
    } finally {
      button.disabled = false;
    }
  }

  async function choosePaidPlan(plan) {
    if (paymentCheckInProgress) return;
    paymentCheckInProgress = true;
    const buttons = [$('pro'), $('unlimited')];
    buttons.forEach(button => { if (button) button.disabled = true; });
    $('status').textContent = 'Opening secure checkout…';
    try {
      const opened = await send({ type: 'SNIP_OPEN_PAYMENT', plan });
      if (!opened?.ok) throw new Error(opened?.error || 'Could not open checkout. Please try again.');
      $('status').textContent = 'Complete checkout in the ExtensionPay tab. Snip will update your plan automatically when payment is confirmed.';
      // Keep checking the provider's authoritative entitlement while this Snip
      // window remains open; no manual refresh is needed after checkout.
      const started = Date.now();
      while (Date.now() - started < 120000) {
        await delay(2000);
        const usage = await send({ type: 'SNIP_GET_USAGE' });
        if (usage?.ok && usage.plan === plan) {
          await refresh();
          $('upgrade').hidden = true;
          $('status').textContent = `Payment confirmed · ${usage.plan === 'unlimited' ? 'Unlimited' : 'Pro'} plan is active.`;
          return;
        }
      }
      $('status').textContent = 'Checkout opened. Your plan will update when ExtensionPay confirms payment; if you have already paid, wait a moment and reopen Snip to check again.';
    } catch (error) {
      $('status').textContent = error?.message || 'Could not open checkout. Please try again.';
    } finally {
      paymentCheckInProgress = false;
      buttons.forEach(button => { if (button) button.disabled = false; });
    }
  }
  $('pro').onclick=()=>choosePaidPlan('pro');
  $('unlimited').onclick=()=>choosePaidPlan('unlimited');
  $('manage').onclick=async()=>{
    $('status').textContent='Opening ExtensionPay subscription management…';
    const result=await send({type:'SNIP_MANAGE_PAYMENT'});
    if(!result?.ok) $('status').textContent=result?.error||'Could not open subscription management. Please try again.';
  };
  $('password')?.addEventListener('keydown',e=>{if(e.key==='Enter')submitAuth()});
  if(!pdfUrl){ $('status').textContent='No PDF was provided.'; }
  else {
    try{$('pdf-title').textContent=decodeURIComponent(new URL(pdfUrl).pathname.split('/').pop()||'PDF')}catch{$('pdf-title').textContent='PDF'}
    if($('pdf-viewer')) startViewerLoad(false).then(() => restoreSavedHighlight()).catch(() => {});
  }
  refresh();
  // Keep entitlement and the visible plan cards synchronized without reopening the PDF window.
  setInterval(() => { if (!paymentCheckInProgress) refresh(); }, 8000);
})();
