import assert from "node:assert/strict";
import test from "node:test";

process.env.OPENAI_API_KEY ||= "test-only";
process.env.SUPABASE_URL ||= "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service";
const { default: findHandler } = await import("../api/find.js");

function createResponse() {
  return {
    statusCode: 200,
    headers: { authorization: "Bearer test-token" },
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

const TEST_RESERVATION = "11111111-1111-4111-8111-111111111111";
const TEST_USER = "22222222-2222-4222-8222-222222222222";
function mockSupabase(url) {
  if (String(url).endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: TEST_USER }), { status: 200 });
  if (String(url).includes("/rest/v1/snip_usage_reservations?")) return new Response(JSON.stringify([{ id: TEST_RESERVATION }]), { status: 200 });
  return null;
}

test("shortened model quote is rejected rather than returned as evidence", async () => {
  const originalFetch = globalThis.fetch;
  const source = "Cash and cash equivalents 18 864.5 1,022.4";
  globalThis.fetch = async (url) => {
    const supabase = mockSupabase(url);
    if (supabase) return supabase;
    return new Response(JSON.stringify({
    output_text: JSON.stringify({
      evidence: [{ block_index: 0, passage: "Cash and cash equivalents 18 864.5" }]
    })
  }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const response = createResponse();
    await findHandler({
      method: "POST",
      body: {
        reservation_id: TEST_RESERVATION,
        question: "What were cash and cash equivalents for FY2025?",
        blocks: [{ index: 0, id: "source", text: source, section: "PDF page 126", page: 126 }]
      },
      headers: { authorization: "Bearer test-token" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.evidence, []);
    // A shortened quote is not accepted as locatable evidence.
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unrelated searches return no deterministic evidence", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const supabase = mockSupabase(url);
    if (supabase) return supabase;
    return new Response(JSON.stringify({
    output_text: JSON.stringify({ evidence: [] })
  }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const response = createResponse();
    await findHandler({
      method: "POST",
      body: {
        reservation_id: TEST_RESERVATION,
        question: "What is the meaning of the third instrument?",
        blocks: [{ index: 0, id: "unrelated", text: "The report describes its financial position at year end.", page: 4 }]
      },
      headers: { authorization: "Bearer test-token" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.evidence, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("candidate text budget preserves a highly relevant passage late in a long document", async () => {
  const originalFetch = globalThis.fetch;
  let submittedInput = "";
  globalThis.fetch = async (_url, options) => {
    const supabase = mockSupabase(_url);
    if (supabase) return supabase;
    const request = JSON.parse(options.body);
    submittedInput = JSON.stringify(request.input);
    return new Response(JSON.stringify({
      output_text: JSON.stringify({ evidence: [] })
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const filler = "ordinary corporate disclosure narrative ".repeat(42);
    const blocks = Array.from({ length: 40 }, (_, index) => ({
      index,
      id: `long-${index}`,
      text: filler,
      section: `PDF page ${index + 1}`,
      page: index + 1
    }));
    blocks[39] = {
      index: 39,
      id: "late-answer",
      text: "Cash and cash equivalents for FY2025 were £864.5m at 29 March 2025.",
      section: "PDF page 40",
      page: 40
    };

    const response = createResponse();
    await findHandler({
      method: "POST",
      body: {
        reservation_id: TEST_RESERVATION,
        question: "What were cash and cash equivalents for FY2025?",
        blocks
      },
      headers: { authorization: "Bearer test-token" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.match(submittedInput, /Cash and cash equivalents for FY2025 were £864\.5m/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an explicit section request never falls back to another section", async () => {
  const originalFetch = globalThis.fetch;
  let openAiCalled = false;
  globalThis.fetch = async (url) => {
    const supabase = mockSupabase(url);
    if (supabase) return supabase;
    openAiCalled = true;
    return new Response(JSON.stringify({ output_text: JSON.stringify({ evidence: [] }) }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  try {
    const response = createResponse();
    await findHandler({
      method: "POST",
      body: {
        reservation_id: TEST_RESERVATION,
        question: "What did the report say in the Legacy section?",
        blocks: [
          { index: 0, id: "other", section: "Financial Review", page: 10, text: "The company reported strong revenue growth in the year." }
        ]
      },
      headers: { authorization: "Bearer test-token" }
    }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.evidence, []);
    assert.equal(openAiCalled, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("an explicit section request searches only matching section metadata", async () => {
  const originalFetch = globalThis.fetch;
  let submittedInput = "";
  globalThis.fetch = async (_url, options) => {
    const supabase = mockSupabase(_url);
    if (supabase) return supabase;
    submittedInput = JSON.stringify(JSON.parse(options.body).input);
    return new Response(JSON.stringify({ output_text: JSON.stringify({ evidence: [] }) }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  try {
    const response = createResponse();
    await findHandler({
      method: "POST",
      body: {
        reservation_id: TEST_RESERVATION,
        question: "What did the report say in the Legacy section?",
        blocks: [
          { index: 0, id: "legacy", section: "Legacy Section", page: 10, text: "The legacy division was sold in 2025 after a strategic review." },
          { index: 1, id: "other", section: "Financial Review", page: 11, text: "The company reported strong revenue growth in the year." }
        ]
      },
      headers: { authorization: "Bearer test-token" }
    }, response);
    assert.equal(response.statusCode, 200);
    assert.match(submittedInput, /legacy division was sold/i);
    assert.doesNotMatch(submittedInput, /strong revenue growth/i);
  } finally { globalThis.fetch = originalFetch; }
});


test("multilingual question terms retain Unicode words for candidate ranking", async () => {
  const originalFetch = globalThis.fetch;
  let submittedInput = "";
  const source = "أعلنت الشركة عن نمو الإيرادات خلال السنة المالية.";
  globalThis.fetch = async (_url, options) => {
    const supabase = mockSupabase(_url);
    if (supabase) return supabase;
    submittedInput = JSON.stringify(JSON.parse(options.body).input);
    return new Response(JSON.stringify({
      output_text: JSON.stringify({ evidence: [{ block_index: 0, passage: source }] })
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = createResponse();
    await findHandler({
      method: "POST",
      body: {
        reservation_id: TEST_RESERVATION,
        question: "ماذا أعلنت الشركة عن نمو الإيرادات؟",
        blocks: [{ index: 0, id: "arabic-source", text: source, section: "PDF page 2", page: 2 }]
      },
      headers: { authorization: "Bearer test-token" }
    }, response);
    assert.equal(response.statusCode, 200);
    assert.match(submittedInput, /أعلنت الشركة عن نمو الإيرادات/);
    assert.equal(response.body.evidence[0].passage, source);
    assert.equal(response.body.evidence[0].page, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
