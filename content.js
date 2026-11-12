(() => {
  if (window.__tldrInstalled) return;
  window.__tldrInstalled = true;

  const ROOT_ID = "snip-root";
  let activeRoot = null;

  function removeRoot() {
    const existing = document.getElementById(ROOT_ID);
    existing?.__cleanupPlanSync?.();
    existing?.remove();
  }

  function openPrompt() {
    removeRoot();

    const host = document.createElement("div");
    host.id = ROOT_ID;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; position:fixed; left:50%; bottom:12px; transform:translateX(-50%); z-index:2147483647; display:block; color-scheme:light; }
        * { box-sizing: border-box; }
        .snip-card { width: min(620px, calc(100vw - 16px)); max-height: min(38vh, 300px); overflow: auto; background:#ffffff; color:#17212b; border:1px solid #dce6eb; border-radius:14px; padding:8px; box-shadow:0 12px 38px rgba(0,0,0,.18); font:13px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color-scheme:light; }
        .snip-brand { display:flex; align-items:center; gap:8px; margin:0 2px 5px; font-size:12px; font-weight:850; letter-spacing:.09em; }
        .snip-hint { font-weight:500; letter-spacing:0; color:#777; }
        .snip-row { display:flex; flex-wrap:nowrap; gap:6px; align-items:stretch; min-width:0; }
        .snip-input,.snip-auth-email,.snip-auth-password { min-width:0; width:100%; padding:8px 10px; border:1px solid #d5e1e7; border-radius:10px; background:#ffffff; color:#17212b; font:inherit; font-size:13px; outline:none; }
        .snip-input { flex:1 1 auto; }
        .snip-input:focus,.snip-auth-email:focus,.snip-auth-password:focus { border-color:#00bcd4; box-shadow:0 0 0 3px rgba(0,188,212,.16); }
        .snip-btn { border:1px solid #00a9bf; border-radius:9px; padding:8px 12px; background:#00b8d0; color:#06252b; font:inherit; font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap; }
        .snip-btn:hover { background:#35c9dc; }
        .snip-btn:disabled { opacity:.55; cursor:wait; }
        .snip-close { background:#f2f8fa; color:#24343b; border-color:#dce8ec; padding-inline:13px; }
        .snip-share,.snip-sources { margin-top:5px; background:#f2f8fa; color:#24343b; border-color:#dce8ec; }
        .snip-status { margin:5px 2px 0; font-size:12px; color:#555; min-height:16px; }
        .snip-usage { margin:4px 2px 0; font-size:12px; color:#617782; }
        .snip-auth-row { display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin:8px 2px 0; font-size:12px; }
        .snip-link-btn { border:0; background:transparent; padding:2px 0; color:#666; font:inherit; font-size:12px; cursor:pointer; }
        .snip-link-btn:hover { text-decoration:underline; color:#008fa3; }
        .snip-free-shortcut { color:#007f91; font-weight:800; }
        .snip-auth-row .snip-pricing { margin-left:auto; }
        .snip-auth-panel { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto auto; gap:7px; margin-top:10px; align-items:center; }
        .snip-auth-status { grid-column:1/-1; color:#555; font-size:12px; }
        .snip-upgrade { margin-top:5px; padding:6px; max-height: min(25vh, 180px); overflow:auto; border:1px solid #dce8ec; border-radius:12px; background:#f7fbfc; }
        .snip-upgrade-title { font-size:14px; font-weight:800; color:#171717; }
        .snip-upgrade-copy { margin-top:3px; font-size:12px; color:#666; }
        .snip-plan-row { display:flex; flex-flow:row nowrap; gap:6px; margin-top:6px; overflow-x:auto; padding:1px 1px 4px; }
        .snip-plan { display:flex; flex:1 0 0; flex-direction:column; align-items:flex-start; gap:2px; min-width:0; padding:7px; border:1px solid #d8e6eb; border-radius:11px; background:#ffffff; color:#17212b; text-align:left; white-space:normal; }
        .snip-plan strong { font-size:13px; }
        .snip-plan small { font-size:11px; line-height:1.4; color:#666; font-weight:500; }
        .snip-plan .snip-plan-cta { margin-top:4px; color:#202124; font-size:11px; font-weight:800; }
        .snip-plan.is-active { border:2px solid #00a9bf; box-shadow:0 0 0 2px rgba(0,188,212,.12); }
        .snip-upgrade-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .snip-plan-dismiss { border:0; background:transparent; color:#65757b; font:inherit; font-size:20px; line-height:1; padding:0 4px; cursor:pointer; }
        .snip-plan-dismiss:hover { color:#111; }
        .snip-plan:focus-visible,.snip-btn:focus-visible,.snip-link-btn:focus-visible { outline:2px solid #00b8d0; outline-offset:2px; }
        .snip-highlight { background:rgba(255,255,0,.28)!important; color:inherit!important; border-radius:3px; padding:1px 2px; box-shadow:0 0 0 1px rgba(255,255,0,.32); scroll-margin-top:35vh; }
        .snip-banner { position:fixed; left:50%; bottom:20px; transform:translateX(-50%); z-index:2147483646; background:#fff; color:#111; border:1px solid #eee; border-radius:999px; padding:9px 15px; box-shadow:0 8px 30px rgba(0,0,0,.18); font:13px Inter,ui-sans-serif,system-ui,sans-serif; }
        [hidden] { display:none!important; }
        @media(max-width:420px) { .snip-card { padding:9px; border-radius:13px; } .snip-row { gap:5px; } .snip-input { padding:9px 8px; font-size:12px; } .snip-find { padding-inline:10px; } .snip-close { padding-inline:10px; } .snip-auth-panel { grid-template-columns:minmax(0,1fr) minmax(0,1fr); } .snip-plan { flex:0 0 145px; } .snip-auth-row { gap:9px; } }
      </style>
      <div class="snip-card">
        <div class="snip-brand">
          SNIP
          <span class="snip-hint">Find it in context</span>
        </div>
        <div class="snip-row">
          <input class="snip-input" autofocus
            placeholder="Ask a question about this page..." />
          <button class="snip-btn snip-find">Find</button>
          <button class="snip-btn snip-close" aria-label="Close">×</button>
        </div>
        <div class="snip-usage" aria-live="polite">Checking account…</div>
        <div class="snip-auth-row">
          <span class="snip-account" aria-live="polite" hidden></span>
          <button class="snip-link-btn snip-login" type="button">Log in</button>
          <button class="snip-link-btn snip-signup" type="button">Sign up</button>
          <button class="snip-link-btn snip-free-shortcut" type="button">Free plan · 10/day</button>
          <button class="snip-link-btn snip-pricing" type="button">Plans</button>
          <button class="snip-link-btn snip-manage" type="button" hidden>Manage subscription</button>
          <button class="snip-link-btn snip-logout" type="button" hidden>Log out</button>
        </div>
        <div class="snip-auth-panel" hidden>
          <input class="snip-auth-email" type="email" autocomplete="email" placeholder="Email" />
          <input class="snip-auth-password" type="password" autocomplete="current-password" placeholder="Password" />
          <button class="snip-btn snip-auth-submit" type="button">Log in</button>
          <button class="snip-btn snip-auth-cancel" type="button">Cancel</button>
          <div class="snip-auth-status" aria-live="polite"></div>
        </div>
        <button class="snip-btn snip-share" type="button" hidden>Share this Snip</button>
        <button class="snip-btn snip-sources" type="button" hidden>← 1 / 1 →</button>
        <div class="snip-upgrade" hidden>
          <div class="snip-upgrade-head"><div class="snip-upgrade-title">Choose your Snip plan</div><button class="snip-plan-dismiss" type="button" aria-label="Close plans">×</button></div>
          <div class="snip-upgrade-copy">Choose a plan to continue, or keep your current plan.</div>
          <div class="snip-plan-row">
            <button class="snip-plan snip-free-plan" type="button"><strong>Free</strong><small>$0 · 10 Snips per day</small><span class="snip-plan-cta">Choose Free</span></button>
            <button class="snip-plan snip-pro" type="button"><strong>Pro · $5/month</strong><small>500 Snips per month</small><span class="snip-plan-cta">Upgrade to Pro</span></button>
            <button class="snip-plan snip-unlimited" type="button"><strong>Unlimited · $15/month</strong><small>No Snip search limit</small><span class="snip-plan-cta">Get Unlimited</span></button>
          </div>
        </div>
        <div class="snip-status">Ready to search page context.</div>
      </div>
    `;

    document.body.appendChild(host);
    activeRoot = root;

    const input = root.querySelector(".snip-input");
    const button = root.querySelector(".snip-find");
    const close = root.querySelector(".snip-close");
    const share = root.querySelector(".snip-share");
    const sources = root.querySelector(".snip-sources");
    const login = root.querySelector(".snip-login");
    const signup = root.querySelector(".snip-signup");
    const logout = root.querySelector(".snip-logout");
    const pricing = root.querySelector(".snip-pricing");
    const freeShortcut = root.querySelector(".snip-free-shortcut");
    const manage = root.querySelector(".snip-manage");
    const authPanel = root.querySelector(".snip-auth-panel");
    const authEmail = root.querySelector(".snip-auth-email");
    const authPassword = root.querySelector(".snip-auth-password");
    const authSubmit = root.querySelector(".snip-auth-submit");
    const authCancel = root.querySelector(".snip-auth-cancel");
    let authMode = "login";
    const freePlan = root.querySelector(".snip-free-plan");
    const pro = root.querySelector(".snip-pro");
    const unlimited = root.querySelector(".snip-unlimited");
    const dismissPlans = root.querySelector(".snip-plan-dismiss");

    close.onclick = removeRoot;
    dismissPlans.onclick = () => { root.querySelector(".snip-upgrade").hidden = true; };
    share.onclick = () => shareCurrentSnip(root);
    sources.onclick = event => {
      const rect = sources.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const direction = clickX < rect.width / 2 ? -1 : 1;
      cycleOtherSource(root, direction);
    };
    freePlan.onclick = () => chooseFreePlan(root);
    freeShortcut.onclick = () => chooseFreePlan(root);
    pro.onclick = () => openPayment("pro", root);
    unlimited.onclick = () => openPayment("unlimited", root);
    pricing.onclick = () => showPlanChooser(root);
    manage.onclick = async () => {
      const status = root.querySelector(".snip-status");
      if (status) status.textContent = "Opening subscription management…";
      const result = await sendRuntimeMessage({ type: "SNIP_MANAGE_PAYMENT" });
      if (!result?.ok && status) {
        status.textContent = result?.error || "Could not open subscription management.";
      }
    };
    login.onclick = () => openAuth("login");
    signup.onclick = () => openAuth("signup");
    logout.onclick = async () => {
      const result = await sendRuntimeMessage({ type: "SNIP_AUTH_LOGOUT" });
      if (result?.ok) updateAuthUI(null);
      else root.querySelector(".snip-auth-status").textContent = result?.error || "Could not log out.";
    };
    authSubmit.onclick = submitAuth;
    authCancel.onclick = () => { authPanel.hidden = true; };
    authPassword.addEventListener("keydown", e => { if (e.key === "Enter") authSubmit.click(); });
    button.onclick = () => runBackendSearch(input.value.trim(), root);

    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === "SNIP_PAYMENT_CONFIRMED") {
        root.querySelector(".snip-upgrade")?.setAttribute("hidden", "");
        const status = root.querySelector(".snip-status");
        if (status) status.textContent = "Payment confirmed. Updating your Snip plan…";
        refreshUsage(root).then(result => {
          if (!root.isConnected) return;
          if (status) status.textContent = result?.plan === "unlimited"
            ? "Unlimited plan active."
            : result?.plan === "pro"
              ? "Pro plan active · 500 searches/month."
              : "Payment confirmed.";
        });
      }
    });

    input.addEventListener("keydown", e => {
      if (e.key === "Escape") removeRoot();
      if (e.key === "Enter") button.click();
    });

    input.focus();
    refreshAuth();
    const syncPlanState = () => { if (root.isConnected) refreshUsage(root); };
    host.__planSyncInterval = setInterval(syncPlanState, 5000);
    window.addEventListener("focus", syncPlanState);
    document.addEventListener("visibilitychange", syncPlanState);
    host.__cleanupPlanSync = () => {
      clearInterval(host.__planSyncInterval);
      window.removeEventListener("focus", syncPlanState);
      document.removeEventListener("visibilitychange", syncPlanState);
    };
  }

  function openAuth(mode) {
    if (!activeRoot) return;
    const panel = activeRoot.querySelector(".snip-auth-panel");
    const submit = activeRoot.querySelector(".snip-auth-submit");
    const status = activeRoot.querySelector(".snip-auth-status");
    const email = activeRoot.querySelector(".snip-auth-email");
    const password = activeRoot.querySelector(".snip-auth-password");
    activeRoot.__authMode = mode;
    panel.hidden = false;
    submit.textContent = mode === "signup" ? "Create account" : "Log in";
    password.autocomplete = mode === "signup" ? "new-password" : "current-password";
    status.textContent = "";
    email.focus();
  }

  async function submitAuth() {
    const root = activeRoot;
    if (!root?.isConnected) return;
    const email = root.querySelector(".snip-auth-email");
    const password = root.querySelector(".snip-auth-password");
    const submit = root.querySelector(".snip-auth-submit");
    const status = root.querySelector(".snip-auth-status");
    const mainStatus = root.querySelector(".snip-status");
    const mode = root.__authMode || "login";
    const emailValue = email.value.trim();
    const passwordValue = password.value;
    if (!emailValue || !passwordValue) { status.textContent = "Enter your email and password."; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) { status.textContent = "Enter a valid email address."; email.focus(); return; }
    if (passwordValue.length < 6) { status.textContent = "Your password must be at least 6 characters."; password.focus(); return; }

    submit.disabled = true;
    email.disabled = true;
    password.disabled = true;
    const previousLabel = submit.textContent;
    status.textContent = mode === "signup" ? "Creating your account…" : "Logging in…";
    if (mainStatus) mainStatus.textContent = status.textContent;
    try {
      const result = await sendRuntimeMessageWithTimeout({
        type: mode === "signup" ? "SNIP_AUTH_SIGNUP" : "SNIP_AUTH_LOGIN",
        email: emailValue,
        password: passwordValue
      }, 16000);
      if (!root.isConnected) return;
      if (!result?.ok) {
        status.textContent = result?.error || "Authentication failed. Please try again.";

        return;
      }
      if (mode === "signup") {
        // Keep the account-created feedback in one place, not in both status areas.
        root.__authMode = "login";
        submit.textContent = "Log in";
        password.autocomplete = "current-password";
        password.value = "";
        status.textContent = "Account created. You can now log in.";
        if (mainStatus) mainStatus.textContent = "Ready to search.";
        email.focus();
        return;
      }
      if (!result.user) {
        status.textContent = "Login could not be completed. Please try again.";
        if (mainStatus) mainStatus.textContent = "Login could not be completed. Please try again.";
        return;
      }
      root.querySelector(".snip-auth-panel").hidden = true;
      email.value = "";
      password.value = "";
      updateAuthUI(result.user);
      status.textContent = "Signed in successfully.";
      if (mainStatus) mainStatus.textContent = "Signed in successfully.";
      showPlanChooser(root);
      await refreshUsage(root);
    } catch (error) {
      if (root.isConnected) {
        status.textContent = error?.message || "Authentication failed. Check your connection and try again.";

      }
    } finally {
      if (root.isConnected) {
        submit.disabled = false;
        email.disabled = false;
        password.disabled = false;
        if (root.__authMode === "signup" && submit.textContent === "Log in") submit.textContent = "Create account";
        else if (root.__authMode !== "signup") submit.textContent = "Log in";
        else submit.textContent = previousLabel;
      }
    }
  }

  function showPlanChooser(root) {
    const chooser = root.querySelector(".snip-upgrade");
    if (!chooser) return;
    chooser.hidden = false;
    updatePlanCardState(root);
    const status = root.querySelector(".snip-status");
    if (status) status.textContent = "Choose Free or compare the paid plans. You can keep using Snip on Free.";
  }

  async function chooseFreePlan(root) {
    const status = root.querySelector(".snip-status");
    const chooser = root.querySelector(".snip-upgrade");
    const result = await sendRuntimeMessage({ type: "SNIP_SELECT_FREE_PLAN" });
    if (!root.isConnected) return;
    if (!result?.ok) {
      status.textContent = result?.error || "Could not select the Free plan. Please try again.";
      return;
    }
    chooser.hidden = true;
    status.textContent = "Free plan selected · 10 Snips per day. You can upgrade any time.";
    await refreshUsage(root);
  }

  function updateAuthUI(user) {
    if (!activeRoot) return;
    const account = activeRoot.querySelector(".snip-account");
    const usage = activeRoot.querySelector(".snip-usage");
    const button = activeRoot.querySelector(".snip-find");
    const login = activeRoot.querySelector(".snip-login");
    const signup = activeRoot.querySelector(".snip-signup");
    const logout = activeRoot.querySelector(".snip-logout");
    const manage = activeRoot.querySelector(".snip-manage");
    const loggedIn = !!user;
    account.textContent = "";
    account.hidden = true;
    login.hidden = loggedIn;
    signup.hidden = loggedIn;
    logout.hidden = !loggedIn;
    manage.hidden = true;
    button.disabled = false;
    refreshUsage(activeRoot);
  }

  async function refreshAuth() {
    const result = await sendRuntimeMessage({ type: "SNIP_AUTH_GET_SESSION" });
    if (result?.ok) updateAuthUI(result.user || null);
    else if (activeRoot?.isConnected) {
      const status = activeRoot.querySelector(".snip-status");
      if (status) status.textContent = result?.error || "Could not check account. Snip search is still available.";
    }
    return result;
  }

  function sendRuntimeMessage(message) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, response => {
          try {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(response || { ok: false, error: "No response" });
          } catch (error) {
            resolve({ ok: false, error: error?.message || "Extension context unavailable." });
          }
        });
      } catch (error) {
        resolve({ ok: false, error: error?.message || "Extension context unavailable." });
      }
    });
  }

  function sendRuntimeMessageWithTimeout(message, timeoutMs = 16000) {
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish({ ok: false, error: "The account service did not respond in time. Check your connection and try again." }), timeoutMs);
      try {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) finish({ ok: false, error: chrome.runtime.lastError.message });
          else finish(response || { ok: false, error: "No response from the account service." });
        });
      } catch (error) {
        finish({ ok: false, error: error?.message || "Could not contact the account service." });
      }
    });
  }

  function formatUsage(data) {
    if (!data?.ok) return "Plan unavailable";
    if (data.plan === "unlimited") return "Unlimited · no Snip limit";
    if (data.plan === "anonymous") return `Free · ${data.remaining} of ${data.limit} free searches`;
    if (data.plan === "pro") return `Pro · ${data.remaining} of ${data.limit} Snips left this month`;
    return `Free · ${data.remaining} of ${data.limit} Snips left today`;
  }

  async function refreshUsage(root) {
    const usage = root.querySelector(".snip-usage");
    const result = await sendRuntimeMessage({ type: "SNIP_GET_USAGE" });
    if (!usage || !root.isConnected) return result;
    usage.textContent = formatUsage(result);
    updatePlanCardState(root, result);
    const upgradeCopy = root.querySelector(".snip-upgrade-copy");
    if (upgradeCopy && result?.ok) {
      const exhausted = result.plan !== "unlimited" && Number(result.remaining) <= 0;
      upgradeCopy.textContent = exhausted
        ? (result.plan === "pro" ? "Your Pro monthly searches are finished. Choose a plan to continue." : "Your free searches are finished. Choose a plan to continue.")
        : (result.plan === "pro" ? "Pro is your current plan. You can manage it or compare other plans." : result.plan === "unlimited" ? "Unlimited is your current plan. You can manage it or compare other plans." : "Choose Free to keep using Snip at no cost, or compare paid plans.");
    }
    const freeShortcut = root.querySelector(".snip-free-shortcut");
    if (freeShortcut) freeShortcut.hidden = !!(result?.ok && (result.plan === "pro" || result.plan === "unlimited"));
    const manage = root.querySelector(".snip-manage");
    if (manage) {
      manage.hidden = !(result?.ok && result.authenticated &&
        (result.plan === "pro" || result.plan === "unlimited"));
    }
    if (result?.ok && Number(result.remaining) <= 0 && result.plan !== "unlimited") {
      root.querySelector(".snip-upgrade").hidden = false;
    }
    return result;
  }

  function updatePlanCardState(root, knownUsage) {
    const usage = knownUsage || null;
    const cards = [
      [root.querySelector(".snip-free-plan"), "free"],
      [root.querySelector(".snip-pro"), "pro"],
      [root.querySelector(".snip-unlimited"), "unlimited"]
    ];
    for (const [card, plan] of cards) {
      if (!card) continue;
      const active = !!usage?.ok && (usage.plan === plan || (plan === "free" && ["anonymous", "free"].includes(usage.plan)));
      card.classList.toggle("is-active", active);
      card.setAttribute("aria-pressed", active ? "true" : "false");
      card.setAttribute("aria-label", `${plan === "free" ? "Free" : plan === "pro" ? "Pro" : "Unlimited"}${active ? ", current plan" : ""}`);
      const cta = card.querySelector(".snip-plan-cta");
      if (cta) cta.textContent = active ? "Current plan" : (plan === "free" ? "Choose Free" : plan === "pro" ? "Upgrade to Pro" : "Get Unlimited");
    }
  }

  async function openPayment(plan, root) {
    const status = root.querySelector(".snip-status");
    status.textContent = "Opening secure checkout…";
    const result = await sendRuntimeMessage({ type: "SNIP_OPEN_PAYMENT", plan });
    if (!result?.ok) {
      status.textContent = result?.error || "Could not open checkout.";
      return;
    }
    status.textContent = `Checkout opened for ${plan === "unlimited" ? "Unlimited" : "Pro"}. Waiting for confirmed payment…`;
    // Poll the authoritative usage/entitlement endpoint while this popup remains open.
    const started = Date.now();
    while (root.isConnected && Date.now() - started < 120000) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const usage = await refreshUsage(root);
      if (usage?.ok && usage.plan === plan) {
        root.querySelector(".snip-upgrade").hidden = true;
        status.textContent = `Payment confirmed · ${plan === "unlimited" ? "Unlimited" : "Pro"} plan is active.`;
        return;
      }
    }
    if (root.isConnected) status.textContent = "Checkout opened. Your plan will update automatically when payment is confirmed.";
  }

  function extractPageBlocks() {
    const selectors = "p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td, th";
    const elements = [...document.querySelectorAll(selectors)].filter(
      el => !el.closest('nav, aside, header, footer, form, [role="navigation"], [role="complementary"]')
    );
    let currentSection = "Page introduction";
    let nextIndex = 0;

    return elements
      .map(el => {
        const text = (el.innerText || "").trim();
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const tag = el.tagName.toLowerCase();

        if (/^h[1-6]$/.test(tag) && text.length >= 3) {
          currentSection = text.replace(/\s+/g, " ").trim().slice(0, 180);
        }

        if (
          text.length >= 15 &&
          r.width > 0 &&
          r.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        ) {
          const index = nextIndex++;
          return {
            id: `block-${index}`,
            index,
            text,
            kind: tag,
            section: currentSection,
            element: el
          };
        }

        return null;
      })
      .filter(Boolean);
  }

  // The Snip controls live in Shadow DOM, but the evidence highlights live in
  // the host webpage. Styles inside the controls' Shadow DOM cannot style those
  // page-level spans, and content.css is not injected by manifest.json. Install
  // a small page-level stylesheet as well as inline important styles below.
  function ensurePageHighlightStyles() {
    if (document.getElementById("snip-page-highlight-styles")) return;
    const style = document.createElement("style");
    style.id = "snip-page-highlight-styles";
    style.textContent = `
      span.snip-highlight {
        background: rgba(255,255,0,.28) !important;
        background-color: rgba(255,255,0,.28) !important;
        color: inherit !important;
        border-radius: 3px !important;
        padding: 0 1px !important;
        box-shadow: 0 0 0 1px rgba(255,255,0,.32) !important;
        -webkit-box-decoration-break: clone !important;
        box-decoration-break: clone !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function clearHighlights() {
    document.querySelectorAll(".snip-highlight").forEach(span => {
      const parent = span.parentNode;
      if (!parent) return;

      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }

      parent.removeChild(span);
      parent.normalize();
    });
  }

  /*
   * Build a normalized representation of the visible text while keeping
   * every normalized character mapped to its original text-node offset.
   * This lets Snip match across <strong>, <a>, <em>, etc. and tolerate
   * different whitespace in innerText vs. the live DOM.
   */
  function normalizeForAnchor(value) {
    return String(value || "")
      .replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, "")
      .replace(/[\u00ad\u200b\ufeff]/g, "")
      .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
      .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
      .replace(/[\u2013\u2014\u2212]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function getTextNodes(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!node.nodeValue) continue;
      if (parent && parent.closest("script,style,noscript,template")) continue;
      nodes.push(node);
    }
    return nodes;
  }

  // Find a phrase in the live DOM and highlight it by splitting only the
  // participating text nodes. Matching is normalized, but the highlighted
  // characters always come from the original page.
  // Tighten a returned evidence sentence to the smallest useful clause when
  // the question asks for a person. This keeps retrieval unchanged while
  // making the visual highlight much more precise.
  function refineEvidencePhrase(phrase, question) {
    const text = String(phrase || "").trim();
    const q = String(question || "").toLowerCase();
    if (!text) return text;

    // WHO: remove setup clauses when the answer-bearing person clause is clear.
    if (/\bwho\b/.test(q)) {
      const whileMatch = text.match(/\bwhile\s+([^.!?]+(?:\.|$))/i);
      if (whileMatch && /\b(?:remained|stayed|was|were|served|led|commanded|piloted|flew)\b/i.test(whileMatch[1])) {
        return whileMatch[1].trim();
      }
      const subjectMatch = text.match(/^(?:[^,]+,\s*)?((?:[A-Z][\w.'-]*\s+){0,3}(?:was|were|became|remained|stayed|served|led|commanded|piloted|flew)\b[^.!?]*)/);
      if (subjectMatch && subjectMatch[1].length >= 20) return subjectMatch[1].trim();
    }

    // WHEN: isolate the date/time phrase already contained in the selected sentence.
    // Date tokens are atomic: never allow the first two digits of a 4-digit year
    // to be mistaken for a day (e.g. "April 1912" -> "April 19").
    if (/\bwhen\b|\bwhat date\b|\bwhat time\b|\bwhen did\b/.test(q)) {
      const datePatterns = [
        // Full day-month-year first: e.g. "15 April 1912".
        /\b(?:on\s+)?\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b(?:\s+at\s+\d{1,2}:\d{2}\s*(?:UTC|GMT|[AP]M))?/i,
        // Month-day-year/date with an explicit boundary after the day.
        /\b(?:on\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?!\d)(?:,\s*\d{4})?(?:\s+at\s+\d{1,2}:\d{2}\s*(?:UTC|GMT|[AP]M))?/i,
        /\b\d{1,2}:\d{2}\s*(?:UTC|GMT|[AP]M)\b/i
      ];
      for (const pattern of datePatterns) {
        const m = text.match(pattern);
        if (m) return m[0].replace(/^on\s+/i, "").trim();
      }
    }

    // WHERE: keep the location phrase, not the surrounding mission/event setup.
    if (/\bwhere\b/.test(q)) {
      const locationPatterns = [
        /\b(?:landing|landed|arrived|descended|reached|touched down)\s+(?:in|at|on)\s+([^.!?]+?)(?=\s+while\b|\s+as\b|\s+and\b|[.!?]|$)/i,
        /\b(?:in|at|on)\s+(?:the\s+)?([A-Z][^.!?]{2,100}?)(?=\s+while\b|\s+and\b|[.!?]|$)/
      ];
      for (const pattern of locationPatterns) {
        const m = text.match(pattern);
        if (m) {
          const value = m[1].trim().replace(/\s+on\s+\w+.*$/i, "").trim();
          if (value.length >= 5) {
            return /^(?:the\s+)/i.test(value) ? value : `the ${value}`;
          }
        }
      }
    }

    // DURATION: prefer the total stay/activity duration relevant to the question.
    if (/\bhow long\b|\bhow many\s+(?:hours?|minutes?|days?|weeks?|months?|years?)\b/.test(q)) {
      const surface = text.match(/\b(?:more than|less than|about|approximately|around|nearly|roughly)?\s*\d+(?:\.\d+)?\s+(?:hours?|minutes?|days?|weeks?|months?|years?)\s+(?:on|in|at)\s+the\s+[^,.!?]+/i);
      if (surface) return surface[0].trim();
      const simple = text.match(/\b(?:more than|less than|about|approximately|around|nearly|roughly)?\s*\d+(?:\.\d+)?\s+(?:hours?|minutes?|days?|weeks?|months?|years?)\b/i);
      if (simple) return simple[0].trim();
    }

    return text;
  }

  function anchorEvidence(el, phrase) {
    ensurePageHighlightStyles();
    const originalPhrase = String(phrase || "").trim();
    if (!originalPhrase) return false;

    const nodes = getTextNodes(el);
    const chars = [];
    let pendingSpace = null;

    for (const node of nodes) {
      const value = node.nodeValue || "";

      for (let i = 0; i < value.length; i++) {
        const ch = value[i];

        // Citation markers such as [1] are ignored for matching, but their
        // original DOM positions remain untouched.
        const citation = value.slice(i).match(/^\[\s*\d+(?:\s*,\s*\d+)*\s*\]/);
        if (ch === "[" && citation) {
          i += citation[0].length - 1;
          continue;
        }

        if (/\s/.test(ch)) {
          if (chars.length && !pendingSpace) {
            pendingSpace = { node, offset: i };
          }
          continue;
        }

        if (pendingSpace) {
          chars.push({
            char: " ",
            node: pendingSpace.node,
            offset: pendingSpace.offset
          });
          pendingSpace = null;
        }

        const normalizedChar = normalizeForAnchor(ch);
        if (!normalizedChar) continue;

        chars.push({
          char: normalizedChar,
          node,
          offset: i
        });
      }
    }

    const normalized = chars.map(x => x.char).join("");

    // IMPORTANT: keep the actual text that matched. The old implementation
    // used the full AI phrase length even when a shorter fallback sentence or
    // word fragment matched, causing incorrect DOM ranges.
    const candidates = [];

    const addCandidate = (text, allowShort = false) => {
      const value = String(text || "").trim();
      const normalizedValue = normalizeForAnchor(value);
      // Keep short exact answers (notably dates) searchable, but don't let
      // tiny fragments of a long AI passage trigger a misleading highlight.
      if (normalizedValue.length >= 18 || (allowShort && normalizedValue.length >= 5)) {
        if (!candidates.some(candidate => candidate.normalized === normalizedValue)) {
          candidates.push({ text: value, normalized: normalizedValue });
        }
      }
    };

    // Dates must be treated as atomic answers. Without this, the generic
    // word-window fallback can accidentally match a prefix such as
    // "April 19" inside a longer date like "April 1912".
    const datePatterns = [
      /\b(?:on\s+)?\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b(?:\s+(?:at|on)\s+\d{1,2}:\d{2}\s*(?:UTC|GMT|[AP]M)\b)?/i,
      /\b(?:on\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?!\d)(?:,\s*\d{4})?\b(?:\s+(?:at|on)\s+\d{1,2}:\d{2}\s*(?:UTC|GMT|[AP]M)\b)?/i,
      /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/,
      /\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b/
    ];

    const dateMatches = [];
    for (const pattern of datePatterns) {
      const match = originalPhrase.match(pattern);
      if (match) dateMatches.push(match[0].replace(/^on\s+/i, '').trim());
    }

    if (dateMatches.length) {
      // Prefer the complete date/time answer and do not generate shorter
      // word-window candidates from it.
      for (const dateText of dateMatches) addCandidate(dateText, true);
    } else {
      addCandidate(originalPhrase, true);
    }

    for (const sentence of originalPhrase
      .split(/(?<=[.!?])\s+/)
      .map(x => x.trim())
      .filter(Boolean)) {
      addCandidate(sentence);
    }

    const words = originalPhrase
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);

    for (let size = Math.min(16, words.length); size >= 7; size--) {
      for (let i = 0; i + size <= words.length; i++) {
        const windowText = words.slice(i, i + size).join(" ");
        // Never let a shorter fragment of a detected date compete with the
        // complete date candidate. This protects dates in every page type.
        if (dateMatches.length && dateMatches.some(dateText =>
          normalizeForAnchor(dateText).includes(normalizeForAnchor(windowText))
        )) continue;
        addCandidate(windowText);
      }
    }

    // Longest candidates first gives the strongest exact anchor.
    candidates.sort((a, b) => b.normalized.length - a.normalized.length);

    let matched = null;
    for (const candidate of candidates) {
      const index = normalized.indexOf(candidate.normalized);
      if (index >= 0) {
        matched = {
          start: index,
          length: candidate.normalized.length
        };
        break;
      }
    }

    if (!matched) return false;

    const selected = chars.slice(
      matched.start,
      matched.start + matched.length
    );

    if (!selected.length) return false;

    const segments = new Map();

    for (const item of selected) {
      if (!item.node?.parentNode) continue;

      const existing = segments.get(item.node);
      if (!existing) {
        segments.set(item.node, {
          start: item.offset,
          end: item.offset + 1
        });
      } else {
        existing.start = Math.min(existing.start, item.offset);
        existing.end = Math.max(existing.end, item.offset + 1);
      }
    }

    if (!segments.size) return false;

    // Process nodes from the end of the DOM so splitting one node never
    // invalidates offsets used for a node that comes later in the operation.
    const entries = [...segments.entries()].reverse();
    let highlighted = false;

    for (const [node, range] of entries) {
      if (!node.parentNode) continue;

      try {
        const value = node.nodeValue || "";
        const begin = Math.max(0, Math.min(range.start, value.length));
        const end = Math.max(begin, Math.min(range.end, value.length));

        if (end <= begin) continue;

        if (end < value.length) {
          node.splitText(end);
        }

        const target = begin > 0
          ? node.splitText(begin)
          : node;

        const span = document.createElement("span");
        span.className = "snip-highlight";
        // Inline !important declarations survive common site-wide span resets.
        span.style.setProperty("background", "rgba(255,255,0,.28)", "important");
        span.style.setProperty("background-color", "rgba(255,255,0,.28)", "important");
        span.style.setProperty("color", "inherit", "important");
        span.style.setProperty("border-radius", "3px", "important");
        span.style.setProperty("padding", "0 1px", "important");
        span.style.setProperty("box-shadow", "0 0 0 2px rgba(255,193,7,.38)", "important");
        span.style.setProperty("-webkit-box-decoration-break", "clone", "important");
        span.style.setProperty("box-decoration-break", "clone", "important");
        target.parentNode.insertBefore(span, target);
        span.appendChild(target);
        highlighted = true;
      } catch (error) {
        console.debug("Snip anchor skipped", error);
      }
    }

    return highlighted;
  }

  function cleanShareText(text) {
    return String(text || "")
      .replace(/\[\d+\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function makeTextFragment(text) {
    const cleaned = cleanShareText(text);
    if (!cleaned) return "";

    // Keep fragments short enough for share URLs while retaining enough
    // context to uniquely locate the passage on most pages.
    const sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(Boolean);

    let fragment = sentences.find(s => s.length >= 45 && s.length <= 180) || cleaned;
    if (fragment.length > 180) fragment = fragment.slice(0, 180).replace(/\s+\S*$/, "");
    return fragment;
  }

  function buildShareUrl(evidence) {
    const url = new URL(window.location.href);
    // Remove an existing text fragment so repeated sharing doesn't stack fragments.
    url.hash = "";

    const fragments = [];
    for (const item of evidence.slice(0, 3)) {
      const fragment = makeTextFragment(item?.text);
      if (fragment) fragments.push(`text=${encodeURIComponent(fragment)}`);
    }

    if (!fragments.length) return url.toString();
    return `${url.toString()}#:~:${fragments.join("&")}`;
  }

  function cycleOtherSource(root, direction = 1) {
    const evidence = root.__snipEvidence || [];
    if (evidence.length < 2) return;
    let currentIndex = Number(root.__snipSourceIndex);
    if (!Number.isInteger(currentIndex)) currentIndex = 0;
    currentIndex = (currentIndex + direction + evidence.length) % evidence.length;
    root.__snipSourceIndex = currentIndex;
    const item = evidence[currentIndex];
    const phrase = String(item?.text || item?.passage || '').trim();
    if (!phrase) return;
    const pageBlocks = extractPageBlocks();
    const exactBlock = pageBlocks.find(b => b.id === item?.block_id || (item?.block_index != null && b.index === Number(item.block_index)));
    const candidates = exactBlock ? [exactBlock, ...pageBlocks.filter(b => b !== exactBlock)] : pageBlocks;
    clearHighlights();
    let matchedBlock = null;
    for (const candidate of candidates) {
      if (anchorEvidence(candidate.element, phrase)) { matchedBlock = candidate; break; }
    }
    if (!matchedBlock) {
      if (exactBlock?.element) exactBlock.element.scrollIntoView({behavior:'smooth',block:'center'});
      return;
    }
    matchedBlock.element.scrollIntoView({behavior:'smooth',block:'center'});
    const button = root.querySelector('.snip-sources');
    if (button) button.textContent = `← ${currentIndex + 1} / ${evidence.length} →`;
  }

  async function shareCurrentSnip(root) {
    const evidence = root.__snipEvidence || [];
    const shareUrl = buildShareUrl(evidence);
    const shareButton = root.querySelector(".snip-share");
    const original = shareButton.textContent;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Snip — Find it in context",
          text: "This is the exact part of the page I found with Snip.",
          url: shareUrl
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        shareButton.textContent = "Link copied";
        setTimeout(() => { shareButton.textContent = original; }, 1800);
      } else {
        window.prompt("Copy this Snip link:", shareUrl);
      }
    } catch (error) {
      // Web Share can be cancelled by the user; don't show an error for that.
      console.debug("Snip share cancelled or unavailable", error);
    }
  }

  function showBanner(text) {
    document.querySelector(".snip-banner")?.remove();

    const banner = document.createElement("div");
    banner.className = "snip-banner";
    banner.textContent = text;

    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 4000);
  }

  async function runBackendSearch(query, root) {
    const status = root.querySelector(".snip-status");
    const button = root.querySelector(".snip-find");

    if (!query) return;

    const usage = await sendRuntimeMessage({ type: "SNIP_GET_USAGE" });
    if (!usage?.ok) {
      status.textContent = usage?.error || "Could not verify your Snip plan.";
      return;
    }
    if (usage.plan === "anonymous" && usage.remaining <= 0) {
      status.textContent = "Your 10 free searches are used. Sign up or log in to keep using Snip.";
      return;
    }
    if (usage.plan !== "anonymous" && usage.plan !== "unlimited" && usage.remaining <= 0) {
      root.querySelector(".snip-upgrade").hidden = false;
      status.textContent = "You’ve reached your Snip limit.";
      return;
    }

    status.textContent = "Snip is searching the page context…";
    button.disabled = true;
    clearHighlights();

    let pageBlocks = extractPageBlocks();
    if (pageBlocks.length === 0) {
      status.textContent = "Waiting for the page content to load…";
      await new Promise(resolve => setTimeout(resolve, 800));
      pageBlocks = extractPageBlocks();
    }
    if (pageBlocks.length === 0) {
      status.textContent = "Snip could not access readable content on this page.";
      button.disabled = false;
      return;
    }
    // Keep requests small enough for reliable serverless/model processing.
    // Rank blocks locally so relevant passages survive even on very long pages.
    const seenText = new Set();
    const uniqueBlocks = [];
    for (const block of pageBlocks) {
      const key = block.text.replace(/\s+/g, " ").trim().toLowerCase();
      if (seenText.has(key)) continue;
      seenText.add(key);
      uniqueBlocks.push(block);
    }

    const queryTerms = (query.toLowerCase().match(/[a-z0-9]{3,}/g) || [])
      .filter((term, i, arr) => arr.indexOf(term) === i);

    const scored = uniqueBlocks.map((block, index) => {
      const text = `${block.section} ${block.text}`.toLowerCase();
      let score = 0;

      for (const term of queryTerms) {
        if (text.includes(term)) score += 3;
      }

      // Strongly reward blocks that contain multiple question terms.
      const matchingTerms = queryTerms.filter(term => text.includes(term)).length;
      score += matchingTerms * 2;

      if (/^h[1-6]$/.test(block.kind)) score += 2;
      if (index < 8) score += 1;

      // Question-intent boosts: keep answer-bearing sentences from losing to
      // nearby context that merely shares a few topic words.
      const isDurationQuestion = /\bhow long\b|\bhow many (?:hours|minutes|days|weeks|months|years)\b/.test(query.toLowerCase());
      const isWhereQuestion = /\bwhere\b|\bwhere exactly\b/.test(query.toLowerCase());

      if (isDurationQuestion) {
        if (/\b(?:\d+(?:\.\d+|\s*1\/2)?|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty)\s*(?:hours?|minutes?|days?|weeks?|months?|years?)\b/i.test(block.text)) score += 12;
        if (/\b(?:for|after|more than|about|approximately|around)\b/i.test(block.text)) score += 2;
      }

      if (isWhereQuestion) {
        if (/\b(?:land(?:ed|ing)?|arriv(?:ed|al)|descended|located|reached|touched down|surface)\b/i.test(block.text)) score += 10;
        if (/\b(?:in|at|on)\s+(?:the\s+)?[A-Z][^.!?]{2,80}/.test(block.text)) score += 2;
      }

      return { block, index, score };
    });

    scored.sort((a, b) => b.score - a.score || a.index - b.index);

    // Keep the best semantic matches plus nearby blocks. We send the
    // highest-signal blocks first so the backend's context limit cannot
    // accidentally discard the most relevant passage just because it occurs
    // late on a long page.
    const selectedMap = new Map();

    const addBlock = block => {
      if (!block || selectedMap.has(block.id)) return;
      selectedMap.set(block.id, block);
    };

    const topMatches = scored.slice(0, 60);
    for (const item of topMatches) {
      addBlock(item.block);

      const pageIndex = pageBlocks.indexOf(item.block);
      if (pageIndex >= 0) {
        addBlock(pageBlocks[pageIndex - 1]);
        addBlock(pageBlocks[pageIndex + 1]);
      }
    }

    // If the page is small, preserve broad coverage.
    if (selectedMap.size < 20) {
      for (const block of uniqueBlocks) addBlock(block);
    }

    const selected = [...selectedMap.values()];
    const MAX_PAYLOAD_CHARS = 30000;
    let payloadChars = 0;
    const payloadBlocks = [];

    // Keep strongest matches first. This is intentional: the backend has its
    // own safety limit, so relevance must win over raw page order.
    const rankedSelected = selected
      .map(block => ({
        block,
        score: scored.find(item => item.block === block)?.score || 0,
        pageIndex: pageBlocks.indexOf(block)
      }))
      .sort((a, b) => b.score - a.score || a.pageIndex - b.pageIndex);

    for (const item of rankedSelected) {
      const block = item.block;
      if (payloadChars + block.text.length > MAX_PAYLOAD_CHARS) continue;

      payloadBlocks.push({
        id: block.id,
        index: block.index,
        text: block.text,
        kind: block.kind,
        section: block.section
      });

      payloadChars += block.text.length;
    }

    let reservationId = null;
    try {
      const reservation = await sendRuntimeMessage({ type: "SNIP_USAGE_RESERVE" });
      if (!reservation?.ok || !reservation.reservation_id) { status.textContent = reservation?.error || "Sign in to reserve a Snip search."; root.querySelector(".snip-upgrade").hidden = false; button.disabled = false; return; }
      reservationId = reservation.reservation_id;

      async function requestEvidence(blocks) {
        // Network requests go through the MV3 service worker, not the page-origin
        // content script, so host permissions—not the website's CORS policy—apply.
        const result = await sendRuntimeMessageWithTimeout({
          type: "SNIP_BACKEND_FIND",
          question: query,
          blocks,
          reservationId
        }, 35000);
        if (!result?.ok) throw new Error(result?.error || "Snip could not reach its AI service.");
        return result.data || {};
      }

      let data;
      const compact = payloadBlocks.slice(0, 40);

      try {
        data = await requestEvidence(payloadBlocks);
      } catch (firstError) {
        // Large/complex pages can still overwhelm a serverless/model request.
        // Retry once with a compact, high-signal subset before surfacing an error.
        if (compact.length >= payloadBlocks.length) throw firstError;
        data = await requestEvidence(compact);
      }

      let evidenceList = Array.isArray(data?.evidence)
        ? data.evidence
        : [];

      // A model request can succeed at the HTTP level but occasionally return
      // no evidence. Do not make the user press Find again: retry automatically
      // with the compact context, then make one final identical-context attempt.
      // This fixes intermittent first-attempt misses without changing retrieval
      // or highlight precision.
      if (evidenceList.length === 0) {
        try {
          const retryData = await requestEvidence(compact);
          evidenceList = Array.isArray(retryData?.evidence)
            ? retryData.evidence
            : [];
        } catch (retryError) {
          console.debug("Snip evidence retry failed", retryError);
        }
      }

      if (evidenceList.length === 0) {
        try {
          const finalData = await requestEvidence(compact);
          evidenceList = Array.isArray(finalData?.evidence)
            ? finalData.evidence
            : [];
        } catch (finalError) {
          console.debug("Snip final evidence retry failed", finalError);
        }
      }

      if (evidenceList.length === 0) {
        if (reservationId) await sendRuntimeMessage({ type: "SNIP_USAGE_RELEASE", reservationId }).catch(() => {});
        status.textContent = "I couldn't locate the exact text on this page.";
        button.disabled = false;
        return;
      }

      let highlightedCount = 0;
      let firstElement = null;

      const preparedEvidence = evidenceList
        .map(item => ({
          ...item,
          text: refineEvidencePhrase(
            String(item?.text || item?.passage || "").trim(),
            query
          )
        }))
        .filter(item => item.text);

      // Remove duplicate passages/blocks so one answer is never presented as
      // multiple sources. Preserve backend order for predictable navigation.
      const uniqueEvidence = [];
      const evidenceKeys = new Set();
      for (const item of preparedEvidence) {
        const key = `${item.block_id || item.block_index || ""}|${normalizeForAnchor(item.text)}`;
        if (evidenceKeys.has(key)) continue;
        evidenceKeys.add(key);
        uniqueEvidence.push(item);
      }

      for (const item of uniqueEvidence) {
        const evidenceText = item.text;
        if (!evidenceText) continue;

        // Prefer the exact block selected by the backend. If an ID was
        // normalized/changed in transit, fall back to searching every
        // extracted block for the returned verbatim passage.
        const exactBlock = pageBlocks.find(b =>
          b.id === item.block_id ||
          (item.block_index != null && b.index === Number(item.block_index))
        );
        const candidates = exactBlock
          ? [exactBlock, ...pageBlocks.filter(b => b !== exactBlock)]
          : pageBlocks;

        let matchedBlock = null;
        let success = false;

        for (const candidate of candidates) {
          if (anchorEvidence(candidate.element, evidenceText)) {
            matchedBlock = candidate;
            success = true;
            break;
          }
        }

        if (!success || !matchedBlock) continue;

        if (success) {
          highlightedCount++;

          if (!firstElement) {
            firstElement = matchedBlock.element;
          }
        }
      }

      if (highlightedCount > 0 && firstElement) {
        root.__snipEvidence = uniqueEvidence;
        root.__snipSourceIndex = 0;
        const share = root.querySelector(".snip-share");
        if (share) share.hidden = false;
        const sourceButton = root.querySelector(".snip-sources");
        if (sourceButton) {
          const otherCount = Math.max(0, uniqueEvidence.length - 1);
          sourceButton.hidden = otherCount === 0;
          sourceButton.textContent = `← 1 / ${uniqueEvidence.length} →`;
        }
        firstElement.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });

        const consumed = await sendRuntimeMessage({ type: "SNIP_USAGE_COMMIT", reservationId });
        if (!consumed?.ok || consumed.consumed === false) {
          if (reservationId) await sendRuntimeMessage({ type: "SNIP_USAGE_RELEASE", reservationId }).catch(() => {});
          status.textContent = "Your Snip limit was reached. Choose a plan to continue.";
          root.querySelector(".snip-upgrade").hidden = false;
          button.disabled = false;
          return;
        }

        const usage = root.querySelector(".snip-usage");
        if (usage) usage.textContent = formatUsage(consumed);
        if (consumed.remaining === 0 && consumed.plan === "anonymous") {
          status.textContent = "Your 10 free searches are complete. Sign up or log in to continue.";
        } else if (consumed.remaining === 0 && consumed.plan !== "unlimited") {
          root.querySelector(".snip-upgrade").hidden = false;
        }

        if (!(consumed.remaining === 0 && consumed.plan === "anonymous")) {
          status.textContent =
            `Found ${highlightedCount} relevant passage${highlightedCount === 1 ? "" : "s"}.`;
        }
        button.disabled = false;
        button.textContent = "Find again";
      } else {
        if (reservationId) await sendRuntimeMessage({ type: "SNIP_USAGE_RELEASE", reservationId });
        // The API guarantees verbatim evidence, so try a final pass against
        // the block's own visible text before giving up. This handles DOM
        // differences caused by citation widgets, links, and nested markup.
        let fallbackElement = null;
        for (const item of uniqueEvidence) {
          const block = pageBlocks.find(b =>
            b.id === item?.block_id ||
            (item?.block_index != null && b.index === Number(item.block_index))
          );
          if (!block) continue;
          const phrase = String(item.text || item.passage || "").trim();
          const normalizedPhrase = normalizeForAnchor(phrase);
          const normalizedBlock = normalizeForAnchor(block.text);
          if (normalizedPhrase && normalizedBlock.includes(normalizedPhrase)) {
            fallbackElement = block.element;
            break;
          }
        }

        if (fallbackElement) {
          fallbackElement.scrollIntoView({ behavior: "smooth", block: "center" });
          status.textContent = "Found the relevant passage, but the page markup prevented highlighting.";
        } else {
          status.textContent =
            "Found evidence references, but couldn't anchor them on page.";
        }
        button.disabled = false;
      }
    } catch (error) {
      if (reservationId) await sendRuntimeMessage({ type: "SNIP_USAGE_RELEASE", reservationId }).catch(() => {});
      console.error("Snip search error:", error);
      const message = String(error?.message || "");
      if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
        status.textContent = "Snip couldn't reach the AI service. Check your connection and try again.";
      } else if (/Backend request failed \(5\d\d\)/i.test(message)) {
        status.textContent = "Snip's AI service had a problem. Please try again.";
      } else {
        status.textContent = message || "Snip couldn't complete the search.";
      }
      button.disabled = false;
    }
  }

  chrome.runtime.onMessage.addListener(msg => {
    if (msg?.type === "TLDR_OPEN") {
      openPrompt();
    }
  });
})();
