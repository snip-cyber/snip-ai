import { verifyUsageReservation } from "./usage-auth.js";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns";
import { Agent } from "undici";
import findHandler from "./find.js";
import {
  extractFinancialRows,
  extractFinancialRowsFromItems,
  extractPageLines,
  isCashPositionLookup,
  selectPrimaryFinancialEvidence
} from "./pdf-search-utils.js";

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 25000;
const configuredTimeout = Number(process.env.SNIP_PDF_TIMEOUT_MS);
const TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout >= 10
  ? Math.min(configuredTimeout, DEFAULT_TIMEOUT_MS)
  : DEFAULT_TIMEOUT_MS;

export function unsafeUrl(raw) {
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return true;
    
    // Correctly strip surrounding brackets from IPv6 hostnames
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!h || h === "localhost" || h.endsWith(".localhost") ||
        h.endsWith(".local") || h === "metadata.google.internal") return true;

    const version = isIP(h);
    if (version === 4) {
      const parts = h.split(".").map(n => Number.parseInt(n, 10));
      if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
      const [a, b, c, d] = parts;
      return a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 192 && b === 0 && c === 0) ||
        (a === 192 && b === 0 && c === 2) || // TEST-NET-1
        (a === 192 && b === 88 && c === 99) ||
        (a === 198 && (b === 18 || b === 19)) || // Benchmarking
        (a === 198 && b === 51 && c === 100) || // TEST-NET-2
        (a === 203 && b === 0 && c === 113);   // TEST-NET-3
    }
    if (version === 6) {
      const ip = h.toLowerCase();
      if (ip === "::" || ip === "::1" || ip.startsWith("::ffff:")) return true;
      const firstHextet = Number.parseInt(ip.split(":")[0] || "0", 16);
      if (!Number.isInteger(firstHextet) || firstHextet < 0x2000 || firstHextet > 0x3fff) return true;
      const hextets = ip.split(":").filter(Boolean);
      const secondHextet = hextets.length > 1 ? Number.parseInt(hextets[1], 16) : 0;
      if ((firstHextet === 0x2001 && secondHextet <= 0x01ff) ||
          /^2001:db8:/i.test(ip) || /^2002:/i.test(ip)) return true;
      return false;
    }
    return false;
  } catch {
    return true;
  }
}

export function createPublicDnsLookup(resolve = dnsLookup) {
  return function publicDnsLookup(hostname, options, callback) {
    resolve(hostname, {
      family: options?.family || 0,
      hints: options?.hints || 0,
      all: true,
      verbatim: true
    }, (error, addresses) => {
      if (error) return callback(error);
      if (!Array.isArray(addresses) || addresses.length === 0) {
        return callback(new Error("The PDF host did not resolve to a public address."));
      }
      const hasUnsafeAddress = addresses.some(({ address }) => {
        const host = String(address || "");
        const urlHost = host.includes(":") ? `[${host}]` : host;
        return unsafeUrl(`http://${urlHost}/`);
      });
      if (hasUnsafeAddress) {
        return callback(new Error("The PDF host resolves to a non-public network address."));
      }
      if (options?.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

export const publicDnsLookup = createPublicDnsLookup();

function errorStatus(error, fallback = 500) {
  return Number.isInteger(error?.statusCode) ? error.statusCode : fallback;
}

export async function readLimited(response, controller) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_PDF_BYTES) {
    controller.abort();
    const e = new Error("This PDF is too large for Snip right now (15 MB maximum).");
    e.statusCode = 413;
    throw e;
  }
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_PDF_BYTES) {
      const e = new Error("This PDF is too large for Snip right now (15 MB maximum).");
      e.statusCode = 413;
      throw e;
    }
    return bytes;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const b = Buffer.from(chunk);
    total += b.length;
    if (total > MAX_PDF_BYTES) {
      controller.abort();
      const e = new Error("This PDF is too large for Snip right now (15 MB maximum).");
      e.statusCode = 413;
      throw e;
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks, total);
}

function withAbort(promise, signal) {
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => {
      const error = new Error("Searching this PDF took too long. Try a smaller file or a direct PDF link.");
      error.statusCode = 504;
      reject(error);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });

  return Promise.race([promise, aborted]).finally(() => {
    signal.removeEventListener("abort", onAbort);
  });
}

function toBlocks(text, page) {
  const clean = String(text || "").replace(/\u00ad/g, "").replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];
  const parts = clean.split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z0-9])/g)
    .map(s => s.trim()).filter(s => s.length >= 15);
  const result = [];
  let buffer = "";
  for (const part of parts) {
    if (!buffer) buffer = part;
    else if ((buffer + " " + part).length <= 1800) buffer += " " + part;
    else {
      result.push(buffer);
      buffer = part;
    }
  }
  if (buffer) result.push(buffer);
  return result.map(text => ({ text, page }));
}

