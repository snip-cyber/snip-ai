import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

process.env.SUPABASE_URL ||= "https:" + "/" + "/test.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service";

const TEST_RESERVATION = "11111111-1111-4111-8111-111111111111";
const TEST_USER = "22222222-2222-4222-8222-222222222222";
function mockSupabase(url) {
  if (String(url).endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: TEST_USER }), { status: 200 });
  if (String(url).includes("/rest/v1/snip_usage_reservations?")) return new Response(JSON.stringify([{ id: TEST_RESERVATION }]), { status: 200 });
  return null;
}

const { default: pdfFindHandler, publicDnsLookup, createPublicDnsLookup, extractScannedPdfPages } = await import("../api/pdf-find.js");

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
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

const msExpected = {
  answer: process.env.SNIP_MS_EXPECTED_ANSWER,
  period: process.env.SNIP_MS_EXPECTED_PERIOD,
  quote: process.env.SNIP_MS_EXPECTED_QUOTE,
  page: Number(process.env.SNIP_MS_EXPECTED_PAGE),
  pageCount: Number(process.env.SNIP_MS_EXPECTED_PAGE_COUNT)
};
const msFixtureConfigured = Boolean(
  process.env.SNIP_MS_PDF_PATH &&
  msExpected.answer &&
  msExpected.period &&
  msExpected.quote &&
  Number.isInteger(msExpected.page) && msExpected.page > 0 &&
  Number.isInteger(msExpected.pageCount) && msExpected.pageCount > 0
);

