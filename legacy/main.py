import json
import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import openai
import requests

app = FastAPI()

# Enable CORS for Chrome Extension requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

openai.api_key = os.getenv("OPENAI_API_KEY")


# Helper: OCR.space Fallback
def extract_scanned_pdf_ocr(pdf_bytes: bytes) -> list[dict]:
    """Sends scanned PDF bytes to OCR.space and returns structured text pages."""
    api_key = os.getenv("SNIP_OCR_SPACE_API_KEY", "").strip()
    if not api_key:
        return []

    try:
        response = requests.post(
            "https://api.ocr.space/parse/image",
            headers={"apikey": api_key},
            files={"file": ("snip-document.pdf", pdf_bytes, "application/pdf")},
            data={
                "filetype": "PDF",
                "isOverlayRequired": "false",
                "detectOrientation": "true",
                "scale": "true",
                "OCREngine": "2",
            },
            timeout=25,
        )

        if not response.ok:
            raise Exception(f"OCR service returned HTTP {response.status_code}")

        result = response.json()
        if result.get("IsErroredOnProcessing"):
            error_msg = result.get("ErrorMessage", ["OCR processing failed"])
            raise Exception(f"OCR processing error: {error_msg}")

        pages = result.get("ParsedResults", [])
        ocr_pages = []
        for index, page in enumerate(pages):
            text = str(page.get("ParsedText", "")).strip()
            if text:
                ocr_pages.append({"page": index + 1, "text": text})

        return ocr_pages
    except Exception as err:
        print(f"OCR processing error: {err}")
        return []


# Route 1: Web & Standard Block Search
@app.post("/api/find")
async def find_evidence(request: Request):
    data = await request.json()
    question = data.get("question", "").strip()
    blocks = data.get("blocks", [])

    if not question:
        raise HTTPException(
            status_code=400, detail="Please enter a valid question."
        )

    return {
        "ok": True,
        "question": question,
        "blocks": blocks,
    }


# Route 2: PDF Search & OCR Fallback
@app.post("/api/pdf-find")
async def pdf_find(request: Request):
    body = await request.json()
    bytes_data = body.get("bytes")
    question = body.get("question", "").strip()

    api_key = os.getenv("SNIP_OCR_SPACE_API_KEY", "").strip()
    blocks = []

    if not blocks:
        if api_key and bytes_data:
            ocr_pages = extract_scanned_pdf_ocr(bytes_data)
            for p in ocr_pages:
                blocks.append(
                    {
                        "id": f"pdf-{p['page']}",
                        "text": p["text"],
                        "section": f"PDF page {p['page']}",
                        "page": p["page"],
                    }
                )

    if not blocks:
        message = (
            "This PDF has no readable text. The configured OCR service could not extract any text."
            if api_key
            else "This PDF has no readable text. To enable scanned-PDF OCR, configure SNIP_OCR_SPACE_API_KEY."
        )
        return {"error": message}, 422

    return {"ok": True, "blocks": blocks}


# Route 3: Executive Brief TL;DR Summary
@app.post("/api/summary")
async def generate_summary(request: Request):
    """Generates a 3-bullet TL;DR executive summary and 3 suggested follow-up queries."""
    data = await request.json()
    blocks = data.get("blocks", [])
    title = data.get("title", "Document")

    if not blocks:
        raise HTTPException(
            status_code=400, detail="No document content provided."
        )

    context_text = "\n\n".join([b.get("text", "") for b in blocks[:10]])

    prompt = f"""You are an executive research assistant. Analyze the opening section of this document ("{title}"):

---
{context_text[:4000]}
---

Return a valid JSON object with the following exact keys:
1. "summary": An array of exactly 3 concise, high-impact bullet points summarizing the key takeaways.
2. "suggested_queries": An array of exactly 3 relevant follow-up questions a researcher should ask about this document.
"""

    try:
        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.3,
        )

        result = json.loads(response.choices[0].message.content)
        return {
            "ok": True,
            "title": title,
            "summary": result.get("summary", []),
            "suggested_queries": result.get("suggested_queries", []),
        }
    except Exception as e:
        return {
            "ok": True,
            "title": title,
            "summary": [
                "Document loaded successfully into Snip.",
                "Initial structural blocks indexed for semantic search.",
                "Use the search bar below to ask targeted questions.",
            ],
            "suggested_queries": [
                "What is the main conclusion of this report?",
                "What key financial or technical metrics are mentioned?",
                "What risks or limitations are outlined?",
            ],
        }