// Snip + ExtensionPay
// ExtPay.js must be present in this folder.
importScripts('ExtPay.js');

const EXTPAY_ID = 'snip';
const FREE_DAILY_LIMIT = 10;
const ANON_FREE_LIMIT = 10;
const PRO_MONTHLY_LIMIT = 500;
const PRO_PLAN = 'Pro';
const UNLIMITED_PLAN = 'Unlimited';

const SUPABASE_URL = 'https://zkkmgrsrchnwvijeyyan.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpra21ncnNyY2hud3ZpamV5eWFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNjI2NzgsImV4cCI6MjEwNzYzODY3OH0.LYmjxYwnSlZhcd3P45UTFmxpwmCufTVgdohFkq3m2NA';

async function supabaseAuth(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${SUPABASE_URL}${path}`, {
      method: options.method || 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: 'no-store'
    });
    // Keep the timeout active until the response body is parsed too. Clearing it
    // immediately after fetch() can leave auth stuck if the body never completes.
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (_) {
      throw new Error('The account service returned an unreadable response. Please try again.');
    }
    if (!response.ok) {
      const message = data.msg || data.error_description || data.message || data.error || `Authentication failed (${response.status}).`;
      const error = new Error(String(message));
      error.statusCode = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Authentication timed out. Check your internet connection and try again.');
    if (error instanceof TypeError) throw new Error('Could not connect to the account service. Check your internet connection and try again.');
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function saveSession(session) {
  await chrome.storage.local.set({ snip_auth_session: session });
}

async function getAuthSession() {
  const stored = await chrome.storage.local.get('snip_auth_session');
  const session = stored.snip_auth_session;
  if (!session?.access_token) return null;
  if (session.expires_at && Date.now() < Number(session.expires_at) * 1000 - 60000) return session;
  if (!session.refresh_token) {
    await chrome.storage.local.remove('snip_auth_session');
    return null;
  }
  try {
    const refreshed = await supabaseAuth('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } });
    await saveSession(refreshed);
    return refreshed;
  } catch (error) {
    // Invalid/expired refresh credentials require a fresh login. Network,
    // rate-limit, and service errors should not falsely log the user out.
    if ([400, 401, 403].includes(Number(error?.statusCode))) {
      await chrome.storage.local.remove('snip_auth_session');
      return null;
    }
    console.warn('Snip session refresh failed temporarily; preserving session for retry:', error?.message || error);
    return session;
  }
}

async function getSnipRequestIdentity() {
  const session = await getAuthSession();
  if (session?.access_token) {
    return { session, apiKey: await extpay.ensureApiKey() };
  }
  const stored = await chrome.storage.local.get("snip_install_id");
  let apiKey = stored.snip_install_id;
  if (typeof apiKey !== "string" || apiKey.length < 16) {
    apiKey = crypto.randomUUID();
    await chrome.storage.local.set({ snip_install_id: apiKey });
  }
  return { session: null, apiKey };
}

async function authSignup(email, password) {
  const data = await supabaseAuth('/auth/v1/signup', { body: { email, password } });
  if (data.access_token) await saveSession(data);
  return data;
}

async function authLogin(email, password) {
  const data = await supabaseAuth('/auth/v1/token?grant_type=password', { body: { email, password } });
  await saveSession(data);
  return data;
}

async function authLogout() {
  const stored = await chrome.storage.local.get('snip_auth_session');
  const session = stored.snip_auth_session;
  // Clear the local session first so a network outage cannot trap the user
  // in a logged-in state. Remote token revocation is best-effort.
  await chrome.storage.local.remove('snip_auth_session');
  if (session?.access_token) {
    try {
      await supabaseAuth('/auth/v1/logout', { accessToken: session.access_token });
    } catch (error) {
      console.warn('Snip remote logout failed after local logout:', error?.message || error);
    }
  }
}

const extpay = ExtPay(EXTPAY_ID);
extpay.startBackground();

async function getEntitlement() {
  try {
    const user = await extpay.getUser();
    if (user?.paid) {
      const nickname = String(user.plan?.nickname || '').trim().toLowerCase();
      const amount = Number(user.plan?.unitAmountCents || 0);

      // Prefer the plan nickname configured in ExtensionPay.
      if (nickname === PRO_PLAN.toLowerCase() || amount === 500) {
        return { plan: 'pro', limit: PRO_MONTHLY_LIMIT, period: 'month', paid: true };
      }
      if (nickname === UNLIMITED_PLAN.toLowerCase() || amount === 1500) {
        return { plan: 'unlimited', limit: null, period: 'unlimited', paid: true };
      }

      // A paid plan that doesn't match the two expected Snip plans is not
      // silently treated as unlimited.
      return { plan: 'pro', limit: PRO_MONTHLY_LIMIT, period: 'month', paid: true };
    }

    return { plan: 'free', limit: FREE_DAILY_LIMIT, period: 'day', paid: false };
  } catch (error) {
    console.error('Snip ExtensionPay error:', error);
    throw new Error('Could not verify Snip plan. Please try again.');
  }
}

function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Keep authenticated usage isolated per account. A single shared key caused one
// account (or earlier testing) to exhaust the free allowance for every account.
function accountUsageKey(plan, session) {
  const identity = String(session?.user?.id || session?.user?.email || '').trim().toLowerCase();
  if (!identity) throw new Error('Could not identify the signed-in Snip account. Please log in again.');
  const safeIdentity = identity.replace(/[^a-z0-9_-]/g, '_');
  return plan === 'pro' ? `snip_month_usage_${safeIdentity}` : `snip_day_usage_${safeIdentity}`;
}

async function getUsage() {
  return usageRequest("status");
}

async function consumeUsage() {
  const session = await getAuthSession();

  if (!session) {
    const periodKey = localDayKey();
    const stored = await chrome.storage.local.get('snip_anon_usage');
    const record = stored.snip_anon_usage;
    const used = typeof record === 'object' && record?.periodKey === periodKey && Number.isFinite(record.used)
      ? Math.max(0, record.used)
      : (Number.isFinite(record) ? Math.max(0, record) : 0);
    if (used >= ANON_FREE_LIMIT) {
      return { plan: 'anonymous', limit: ANON_FREE_LIMIT, period: 'day', used, remaining: 0, consumed: false, authenticated: false };
    }
    const nextUsed = used + 1;
    await chrome.storage.local.set({ snip_anon_usage: { periodKey, used: nextUsed } });
    return { plan: 'anonymous', limit: ANON_FREE_LIMIT, period: 'day', used: nextUsed, remaining: ANON_FREE_LIMIT - nextUsed, consumed: true, authenticated: false };
  }

  const entitlement = await getEntitlement();
  if (entitlement.plan === 'unlimited') {
    return { ...entitlement, used: 0, remaining: null, consumed: true, authenticated: true };
  }

  const key = accountUsageKey(entitlement.plan, session);
  const periodKey = entitlement.plan === 'pro' ? localMonthKey() : localDayKey();
  const stored = await chrome.storage.local.get(key);
  const record = stored[key];
  const used = record?.periodKey === periodKey && Number.isFinite(record.used)
    ? Math.max(0, record.used)
    : 0;

  if (used >= entitlement.limit) {
    return { ...entitlement, used, remaining: 0, consumed: false, authenticated: true };
  }

  const nextUsed = used + 1;
  await chrome.storage.local.set({ [key]: { periodKey, used: nextUsed } });
  return { ...entitlement, used: nextUsed, remaining: entitlement.limit - nextUsed, consumed: true, authenticated: true };
}

function isPdfUrl(url) {
  return /\.pdf(?:[?#]|$)/i.test(String(url || ''));
}

async function openPdfSnip(tab) {
  if (!tab?.id || !isPdfUrl(tab.url)) return false;
  const params = new URLSearchParams({ tabId: String(tab.id), url: String(tab.url) });
  await chrome.windows.create({
    url: `${chrome.runtime.getURL('pdf.html')}?${params.toString()}`,
    type: 'popup',
    width: 780,
    height: 680,
    focused: true
  });
  return true;
}

function sessionUser(session) {
  if (!session) return null;
  return session.user || null;
}

async function openPayment(plan) {
  const targetAmount = plan === 'unlimited' ? 1500 : 500;
  const plans = await extpay.getPlans();
  const list = Array.isArray(plans) ? plans : (Array.isArray(plans?.plans) ? plans.plans : []);
  const matching = list.find(p => Number(p?.unitAmountCents) === targetAmount && String(p?.currency || '').toLowerCase() === 'usd');

  // ExtensionPay can deep-link only when the plan has a real nickname.
  // Never invent one: if the account has no nickname, open the normal plan chooser.
  const nickname = matching?.nickname ? String(matching.nickname).trim() : '';
  await extpay.openPaymentPage(nickname || undefined);
}

async function requestSnipEvidence(question, blocks, reservationId) {
  if (typeof question !== 'string' || !question.trim() || question.length > 1000) {
    throw new Error('Please enter a shorter, non-empty question.');
  }
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > 120) {
    throw new Error('The page context is invalid. Please try again.');
  }
  let totalChars = 0;
  const safeBlocks = blocks.map(block => {
    if (!block || typeof block.text !== 'string' || typeof block.id !== 'string') {
      throw new Error('The page context contains an invalid passage. Please try again.');
    }
    totalChars += block.text.length;
    return {
      id: block.id.slice(0, 200),
      index: Number.isFinite(block.index) ? block.index : 0,
      text: block.text.slice(0, 12000),
      kind: String(block.kind || 'p').slice(0, 30),
      section: String(block.section || '').slice(0, 500)
    };
  });
  if (totalChars > 60000) throw new Error('This page is too large to search at once. Try a shorter page or a more specific question.');

  if (!reservationId) throw new Error("A valid usage reservation is required.");
  const controller = new AbortController();
  const { session, apiKey } = await getSnipRequestIdentity();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch('https://snip-ai-delta.vercel.app/api/find', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        "X-Snip-ExtensionPay-Key": apiKey,
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
      },
      body: JSON.stringify({ question: question.trim(), blocks: safeBlocks, reservation_id: reservationId || null }),
      signal: controller.signal,
      cache: 'no-store'
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (_) {
      throw new Error(`Snip's backend service returned an unreadable response (${response.status}).`);
    }
    if (!response.ok) {
      const detail = data?.error || data?.message || raw.slice(0, 250) || 'Unknown backend error';
      throw new Error(`Backend request failed (${response.status}): ${detail}`);
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error("Snip's backend service took too long to respond. Please try again.");
    if (error instanceof TypeError) throw new Error('Snip could not connect to the backend service. Check your internet connection and try again.');
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === 'SNIP_BACKEND_FIND') {
        const data = await requestSnipEvidence(message.question, message.blocks, message.reservationId);
        sendResponse({ ok: true, data });
        return;
      }
      if (message?.type === 'SNIP_PDF_NAVIGATE_BACKGROUND') {
        const tabId = Number(message.tabId);
        const target = new URL(String(message.url || ''));
        if (!Number.isInteger(tabId) || tabId <= 0 || target.protocol !== 'https:' && target.protocol !== 'http:') {
          sendResponse({ ok: false, error: 'Invalid PDF navigation target.' });
          return;
        }
        // Update the original PDF tab without activating it, so the Snip
        // popup remains in front. Never claim the PDF actually rendered here.
        const tab = await chrome.tabs.get(tabId);
        if (!tab?.url || new URL(tab.url).origin !== target.origin || !/\.pdf(?:[?#]|$)/i.test(new URL(tab.url).pathname + new URL(tab.url).search)) {
          sendResponse({ ok: false, error: 'The original PDF tab no longer matches this document.' });
          return;
        }
        await chrome.tabs.update(tabId, { url: target.toString(), active: false });
        let actualUrl = '';
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 150));
          const current = await chrome.tabs.get(tabId).catch(() => null);
          actualUrl = current?.url || '';
          if (actualUrl === target.toString()) break;
        }
        sendResponse({ ok: actualUrl === target.toString(), requestedUrl: target.toString(), actualUrl, activated: false });
        return;
      }
      if (message?.type === 'SNIP_GET_USAGE') {
        sendResponse({ ok: true, ...(await getUsage()) });
        return;
      }
      if (message?.type === 'SNIP_SELECT_FREE_PLAN') {
        const entitlement = await getEntitlement();
        if (entitlement.paid) {
          sendResponse({ ok: false, error: 'A paid plan is active. Use Manage subscription to change or cancel it.' });
          return;
        }
        await chrome.storage.local.set({ snip_selected_plan: 'free' });
        sendResponse({ ok: true, plan: 'free' });
        return;
      }
      if (message?.type === 'SNIP_BACKEND_PDF_FIND') {
        const { session, apiKey } = await getSnipRequestIdentity();
        if (!message.reservationId) {
          sendResponse({ ok: false, error: 'Usage reservation required.' });
          return;
        }
        const response = await fetch('https://snip-ai-delta.vercel.app/api/pdf-find', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            "X-Snip-ExtensionPay-Key": apiKey,
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
          },
          body: JSON.stringify({ question: message.question, url: message.url, reservation_id: message.reservationId }),
          signal: AbortSignal.timeout(60000)
        });
        const data = await response.json().catch(() => ({}));
        sendResponse(response.ok ? { ok: true, data } : { ok: false, error: data.error || 'PDF search failed.' });
        return;
      }
      if (message?.type === 'SNIP_BACKEND_PDF_SUMMARY') {
        const { session, apiKey } = await getSnipRequestIdentity();
        if (!message.reservationId) {
          sendResponse({ ok: false, error: 'Usage reservation required.' });
          return;
        }
        const response = await fetch('https://snip-ai-delta.vercel.app/api/summary', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            "X-Snip-ExtensionPay-Key": apiKey,
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
          },
          body: JSON.stringify({ url: message.url, reservation_id: message.reservationId }),
          signal: AbortSignal.timeout(60000)
        });
        const data = await response.json().catch(() => ({}));
        sendResponse(response.ok ? { ok: true, data } : { ok: false, error: data.error || 'Executive Brief failed.' });
        return;
      }
      if (message?.type === 'SNIP_USAGE_RESERVE') {
        sendResponse({ ok: true, ...(await usageRequest("reserve")) });
        return;
      }
      if (message?.type === 'SNIP_USAGE_COMMIT') {
        if (!message.reservationId) {
          sendResponse({ ok: false, error: "Usage reservation required." });
          return;
        }
        const result = await usageRequest("commit", message.reservationId);
        sendResponse({ ok: true, ...result });
        return;
      }
      if (message?.type === 'SNIP_USAGE_RELEASE') {
        if (message.reservationId) await usageRequest("release", message.reservationId);
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === 'SNIP_CONSUME_USAGE') {
        sendResponse({ ok: true, ...(await consumeUsage()) });
        return;
      }
      if (message?.type === 'SNIP_OPEN_PAYMENT') {
        await openPayment(message.plan);
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === 'SNIP_MANAGE_PAYMENT') {
        await extpay.openPaymentPage();
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === 'SNIP_AUTH_GET_SESSION') {
        const session = await getAuthSession();
        sendResponse({ ok: true, authenticated: !!session, user: sessionUser(session) });
        return;
      }
      if (message?.type === 'SNIP_AUTH_SIGNUP') {
        const data = await authSignup(String(message.email || '').trim(), String(message.password || ''));
        sendResponse({ ok: true, needsEmailConfirmation: !data.access_token, user: sessionUser(data) });
        return;
      }
      if (message?.type === 'SNIP_AUTH_LOGIN') {
        const data = await authLogin(String(message.email || '').trim(), String(message.password || ''));
        sendResponse({ ok: true, user: sessionUser(data) });
        return;
      }
      if (message?.type === 'SNIP_AUTH_LOGOUT') {
        await authLogout();
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false, error: 'Unknown message' });
    } catch (error) {
      console.error(
        'Snip background error in message:',
        message?.type,
        error?.stack || error
      );
      sendResponse({ ok: false, error: error?.message || 'Something went wrong.' });
    }
  })();
  return true;
});

