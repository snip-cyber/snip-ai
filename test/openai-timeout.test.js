import assert from "node:assert/strict";
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

process.env.OPENAI_API_KEY = "test-only";
process.env.SNIP_OPENAI_TIMEOUT_MS = "30";
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

test("OpenAI timeout fails closed without verified evidence", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  console.error = () => {};
  globalThis.fetch = async (url, options) => { const auth = mockSupabase(url); if (auth) return auth; return new Promise((_, reject) => {
    options.signal.addEventListener("abort", () => {
      reject(new Error("request aborted"));
    }, { once: true });
  });
  };

  try {
    const response = createResponse();
    const source = "Cash and cash equivalents were £864.5m at 29 March 2025.";
    await findHandler({
      method: "POST",
      body: {
        question: "What were cash and cash equivalents in FY2025?",
        reservation_id: TEST_RESERVATION,
        blocks: [{ index: 0, id: "source", text: source, section: "PDF page 126", page: 126 }]
      },
      headers: { authorization: "Bearer test-token" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.evidence, []);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
