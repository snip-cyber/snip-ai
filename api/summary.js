import { verifyUsageReservation } from "./usage-auth.js";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { Agent } from "undici";
import {
  unsafeUrl,
  publicDnsLookup,
  readLimited,
  extractScannedPdfPages
} from "./pdf-find.js";

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 25000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Snip-ExtensionPay-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const url = String(req.body?.url || "").trim();
  if (!url || unsafeUrl(url)) {
    return res.status(400).json({ error: "A public PDF URL is required." });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "Executive Brief is temporarily unavailable." });
  }

  const controller = new AbortController();
  const dispatcher = new Agent({ connect: { lookup: publicDnsLookup } });
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const reservation = await verifyUsageReservation(req);
    if (!reservation.ok) return res.status(reservation.status).json({ error: reservation.error });
    let requestUrl = url;
    let response;

    for (let redirects = 0; redirects <= 3; redirects++) {
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

    let renderedPage = 0;
    const parsed = await pdfParse(bytes, {
      pagerender: async pageData => {
        renderedPage++;
        const content = await pageData.getTextContent();
        const lines = [];
        let line = "";
        for (const item of content.items || []) {
          const value = String(item.str || "").trim();
          if (value) line += (line ? " " : "") + value;
          if (item.hasEOL && line) {
            lines.push(line);
            line = "";
          }
        }
        if (line) lines.push(line);
        return `\n[[SNIP_PAGE_${renderedPage}]]\n${lines.join("\n")}\n`;
      }
    });

    const pages = [];
    const split = String(parsed.text || "").split(/\[\[SNIP_PAGE_(\d+)\]\]/g);
    for (let i = 1; i < split.length; i += 2) {
      const page = Number(split[i]);
      const text = String(split[i + 1] || "").trim();
      if (text) pages.push({ page, text });
    }

    const pageCount = Number(parsed.numpages || pages.length);
    const missing = new Set();
    for (let page = 1; page <= pageCount; page++) {
      if (!pages.some(item => item.page === page)) missing.add(page);
    }

    if (missing.size && process.env.SNIP_OCR_SPACE_API_KEY) {
      try {
        const ocrPages = await extractScannedPdfPages(bytes, controller.signal);
        for (const item of ocrPages || []) {
          if (missing.has(item.page) && item.text) pages.push(item);
        }
      } catch (error) {
        console.error("Executive Brief optional OCR failed:", error?.message || error);
      }
    }

    pages.sort((a, b) => a.page - b.page);
    const sourceText = pages
      .map(item => `[PDF page ${item.page}]\n${item.text}`)
      .join("\n\n")
      .slice(0, 48000);

    if (!sourceText.trim()) {
      return res.status(422).json({
        error: "This PDF contains no readable text. Scanned-PDF OCR requires SNIP_OCR_SPACE_API_KEY."
      });
    }

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 1800,
        messages: [
          {
            role: "system",
            content: [
              "You are Snip, producing a precise executive brief from a source PDF.",
              "Use only facts supported by the supplied PDF text. Never invent facts, figures, conclusions, or page references.",
              "Clearly distinguish source facts from interpretation. If information is absent or unclear, say so.",
              "Use Markdown with these headings: Executive summary, Key findings, Important figures, Risks and caveats, Bottom line.",
              "Cite every material finding and figure with its physical PDF page, e.g. (PDF p. 12).",
              "Omit a heading if the source provides no meaningful information for it.",
              "Keep the brief concise, useful, and faithful to the source."
            ].join(" ")
          },
          {
            role: "user",
            content: `Prepare an executive brief for this PDF.\n\nSOURCE TEXT:\n${sourceText}`
          }
        ]
      }),
      signal: controller.signal
    });

    if (!aiResponse.ok) {
      const error = new Error("The summary service could not process this PDF.");
      error.statusCode = aiResponse.status === 429 ? 503 : 502;
      throw error;
    }

    const payload = await aiResponse.json();
    const brief = String(payload.choices?.[0]?.message?.content || "").trim();
    if (!brief) throw new Error("The summary service returned an empty brief.");

    return res.status(200).json({ brief, pageCount, pagesUsed: pages.length });
  } catch (error) {
    console.error("Snip Executive Brief error:", error?.message || error);
    const status = controller.signal.aborted ? 504 : (error.statusCode || 500);
    return res.status(status).json({
      error: controller.signal.aborted
        ? "Creating the Executive Brief took too long. Try a smaller PDF."
        : error.message || "Could not create the Executive Brief."
    });
  } finally {
    clearTimeout(timer);
    await dispatcher.close();
  }
}
