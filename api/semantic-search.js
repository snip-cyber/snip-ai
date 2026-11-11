const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = "text-embedding-3-small";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const question = String(req.body?.question || "").trim();
    const blocks = Array.isArray(req.body?.blocks) ? req.body.blocks : [];

    if (!question || question.length > 1000) {
      return res.status(400).json({ error: "A valid question is required" });
    }

    if (!blocks.length || blocks.length > 120) {
      return res.status(400).json({ error: "Supply between 1 and 120 blocks" });
    }

    const sentences = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const text = String(block?.text || "").replace(/\s+/g, " ").trim();
      if (text.length < 15) continue;

      const parts = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(])/);
      for (const part of parts) {
        const passage = part.trim();
        if (passage.length < 15) continue;

        sentences.push({
          block_index: Number.isFinite(Number(block?.index)) ? Number(block.index) : i,
          block_id: String(block?.id || `block-${i}`),
          passage,
          section: String(block?.section || "Page"),
          page: Number.isFinite(Number(block?.page)) && Number(block.page) >= 1
            ? Number(block.page)
            : null
        });

        if (sentences.length >= 300) break;
      }
      if (sentences.length >= 300) break;
    }

    if (!sentences.length) {
      return res.status(200).json({ evidence: [] });
    }

    const inputs = [
      question,
      ...sentences.map(item => item.passage.slice(0, 1200))
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    let response;
    try {
      response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          input: inputs,
          encoding_format: "float"
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const detail = await response.text();
      console.error("Semantic embedding request failed:", response.status, detail.slice(0, 500));
      return res.status(502).json({ error: "Semantic search is temporarily unavailable" });
    }

    const payload = await response.json();
    const vectors = (payload.data || [])
      .sort((a, b) => a.index - b.index)
      .map(item => item.embedding);

    if (vectors.length !== inputs.length || !vectors[0]) {
      return res.status(502).json({ error: "Invalid embedding response" });
    }

    const queryVector = vectors[0];
    const magnitude = Math.sqrt(queryVector.reduce((sum, value) => sum + value * value, 0));

    const evidence = sentences.map((item, index) => {
      const vector = vectors[index + 1];
      if (!vector || vector.length !== queryVector.length) return null;

      const dot = vector.reduce((sum, value, i) => sum + value * queryVector[i], 0);
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
      const score = magnitude && norm ? dot / (magnitude * norm) : 0;

      return { ...item, score };
    })
      .filter(item => item && Number.isFinite(item.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    return res.status(200).json({ evidence });
  } catch (error) {
    console.error("SNIP SEMANTIC SEARCH ERROR:", error?.message || error);
    return res.status(500).json({
      error: error?.name === "AbortError"
        ? "Semantic search timed out"
        : "Semantic search failed"
    });
  }
}