export async function extractScannedPdfPages(bytes, signal) {
  const apiKey = String(process.env.SNIP_OCR_SPACE_API_KEY || "").trim();
  if (!apiKey) return null;

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), "snip-document.pdf");
  form.append("filetype", "PDF");
  form.append("isOverlayRequired", "false");
  form.append("detectOrientation", "true");
  form.append("scale", "true");
  form.append("OCREngine", "2");

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey: apiKey },
    body: form,
    signal
  });
  if (!response.ok) {
    const error = new Error("The configured OCR service returned HTTP " + response.status + ".");
    error.statusCode = 502;
    throw error;
  }

  const result = await response.json();
  if (result?.IsErroredOnProcessing) {
    const details = Array.isArray(result.ErrorMessage)
      ? result.ErrorMessage.join("; ")
      : String(result.ErrorMessage || "OCR processing failed.");
    const error = new Error("Could not read this scanned PDF: " + details);
    error.statusCode = 422;
    throw error;
  }

  const pages = Array.isArray(result?.ParsedResults) ? result.ParsedResults : [];
  return pages.map((page, index) => ({
    page: index + 1,
    text: String(page?.ParsedText || "").trim()
  }));
}

function captureResponse() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    }
  };
}

function isExplicitPrimaryStatementCashQuestion(question) {
  return (
    isCashPositionLookup(question) &&
    /\b(?:statement of financial position|balance sheet|primary statement)\b/i.test(
      String(question || "")
    )
  );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const question = String(req.body?.question || "").trim();
  const url = String(req.body?.url || "").trim();
  if (!question) return res.status(400).json({ error: "Question is required." });
  if (!url || unsafeUrl(url)) return res.status(400).json({ error: "A public PDF URL is required." });

  const controller = new AbortController();
  const dispatcher = new Agent({ connect: { lookup: publicDnsLookup } });
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const reservation = await verifyUsageReservation(req);
    if (!reservation.ok) return res.status(reservation.status).json({ error: reservation.error });


    let requestUrl = url;
    let response;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      if (unsafeUrl(requestUrl)) {
        const error = new Error("The PDF URL redirected to an unsupported address.");
        error.statusCode = 400;
        throw error;
      }
      response = await fetch(requestUrl, {
        redirect: "manual",
        dispatcher,
        signal: controller.signal,
        headers: { Accept: "application/pdf,*/*;q=0.8", "User-Agent": "Snip PDF reader" }
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location || redirects === 3) {
        const error = new Error("The PDF URL has too many redirects or an invalid redirect.");
        error.statusCode = 502;
        throw error;
      }
      requestUrl = new URL(location, requestUrl).toString();
    }
    if (!response?.ok) {
      const error = new Error(`Could not download the PDF (${response?.status || "unknown"}).`);
      error.statusCode = 502;
      throw error;
    }
    const bytes = await readLimited(response, controller);

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("pdf") && !bytes.subarray(0, 5).toString().startsWith("%PDF-")) {
      return res.status(415).json({ error: "The URL did not return a PDF." });
    }

    let renderedPageNumber = 0;
    const pageLayouts = new Map();
    const parsePromise = pdfParse(bytes, {
      pagerender: async pageData => {
        renderedPageNumber += 1;
        const content = await pageData.getTextContent();
        pageLayouts.set(renderedPageNumber, content.items);
        const lines = extractPageLines(content.items);
        return `\n[[SNIP_PAGE_${renderedPageNumber}]]\n${lines.join("\n")}\n`;
      }
    });
    const parsed = await withAbort(parsePromise, controller.signal);
    const split = String(parsed.text || "").split(/\[\[SNIP_PAGE_(\d+)\]\]/g);
    const blocks = [];
    const financialRows = [];
    const pagesWithoutText = [];
    let index = 0;
    let pageCount = Number(parsed.numpages || 0);
    for (let i = 1; i < split.length; i += 2) {
      const page = Number(split[i]);
      const pageText = split[i + 1] || "";
      pageCount = Math.max(pageCount, page);
      const pageItems = pageLayouts.get(page);
      const extractedRows = pageItems
        ? extractFinancialRowsFromItems(pageItems, page, financialRows.length)
        : extractFinancialRows(pageText, page, financialRows.length);
      financialRows.push(...extractedRows);
      const pageBlocks = toBlocks(pageText, page);
      if (!pageBlocks.length) pagesWithoutText.push(page);
      for (const item of pageBlocks) {
        blocks.push({ id: `pdf-${page}-${index}`, index: index++, text: item.text, section: `PDF page ${page}`, page });
      }
    }
    if (pagesWithoutText.length && process.env.SNIP_OCR_SPACE_API_KEY) {
      try {
        const ocrPages = await withAbort(extractScannedPdfPages(bytes, controller.signal), controller.signal);
        if (ocrPages) {
          pageCount = Math.max(pageCount, ocrPages.length);
          const missing = new Set(pagesWithoutText);
          for (const { page, text } of ocrPages) {
            if (!missing.has(page)) continue;
            for (const item of toBlocks(text, page)) {
              blocks.push({
                id: `pdf-${page}-${index}`,
                index: index++,
                text: item.text,
                section: `PDF page ${page}`,
                page
              });
            }
          }
        }
      } catch (error) {
        if (!blocks.length) throw error;
        console.error("Optional OCR failed for some PDF pages:", error?.message || error);
      }
    }
    if (!blocks.length) {
      const message = process.env.SNIP_OCR_SPACE_API_KEY
        ? "This PDF has no readable text. The configured OCR service could not extract any text."
        : "This PDF has no readable text. To enable scanned-PDF OCR, configure SNIP_OCR_SPACE_API_KEY. Scanned documents are sent to OCR.space only when this setting is enabled.";
      return res.status(422).json({ error: message });
    }

    const financial = selectPrimaryFinancialEvidence(question, financialRows);
    if (financial) {
      const { row } = financial;
      const evidence = {
        block_index: row.index,
        block_id: row.id,
        passage: row.text,
        text: row.text,
        quote: financial.sourceQuote,
        section: row.section,
        page: row.page,
        period: financial.period,
        context: row.periodContext,
        answer: financial.answer
      };
      return res.status(200).json({
        answer: financial.answer,
        period: financial.period,
        sourceQuote: financial.sourceQuote,
        evidence: [evidence],
        pageCount
      });
    }

    if (isExplicitPrimaryStatementCashQuestion(question)) {
      return res.status(200).json({
        answer: null,
        evidence: [],
        pageCount
      });
    }

    const terms = [...new Set((question.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []))];
    const ranked = blocks.map((b, i) => {
      const lower = b.text.toLowerCase();
      const score = terms.reduce((n, term) => n + (lower.includes(term) ? 1 : 0), 0);
      return { b, i, score };
    }).sort((a, b) => b.score - a.score || a.i - b.i);
    const chosen = new Map();
    for (const item of ranked.slice(0, 50)) {
      for (const neighbor of [blocks[item.i - 1], item.b, blocks[item.i + 1]]) {
        if (neighbor) chosen.set(neighbor.id, neighbor);
      }
    }
    const payloadBlocks = [...chosen.values()].slice(0, 70);
    const analysisResponse = captureResponse();
    const analysisPromise = findHandler({
      method: "POST",
      body: { question, blocks: payloadBlocks },
      headers: {}
    }, analysisResponse);
    await withAbort(analysisPromise, controller.signal);
    const result = analysisResponse.body || {};
    if (analysisResponse.statusCode < 200 || analysisResponse.statusCode >= 300) {
      return res.status(502).json({ error: result.error || "Snip could not analyze this PDF." });
    }

    // Updated evidence mapping logic
    const evidence = (Array.isArray(result.evidence) ? result.evidence : []).map(item => {
      const payloadIdx = item.block_index != null ? Number(item.block_index) : -1;
      const block = (payloadIdx >= 0 && payloadIdx < payloadBlocks.length ? payloadBlocks[payloadIdx] : null)
        || blocks.find(b => b.id === item.block_id);

      if (!block) return null;
      return { 
        ...item, 
        block_id: block.id, 
        block_index: block.index, 
        page: block.page, 
        text: String(item.text || item.passage || block.text || "").trim() 
      };
    }).filter(item => item?.text && Number.isInteger(item.page) && item.page >= 1);

    return res.status(200).json({ evidence: evidence.slice(0, 3), pageCount });
  } catch (error) {
    console.error("Snip PDF search error:", error);
    const status = controller.signal.aborted ? 504 : errorStatus(error);
    const message = controller.signal.aborted && status === 504
      ? "Searching this PDF took too long. Try a smaller file or a direct PDF link."
      : error?.message || "Could not search this PDF.";
    return res.status(status).json({ error: message });
  } finally {
    clearTimeout(timer);
    await dispatcher.close();
  }
}