test("PDF endpoint answers the M&S FY2025 cash question from the primary statement", {
  // A real PDF must be supplied with its verified expected values. Avoid stale
  // page/value assertions that could accidentally validate a different report edition.
  skip: !msFixtureConfigured
}, async () => {
  const pdfBytes = fs.readFileSync(process.env.SNIP_MS_PDF_PATH);
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(pdfBytes, {
      status: 200,
      headers: { "content-type": "application/pdf" }
    });
  };

  try {
    const response = createResponse();
    await pdfFindHandler({
      method: "POST",
      body: {
        url: "https://reports.example.test/ms-fy2025.pdf",
        reservation_id: TEST_RESERVATION,
        question: "What were cash and cash equivalents for FY2025 in the consolidated statement of financial position?"
      },
      headers: { authorization: "Bearer test-token" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.answer, msExpected.answer);
    assert.equal(response.body.period, msExpected.period);
    assert.equal(response.body.sourceQuote, msExpected.quote);
    assert.equal(response.body.evidence[0].section, "Primary consolidated statement of financial position");
    assert.equal(response.body.evidence[0].page, msExpected.page);
    assert.equal(response.body.evidence[0].quote, response.body.sourceQuote);
    assert.equal(response.body.pageCount, msExpected.pageCount);

    const absentPeriod = createResponse();
    await pdfFindHandler({
      method: "POST",
      body: {
        url: "https://reports.example.test/ms-fy2025.pdf",
        reservation_id: TEST_RESERVATION,
        question: "What were cash and cash equivalents in the FY2026 consolidated statement of financial position?"
      },
      headers: { authorization: "Bearer test-token" }
    }, absentPeriod);

    assert.equal(absentPeriod.statusCode, 200);
    assert.equal(absentPeriod.body.answer, null);
    assert.deepEqual(absentPeriod.body.evidence, []);
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("PDF preflight advertises cross-origin POST support without fetching a PDF", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Preflight must not fetch a document");
  };

  try {
    const response = createResponse();
    await pdfFindHandler({ method: "OPTIONS", headers: { authorization: "Bearer test-token" } }, response);

    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["Access-Control-Allow-Origin"], "*");
    assert.equal(response.headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
    assert.equal(response.headers["Access-Control-Max-Age"], "86400");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects private and special-use IPv4/IPv6 targets and credential-bearing URLs before fetching", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => { fetchCount += 1; throw new Error("Unsafe URL must not be fetched"); };
  try {
    for (const url of [
      "http://[fc00::1]/secret.pdf",
      "http://[fe80::1]/secret.pdf",
      "http://[::ffff:172.16.0.1]/secret.pdf",
      "http://[2001:2::1]/benchmark.pdf",
      "http://[2001:db8::1]/documentation.pdf",
      "http://[2002:7f00:1::]/6to4.pdf",
      "http://127.0.0.1/private.pdf",
      "http://192.88.99.1/6to4-relay.pdf",
      "http://user:pass@example.com/report.pdf"
    ]) {
      const response = createResponse();
      await pdfFindHandler({ method: "POST", body: { url, reservation_id: TEST_RESERVATION, reservation_id: TEST_RESERVATION, question: "What is the answer?" }, headers: { authorization: "Bearer test-token" } }, response);
      assert.equal(response.statusCode, 400, url);
    }
    assert.equal(fetchCount, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("validates redirect targets before fetching them", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async url => {
    const auth = mockSupabase(url);
    if (auth) return auth;
    requested.push(String(url));
    return new Response(null, { status: 302, headers: { location: "http://[fc00::1]/internal.pdf" } });
  };
  try {
    const response = createResponse();
    await pdfFindHandler({ method: "POST", body: { url: "https://public.example/report.pdf", reservation_id: TEST_RESERVATION, question: "What is the answer?" }, headers: { authorization: "Bearer test-token" } }, response);
    assert.equal(response.statusCode, 400);
    assert.deepEqual(requested, ["https://public.example/report.pdf"]);
  } finally { globalThis.fetch = originalFetch; }
});


test("DNS lookup rejects hostnames resolving to loopback or private addresses", async () => {
  await new Promise(resolve => {
    publicDnsLookup("localhost", {}, error => {
      assert.ok(error, "localhost must not resolve as a permitted public PDF host");
      assert.match(error.message, /non-public network address/);
      resolve();
    });
  });
});


test("DNS guard rejects a public-looking hostname with any private DNS answer", async () => {
  const lookup = createPublicDnsLookup((_hostname, _options, callback) => {
    callback(null, [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 }
    ]);
  });
  await new Promise(resolve => {
    lookup("mixed-answer.example", {}, error => {
      assert.ok(error);
      assert.match(error.message, /non-public network address/);
      resolve();
    });
  });
});

test("DNS guard returns the same validated public addresses for connection pinning", async () => {
  const expected = [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 }
  ];
  const lookup = createPublicDnsLookup((_hostname, _options, callback) => callback(null, expected));
  await new Promise((resolve, reject) => {
    lookup("public.example", { all: true }, (error, addresses) => {
      if (error) return reject(error);
      assert.deepEqual(addresses, expected);
      resolve();
    });
  });
});


test("allows a globally routable IPv6 PDF URL through URL validation", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async url => {
    const auth = mockSupabase(url);
    if (auth) return auth;
    fetchCount += 1;
    return new Response("not a PDF", { status: 200, headers: { "content-type": "text/plain" } });
  };
  try {
    const response = createResponse();
    await pdfFindHandler({
      method: "POST",
      body: { url: "https://[2606:4700:4700::1111]/report.pdf", reservation_id: TEST_RESERVATION, question: "What is the answer?" },
      headers: { authorization: "Bearer test-token" }
    }, response);
    assert.equal(fetchCount, 1);
    assert.equal(response.statusCode, 415);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("OCR extraction preserves physical page slots, including pages with no recognized text", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.SNIP_OCR_SPACE_API_KEY;
  process.env.SNIP_OCR_SPACE_API_KEY = "test-ocr-key";
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({
      IsErroredOnProcessing: false,
      ParsedResults: [
        { ParsedText: "First scanned page text" },
        { ParsedText: "" },
        { ParsedText: "Third scanned page text" }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const pages = await extractScannedPdfPages(Buffer.from("%PDF-test"), new AbortController().signal);
    assert.equal(request.url, "https://api.ocr.space/parse/image");
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.headers.apikey, "test-ocr-key");
    assert.deepEqual(pages, [
      { page: 1, text: "First scanned page text" },
      { page: 2, text: "" },
      { page: 3, text: "Third scanned page text" }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SNIP_OCR_SPACE_API_KEY;
    else process.env.SNIP_OCR_SPACE_API_KEY = originalKey;
  }
});

test("OCR extraction is disabled without an explicit API key", async () => {
  const originalKey = process.env.SNIP_OCR_SPACE_API_KEY;
  const originalFetch = globalThis.fetch;
  delete process.env.SNIP_OCR_SPACE_API_KEY;
  globalThis.fetch = async () => { throw new Error("OCR must not run without opt-in"); };
  try {
    assert.equal(await extractScannedPdfPages(Buffer.from("%PDF-test"), new AbortController().signal), null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SNIP_OCR_SPACE_API_KEY;
    else process.env.SNIP_OCR_SPACE_API_KEY = originalKey;
  }
});

test("OCR extraction reports provider processing errors clearly", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.SNIP_OCR_SPACE_API_KEY;
  process.env.SNIP_OCR_SPACE_API_KEY = "test-ocr-key";
  globalThis.fetch = async () => new Response(JSON.stringify({
    IsErroredOnProcessing: true,
    ErrorMessage: ["Invalid PDF"]
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(
      extractScannedPdfPages(Buffer.from("%PDF-test"), new AbortController().signal),
      error => error.statusCode === 422 && /Invalid PDF/.test(error.message)
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SNIP_OCR_SPACE_API_KEY;
    else process.env.SNIP_OCR_SPACE_API_KEY = originalKey;
  }
});
