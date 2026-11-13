import { createHash } from "node:crypto";

const URL = (process.env.SUPABASE_URL || "").trim();
const ANON = (process.env.SUPABASE_ANON_KEY || "").trim();
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

async function rpc(name, body) {
  const response = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Database error ${response.status}`);
  return data;
}

async function verifyUser(token) {
  const response = await fetch(`${URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("Invalid session. Please sign in again.");
  const user = await response.json();
  if (!user.id) throw new Error("Account verification failed.");
  return user.id;
}

async function verifyPlan(key) {
  if (!key) throw new Error("Subscription verification unavailable.");
  const response = await fetch(
    `https://extensionpay.com/extension/snip/api/v2/user?api_key=${encodeURIComponent(key)}`,
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) }
  );
  if (!response.ok) throw new Error("Subscription verification failed.");
  const user = await response.json();
  if (!user.paid) return "free";
  const name = String(user.plan?.nickname || "").toLowerCase();
  const amount = Number(user.plan?.unitAmountCents || 0);
  if (name === "unlimited" || amount === 1500) return "unlimited";
  if (name === "pro" || amount === 500) return "pro";
  throw new Error("Unrecognized paid subscription plan.");
}

function installHash(key) {
  return createHash("sha256").update(key).digest("hex");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Snip-ExtensionPay-Key");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!URL || !ANON || !SERVICE) throw new Error("Missing Supabase configuration.");

    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const key = String(req.headers["x-snip-extensionpay-key"] || "");
    const action = String(req.body?.action || "");
    const id = String(req.body?.reservation_id || "");

    if (!["status", "reserve", "commit", "release"].includes(action))
      return res.status(400).json({ error: "Unknown usage action." });

    if (action === "commit" || action === "release") {
      if (!/^[0-9a-f-]{36}$/i.test(id))
        return res.status(400).json({ error: "Invalid reservation." });
    }

    if (token) {
      const userId = await verifyUser(token);
      let plan = "free";
      try {
        plan = await verifyPlan(key);
      } catch (error) {
        console.warn("Snip subscription verification unavailable; using Free limits:", error.message);
      }
      const args = { p_user_id: userId, p_plan: plan };

      if (action === "status" || action === "reserve") {
        const fn = action === "status" ? "snip_get_usage" : "snip_reserve_usage";
        const result = await rpc(fn, args);
        return res.status(200).json({ ...result, plan, authenticated: true });
      }

      const fn = action === "commit" ? "snip_commit_usage" : "snip_release_usage";
      const result = await rpc(fn, { p_user_id: userId, p_reservation_id: id });
      return res.status(200).json(result);
    }

    if (!key || key.length > 512)
      return res.status(401).json({ error: "Installation identity missing." });

    const hash = installHash(key);
    const args = { p_install_hash: hash };

    if (action === "status" || action === "reserve") {
      const fn = action === "status" ? "snip_anon_get_usage" : "snip_anon_reserve_usage";
      const result = await rpc(fn, args);
      return res.status(200).json({ ...result, plan: "anonymous", authenticated: false });
    }

    const fn = action === "commit" ? "snip_anon_commit_usage" : "snip_anon_release_usage";
    const result = await rpc(fn, { p_install_hash: hash, p_reservation_id: id });
    return res.status(200).json(result);
  } catch (error) {
    console.error("Snip usage error:", {
      message: error.message,
      cause: error.cause?.message,
      code: error.cause?.code,
      hostname: (() => { try { return new URL(URL).hostname; } catch { return "invalid-url"; } })()
    });
    return res.status(503).json({ error: "Usage service unavailable." });
  }
}