// Open the webpage UI reliably. Pages that were already open when the extension
// was installed/reloaded may not have the content script, so recover by injecting
// it once and retrying instead of silently swallowing the missing-receiver error.
async function openWebSnip(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'TLDR_OPEN' });
    return;
  } catch (firstError) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, { type: 'TLDR_OPEN' });
    } catch (error) {
      console.error('Snip webpage popup failed to open:', error || firstError);
    }
  }
}

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'find-important') return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) return;

  if (isPdfUrl(tab.url)) {
    try { await openPdfSnip(tab); } catch (error) { console.error('Snip PDF window error:', error); }
    return;
  }

  await openWebSnip(tab.id);
});

chrome.action.onClicked.addListener(async tab => {
  if (!tab?.id) return;
  if (isPdfUrl(tab.url)) {
    try { await openPdfSnip(tab); } catch (error) { console.error('Snip PDF window error:', error); }
    return;
  }
  await openWebSnip(tab.id);
});

async function usageRequest(action, reservationId) {
  const { session, apiKey } = await getSnipRequestIdentity();
  const response = await fetch("https://snip-ai-delta.vercel.app/api/usage", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      "X-Snip-ExtensionPay-Key": apiKey
    },
    body: JSON.stringify({ action, reservation_id: reservationId || "" }),
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Usage request failed.");
  return data;
}
