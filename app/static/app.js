(() => {
  "use strict";

  let currentPage = "dashboard";
  let pageNavigationGeneration = 0;
  let selectedRange = "1Y";
  let isAllView = false;
  let editingTxnId = null;
  let editingAccountId = null;

  let txnsData = [];
  let transactionTypeFilter = "all";
  let budgetsData = [];
  let recurringData = [];
  let showArchivedRecurring = false;
  let budgetCategoryTotals = {};
  let accountsData = [];
  let accountsLoadPromise = null;
  let pendingCSVImport = null;
  let summaryData = {};
  let summaryAll = {};

  const API = window.FINANCEAI_API_URL || "";
  const APP_SCRIPT_URL = document.currentScript?.src || window.location.href;
  const APP_VERSION = new URL(APP_SCRIPT_URL, window.location.href).searchParams.get("v");
  let chartModulePromise = null;
  let chartWarningShown = false;
  let authSession = null;
  let authRefreshPromise = null;
  let authMode = "login";
  const CAT_COLORS = [
    "#22c55e", "#f59e0b", "#3b82f6", "#ef4444",
    "#a855f7", "#f97316", "#06b6d4", "#84cc16"
  ];
  const PAGE_FRAGMENTS = Object.freeze({
    transactions: "pages/transactions.html",
    budgets: "pages/budgets.html",
    recurring: "pages/recurring.html",
    "ai-page": "pages/ai.html"
  });
  const pageFragmentPromises = new Map();
  const integerNumberFormatter = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0
  });
  const decimalNumberFormatter = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const $ = id => document.getElementById(id);

  function chunkUrl(filename) {
    const url = new URL("./" + filename, APP_SCRIPT_URL);
    if (APP_VERSION) url.searchParams.set("v", APP_VERSION);
    return url.href;
  }

  async function ensurePageLoaded(name) {
    const mountedPage = $("page-" + name);
    if (mountedPage) return mountedPage;
    const fragmentPath = PAGE_FRAGMENTS[name];
    if (!fragmentPath) return null;

    let pagePromise = pageFragmentPromises.get(name);
    if (!pagePromise) {
      pagePromise = fetch(chunkUrl(fragmentPath))
        .then(response => {
          if (!response.ok) throw new Error(`Page request failed (${response.status}).`);
          return response.text();
        })
        .then(markup => {
          const template = document.createElement("template");
          template.innerHTML = markup.trim();
          const page = template.content.querySelector(".page");
          if (!page || page.id !== "page-" + name) {
            throw new Error("The page fragment has an invalid root element.");
          }
          $("content").appendChild(page);
          initializeLazyPage(name);
          return page;
        })
        .catch(error => {
          pageFragmentPromises.delete(name);
          throw error;
        });
      pageFragmentPromises.set(name, pagePromise);
    }
    return pagePromise;
  }

  function initializeLazyPage(name) {
    if (name === "transactions") {
      const date = $("t-date");
      if (date) date.value = new Date().toISOString().slice(0, 10);
    } else if (name === "recurring") {
      const nextDate = $("r-next-date");
      if (nextDate) nextDate.value = localDateValue();
    }
  }

  function loadChartModule() {
    if (!chartModulePromise) {
      chartModulePromise = import(chunkUrl("charts.js"))
        .catch(error => {
          chartModulePromise = null;
          throw error;
        });
    }
    return chartModulePromise;
  }

  function renderChartWhenReady(render) {
    void loadChartModule()
      .then(render)
      .catch(error => {
        if (chartWarningShown) return;
        chartWarningShown = true;
        console.warn("Charts are unavailable", error);
      });
  }

  const UI_ICONS = Object.freeze({
    transaction: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11v17l-2.75-1.7L12 20.5l-2.75-1.7-2.75 1.7v-17Z"/><path d="M9 8h6M9 11.5h6M9 15h4"/></svg>',
    budget: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v8.5h8.5"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5"/><path d="M4 20l4.5-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z"/></svg>'
  });

  const CATEGORY_EMOJIS = Object.freeze({
    bills: "💳",
    education: "🎓",
    entertainment: "🎮",
    food: "🍽️",
    food_drink: "🍽️",
    food_delivery: "🍔",
    groceries: "🛒",
    grocery: "🛒",
    gifts: "🎁",
    health: "💊",
    medical: "💊",
    miscellaneous: "📦",
    personal_care: "🧴",
    rent: "🏠",
    housing: "🏠",
    salary: "💵",
    income: "💰",
    savings: "🐷",
    shopping: "🛍️",
    subscriptions: "📺",
    transport: "🚗",
    travel: "✈️",
    utilities: "⚡",
    utility: "⚡",
    investment: "📈",
    insurance: "🛡️",
    loan: "🏦",
    fuel: "⛽",
    pets: "🐾",
    childcare: "🧸",
    taxes: "🧾",
    uncategorized: "🧾"
  });

  function getCategoryEmoji(category, type = "expense") {
    const key = String(category || "")
      .trim()
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    if (CATEGORY_EMOJIS[key]) return CATEGORY_EMOJIS[key];

    if (/grocery|groceries|supermarket|produce/.test(key)) return "🛒";
    if (/food|restaurant|dining|cafe|coffee|meal/.test(key)) return "🍽️";
    if (/health|medical|doctor|pharmacy|dental|hospital/.test(key)) return "💊";
    if (/travel|flight|airfare|hotel|holiday|vacation/.test(key)) return "✈️";
    if (/utility|electric|water|internet|mobile|recharge/.test(key)) return "⚡";
    if (/rent|housing|home|household/.test(key)) return "🏠";
    if (/education|school|college|course|tuition|books/.test(key)) return "🎓";
    if (/entertainment|gaming|game|movie|streaming/.test(key)) return "🎮";
    if (/bill|card|emi|loan|bank/.test(key)) return "💳";
    if (/salary|payroll|wage|income|deposit/.test(key)) return "💵";
    if (/shopping|clothes|apparel|fashion/.test(key)) return "🛍️";
    if (/transport|fuel|petrol|diesel|cab|taxi|vehicle/.test(key)) return "🚗";
    if (/gift|donation|charity/.test(key)) return "🎁";
    if (/subscription/.test(key)) return "📺";

    return type === "income" ? "💰" : "🧾";
  }

  function setUiIcon(element, name) {
    if (element) element.innerHTML = UI_ICONS[name] || UI_ICONS.transaction;
  }

  function fmt(value) {
    const n = Number(value);
    return "₹" + integerNumberFormatter.format(Number.isFinite(n) ? n : 0);
  }

  function fmtDec(value) {
    const n = Number(value);
    return "₹" + decimalNumberFormatter.format(Number.isFinite(n) ? n : 0);
  }

  function hasUsableAuthSession(session) {
    return Boolean(
      session &&
      typeof session.access_token === "string" &&
      session.access_token.trim().length > 0 &&
      typeof session.refresh_token === "string" &&
      session.refresh_token.trim().length >= 20
    );
  }

  function setAuthSession(session) {
    authSession = session;
    if (session) {
      localStorage.setItem("financeai.auth.session", JSON.stringify(session));
    } else {
      localStorage.removeItem("financeai.auth.session");
    }
    updateUserUI();
  }

  function clearAuthSession() {
    setAuthSession(null);
  }

  // Keep the in-memory session aligned with the rotating refresh token stored
  // by another FinanceAI tab or installed PWA window.
  window.addEventListener("storage", event => {
    if (event.key !== "financeai.auth.session") return;
    if (!event.newValue) {
      authSession = null;
      updateUserUI();
      return;
    }
    try {
      const nextSession = JSON.parse(event.newValue);
      if (hasUsableAuthSession(nextSession)) {
        authSession = nextSession;
        updateUserUI();
      }
    } catch (_) {
      // Ignore malformed cross-tab updates; startup validation handles storage.
    }
  });

  function updateUserUI() {
    const user = authSession?.user || {};
    const metadata = user.user_metadata || {};
    const name = metadata.full_name || metadata.name || user.email || "Finance User";
    const email = user.email || "Private workspace";
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "FA";
    const nameEl = $("user-name");
    const emailEl = $("user-email");
    const menuEmail = $("profile-menu-email");
    const avatarEl = $("user-avatar");
    if (nameEl) nameEl.textContent = name;
    if (emailEl) emailEl.textContent = email;
    if (menuEmail) menuEmail.textContent = email;
    if (avatarEl) avatarEl.textContent = initials;
  }

  function showAuthError(message) {
    const error = $("auth-error");
    const success = $("auth-success");
    if (error) {
      error.hidden = !message;
      error.textContent = message || "";
    }
    if (success) success.hidden = true;
  }

  function showAuthSuccess(message) {
    const error = $("auth-error");
    const success = $("auth-success");
    if (error) error.hidden = true;
    if (success) {
      success.hidden = !message;
      success.textContent = message || "";
    }
  }

  function setAuthMode(mode) {
    authMode = mode;
    const signup = mode === "signup";
    const recovery = mode === "recovery";
    const title = $("auth-title");
    const subtitle = $("auth-subtitle");
    const nameWrap = $("auth-name-wrap");
    const nameInput = $("auth-name");
    const passwordInput = $("auth-password");
    const submit = $("auth-submit");
    const toggle = $("auth-toggle");

    if (title) title.textContent = signup ? "Create your account" : recovery ? "Reset your password" : "Welcome back";
    if (subtitle) {
      subtitle.textContent = signup
        ? "Create your private FinanceAI workspace."
        : recovery
          ? "Choose a new password for your FinanceAI account."
          : "Sign in to your private FinanceAI workspace.";
    }
    if (nameWrap) nameWrap.hidden = !signup;
    if (nameInput) nameInput.required = signup;
    if (passwordInput) {
      passwordInput.autocomplete = (signup || recovery) ? "new-password" : "current-password";
      passwordInput.placeholder = (signup || recovery) ? "8+ characters, number and symbol" : "Your password";
    }
    $("auth-password-rules")?.toggleAttribute("hidden", !(signup || recovery));
    $("auth-forgot")?.toggleAttribute("hidden", signup || recovery);
    $("auth-google")?.toggleAttribute("hidden", recovery);
    if (toggle) toggle.hidden = recovery;
    updatePasswordRules();
    if (submit) submit.textContent = signup ? "Create account" : recovery ? "Update password" : "Sign in";
    if (toggle && !recovery) {
      toggle.textContent = signup
        ? "Already have an account? Sign in"
        : "New to FinanceAI? Create an account";
    }
    showAuthError("");
    showAuthSuccess("");
  }

  function passwordChecks(value) {
    return {
      length: value.length >= 8,
      number: /\d/.test(value),
      special: /[^A-Za-z0-9\s]/.test(value),
    };
  }

  function updatePasswordRules() {
    const input = $("auth-password");
    const rules = $("auth-password-rules");
    if (!input || !rules) return;
    const checks = passwordChecks(input.value);
    Object.entries(checks).forEach(([name, valid]) => {
      const item = rules.querySelector('[data-rule="' + name + '"]');
      if (!item) return;
      item.dataset.valid = valid ? "true" : "false";
      const labels = {
        length: "At least 8 characters",
        number: "At least one number",
        special: "At least one special character",
      };
      item.textContent = (valid ? "✓ " : "○ ") + labels[name];
    });
  }

  async function requestPasswordRecovery() {
    const email = $("auth-email")?.value.trim().toLowerCase() || "";
    if (!email) {
      showAuthError("Enter your email address first.");
      $("auth-email")?.focus();
      return;
    }
    const button = $("auth-forgot");
    if (button) button.disabled = true;
    try {
      await authRequest("/auth/password/recovery", { email });
      showAuthSuccess("If that email is registered, a password recovery link has been sent.");
    } catch (error) {
      showAuthError(error instanceof Error ? error.message : "Could not request password recovery.");
    } finally {
      if (button) button.disabled = false;
    }
  }

  function showAuthScreen(message = "") {
    $("app-shell")?.setAttribute("hidden", "");
    $("auth-screen")?.removeAttribute("hidden");
    if (message) showAuthError(message);
    setAuthMode(authMode);
  }

  function showAppShell() {
    $("auth-screen")?.setAttribute("hidden", "");
    $("app-shell")?.removeAttribute("hidden");
    updateUserUI();
  }

  function readableAuthError(payload, fallback) {
    const value = payload && typeof payload === "object" ? payload : {};
    const detail = value.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map(item => {
        if (item && typeof item === "object" && item.msg) return String(item.msg);
        return "Invalid input";
      }).join("; ");
    }
    if (detail && typeof detail === "object") {
      return String(detail.message || detail.msg || detail.error || fallback);
    }
    return String(value.message || value.error_description || value.msg || fallback);
  }

  async function authRequest(path, payload) {
    const response = await fetch(API + path, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let data = {};
      try { data = await response.json(); } catch (_) {}
      const error = new Error(readableAuthError(data, response.statusText || "Authentication failed"));
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async function refreshAuthSession() {
    if (authRefreshPromise) return authRefreshPromise;
    authRefreshPromise = (async () => {
      const refreshWithLatestStoredSession = async () => {
        // Another tab may already have rotated the refresh token. Always prefer
        // the newest persisted session before attempting a refresh.
        let latest = authSession;
        try {
          const stored = localStorage.getItem("financeai.auth.session");
          if (stored) {
            const parsed = JSON.parse(stored);
            if (hasUsableAuthSession(parsed)) latest = parsed;
          }
        } catch (_) {
          // Fall back to the validated in-memory session.
        }
        if (latest && latest.refresh_token !== authSession?.refresh_token) {
          authSession = latest;
          updateUserUI();
        }
        const refreshToken = typeof latest?.refresh_token === "string"
          ? latest.refresh_token.trim()
          : "";
        if (refreshToken.length < 20) {
          clearAuthSession();
          return false;
        }

        let response;
        try {
          response = await fetch(API + "/auth/refresh", {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refreshToken }),
          });
        } catch (_) {
          const error = new Error("FinanceAI is temporarily unreachable. Your saved session has been kept.");
          error.status = 0;
          throw error;
        }

        if (response.status === 400 || response.status === 401 || response.status === 422) {
          // Do not erase a newer token written by another tab while this request
          // was in flight.
          let storedToken = "";
          try {
            storedToken = JSON.parse(localStorage.getItem("financeai.auth.session") || "{}").refresh_token || "";
          } catch (_) {}
          if (storedToken && storedToken !== refreshToken) {
            const newer = JSON.parse(localStorage.getItem("financeai.auth.session"));
            if (hasUsableAuthSession(newer)) {
              authSession = newer;
              updateUserUI();
              return true;
            }
          }
          clearAuthSession();
          return false;
        }
        if (!response.ok) {
          let data = {};
          try { data = await response.json(); } catch (_) {}
          const error = new Error(readableAuthError(data, response.statusText || "Could not refresh your session."));
          error.status = response.status;
          throw error;
        }

        const next = await response.json();
        if (!next.access_token || !next.refresh_token) {
          const error = new Error("The session refresh response was incomplete.");
          error.status = 502;
          throw error;
        }
        setAuthSession(next);
        return true;
      };

      // Web Locks serialize refresh-token rotation across same-origin PWA tabs.
      if (navigator.locks?.request) {
        return navigator.locks.request("financeai-auth-refresh", refreshWithLatestStoredSession);
      }
      return refreshWithLatestStoredSession();
    })();

    try {
      return await authRefreshPromise;
    } finally {
      authRefreshPromise = null;
    }
  }

  async function apiResponse(path, options = {}, retryOnUnauthorized = true) {
    const headers = {
      Accept: "application/json",
      ...(options.headers || {}),
    };
    if (authSession?.access_token) {
      headers.Authorization = "Bearer " + authSession.access_token;
    }

    const response = await fetch(API + path, { ...options, headers });
    const canRefresh = !path.startsWith("/auth/") || path === "/auth/me";
    if (response.status === 401 && retryOnUnauthorized && canRefresh && authSession?.refresh_token) {
      const refreshed = await refreshAuthSession();
      if (refreshed) return apiResponse(path, options, false);
      showAuthScreen("Your session has expired. Please sign in again.");
      const error = new Error("Authentication required");
      error.status = 401;
      throw error;
    }
    return response;
  }

  async function apiFetch(path, options = {}, retryOnUnauthorized = true) {
    const response = await apiResponse(path, options, retryOnUnauthorized);
    if (!response.ok) {
      let payload = {};
      try { payload = await response.json(); } catch (_) {}
      const error = new Error(readableAuthError(payload, response.statusText || "Request failed"));
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return undefined;
    return response.json();
  }

  async function submitAuth(event) {
    event.preventDefault();
    const email = $("auth-email")?.value.trim().toLowerCase() || "";
    const password = $("auth-password")?.value || "";
    const name = $("auth-name")?.value.trim() || "";

    if (!email || !password || (authMode === "signup" && name.length < 2)) {
      showAuthError(authMode === "signup" ? "Enter your name, email and password." : "Enter your email and password.");
      return;
    }
    if (authMode === "signup" || authMode === "recovery") {
      const checks = passwordChecks(password);
      if (!checks.length || !checks.number || !checks.special) {
        showAuthError("Use at least 8 characters, including one number and one special character.");
        return;
      }
    }

    const button = $("auth-submit");
    if (button) {
      button.disabled = true;
      button.textContent = authMode === "signup" ? "Creating account…" : authMode === "recovery" ? "Updating password…" : "Signing in…";
    }

    try {
      showAuthError("");
      showAuthSuccess("");
      if (authMode === "recovery") {
        await apiFetch("/auth/password/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        clearAuthSession();
        $("auth-password").value = "";
        setAuthMode("login");
        showAuthSuccess("Your password has been updated. Sign in with your new password.");
        return;
      }
      const result = await authRequest(
        authMode === "signup" ? "/auth/signup" : "/auth/login",
        authMode === "signup" ? { email, password, name } : { email, password },
      );

      if (!result.access_token || !result.refresh_token) {
        setAuthMode("login");
        showAuthSuccess("Account created. Check your email to confirm it, then sign in.");
        $("auth-password").value = "";
        return;
      }

      setAuthSession(result);
      showAppShell();
      init();
    } catch (error) {
      showAuthError(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = authMode === "signup" ? "Create account" : authMode === "recovery" ? "Update password" : "Sign in";
      }
    }
  }

  async function logout() {
    try {
      if (authSession?.access_token) {
        await fetch(API + "/auth/logout", {
          method: "POST",
          headers: { Accept: "application/json", Authorization: "Bearer " + authSession.access_token },
        });
      }
    } catch (_) {}
    clearAuthSession();
    window.location.reload();
  }

  function base64UrlEncode(bytes) {
    let binary = "";
    bytes.forEach(value => { binary += String.fromCharCode(value); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function signInWithGoogle() {
    const button = $("auth-google");
    if (button) {
      button.disabled = true;
      button.textContent = "Connecting to Google…";
    }

    try {
      if (!window.crypto?.subtle || !window.crypto?.getRandomValues) {
        throw new Error("This browser does not support secure Google sign-in.");
      }

      const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
      const verifier = base64UrlEncode(verifierBytes);
      const challengeDigest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier),
      );
      const challenge = base64UrlEncode(new Uint8Array(challengeDigest));

      sessionStorage.setItem("financeai.google.pkce.verifier", verifier);
      const result = await authRequest("/auth/google/start", {
        code_challenge: challenge,
      });
      if (!result.url) throw new Error("Supabase did not return a Google authorization URL.");
      window.location.assign(result.url);
    } catch (error) {
      sessionStorage.removeItem("financeai.google.pkce.verifier");
      showAuthError(error instanceof Error ? error.message : "Google sign-in could not be started.");
      if (button) {
        button.disabled = false;
        button.innerHTML = '<span class="google-symbol" aria-hidden="true">G</span> Continue with Google';
      }
    }
  }

  async function handleGoogleOAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const oauthCode = params.get("code");
    const oauthError = params.get("error_description") || params.get("error");
    const tokenHash = params.get("token_hash");
    const verificationType = params.get("type");
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const fragmentRefreshToken = fragment.get("refresh_token");
    const fragmentType = fragment.get("type") || verificationType;

    if (!oauthCode && !oauthError && !tokenHash && !fragmentRefreshToken) return false;

    window.history.replaceState({}, document.title, window.location.pathname);

    if (oauthError) {
      sessionStorage.removeItem("financeai.google.pkce.verifier");
      showAuthScreen(oauthError);
      return true;
    }

    if (fragmentRefreshToken) {
      try {
        const result = await authRequest("/auth/refresh", {
          refresh_token: fragmentRefreshToken,
        });
        if (!result.access_token || !result.refresh_token) {
          throw new Error("Email confirmation did not create an active session.");
        }
        if (fragmentType === "recovery") {
          authSession = result;
          setAuthMode("recovery");
          showAuthScreen();
          showAuthSuccess("Your recovery link is verified. Choose a new password.");
        } else {
          setAuthSession(result);
          showAppShell();
          init();
        }
      } catch (error) {
        showAuthScreen(error instanceof Error ? error.message : "Email verification failed.");
      }
      return true;
    }

    if (tokenHash && verificationType) {
      try {
        const result = await authRequest("/auth/email/verify", {
          token_hash: tokenHash,
          type: verificationType,
        });
        if (verificationType === "recovery") {
          if (!result.access_token) throw new Error("The recovery link did not create a reset session.");
          authSession = result;
          setAuthMode("recovery");
          showAuthScreen();
          showAuthSuccess("Email verified. Choose a new password below.");
        } else if (result.access_token && result.refresh_token) {
          setAuthSession(result);
          showAppShell();
          init();
        } else {
          showAuthScreen();
          showAuthSuccess("Your email is verified. You can now sign in.");
        }
      } catch (error) {
        showAuthScreen(error instanceof Error ? error.message : "Email verification failed.");
      }
      return true;
    }

    const verifier = sessionStorage.getItem("financeai.google.pkce.verifier");
    sessionStorage.removeItem("financeai.google.pkce.verifier");
    if (!verifier) {
      showAuthScreen("Google sign-in expired. Please try again.");
      return true;
    }

    try {
      const result = await authRequest("/auth/google/exchange", {
        auth_code: oauthCode,
        code_verifier: verifier,
      });
      if (!result.access_token || !result.refresh_token) {
        throw new Error("Google sign-in completed without a FinanceAI session.");
      }
      setAuthSession(result);
      showAppShell();
      init();
    } catch (error) {
      showAuthScreen(error instanceof Error ? error.message : "Google sign-in failed.");
    }
    return true;
  }

  async function initAuth() {
    if (await handleGoogleOAuthCallback()) return;

    try {
      let invalidStoredSession = false;
      const storedAtStartup = localStorage.getItem("financeai.auth.session");
      if (storedAtStartup) {
        try {
          const savedSession = JSON.parse(storedAtStartup);
          if (hasUsableAuthSession(savedSession)) {
            authSession = savedSession;
          } else {
            clearAuthSession();
            invalidStoredSession = true;
          }
        } catch (_) {
          clearAuthSession();
          invalidStoredSession = true;
        }
      }

      const response = await fetch(API + "/auth/config");
      if (!response.ok) throw new Error("Cannot load authentication configuration.");
      const config = await response.json();

      if (!config.required) {
        showAppShell();
        init();
        return;
      }

      if (invalidStoredSession) {
        showAuthScreen("Your saved sign-in is incomplete or invalid. Please sign in again.");
        return;
      }

      if (authSession) {
        try {
          await apiFetch("/auth/me");
        } catch (error) {
          if (error.status === 401) {
            clearAuthSession();
            showAuthScreen("Your session has expired. Please sign in again.");
            return;
          }
          // Keep a well-formed saved session during temporary API outages.
        }
        updateUserUI();
        showAppShell();
        init();
        return;
      }

      showAuthScreen();
    } catch (error) {
      if (authSession?.refresh_token) {
        // Do not turn a temporary backend outage into an apparent logout.
        updateUserUI();
        showAppShell();
        init();
        showToast("FinanceAI is offline. Your saved session is still available.", "error");
      } else {
        showAuthScreen(error instanceof Error ? error.message : "Cannot connect to FinanceAI.");
      }
    }
  }

  function showToast(message, type = "success") {
    let toast = $("app-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "app-toast";
      toast.style.cssText = [
        "position:fixed", "bottom:24px", "left:50%",
        "transform:translateX(-50%) translateY(80px)",
        "background:var(--bg3)", "color:var(--text)",
        "padding:10px 22px", "border-radius:10px",
        "font-size:13px", "z-index:9999",
        "transition:transform .3s ease,opacity .3s ease",
        "opacity:0", "pointer-events:none",
        "border:1px solid var(--border2)",
        "box-shadow:0 4px 20px rgba(0,0,0,.3)"
      ].join(";");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.borderColor = type === "error" ? "var(--red)" : "var(--green)";
    toast.style.color = type === "error" ? "var(--red)" : "var(--text)";
    toast.style.transform = "translateX(-50%) translateY(0)";
    toast.style.opacity = "1";
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.transform = "translateX(-50%) translateY(80px)";
      toast.style.opacity = "0";
    }, 3200);
  }

  function syncTopbarRangeButtons() {
    const monthButton = $("topbar-month-btn");
    const allButton = $("topbar-all-btn");
    const monthSelected = selectedRange === "1M";
    const allSelected = selectedRange === "All";
    monthButton?.classList.toggle("active", monthSelected);
    allButton?.classList.toggle("active", allSelected);
    monthButton?.setAttribute("aria-pressed", String(monthSelected));
    allButton?.setAttribute("aria-pressed", String(allSelected));
  }
  function hashColor(value) {
    const colors = [
      "239,68,68", "245,158,11", "59,130,246",
      "168,85,247", "249,115,22", "6,182,212"
    ];
    let hash = 0;
    for (const char of String(value || "")) {
      hash = (hash << 5) - hash + char.charCodeAt(0);
      hash |= 0;
    }
    return colors[Math.abs(hash) % colors.length];
  }

  function getAccountName(id) {
    const account = accountsData.find(item => item.id === id);
    return account ? account.name : "";
  }

  function calcChange(current, previous) {
    const c = Number(current) || 0;
    const p = Number(previous) || 0;
    return p === 0 ? 0 : ((c - p) / Math.abs(p)) * 100;
  }

  function updateBadge(id, value) {
    const element = $(id);
    if (!element) return;

    const numeric = Number(value);
    const rounded = Math.round(Number.isFinite(numeric) ? numeric : 0);

    if (rounded === 0) {
      element.textContent = "";
      element.style.display = "none";
      element.classList.remove("up", "down");
      return;
    }

    element.style.display = "";
    element.classList.remove("up", "down");
    element.textContent = rounded > 0 ? `+${rounded}%` : `${rounded}%`;
    if (rounded > 0) element.classList.add("up");
    if (rounded < 0) element.classList.add("down");
  }

  function buildSpark(monthly, field) {
    return Object.keys(monthly || {})
      .sort()
      .map(month => Number(monthly[month]?.[field] || 0));
  }

  function makeSparkline(id, values, color) {
    renderChartWhenReady(charts => charts.renderSparkline(id, values, color));
  }

  function renderCashflowChart(monthly) {
    const canvas = $("cashflowChart");
    if (!canvas) return;
    renderChartWhenReady(charts => charts.renderCashflow(canvas, monthly, fmt));
  }

  function getFilteredTransactions() {
    const now = new Date();
    if (selectedRange === "All") return txnsData;

    const months = selectedRange === "3M" ? 3 :
      selectedRange === "6M" ? 6 :
      selectedRange === "1Y" ? 12 : 1;

    const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    return txnsData.filter(txn => {
      const date = new Date(txn.date + "T00:00:00");
      return date >= start && date <= now;
    });
  }

  function getCategoryTotals(transactions) {
    const totals = {};
    transactions.forEach(txn => {
      if (txn.type !== "expense") return;
      const category = txn.category || "Other";
      totals[category] = (totals[category] || 0) + Number(txn.amount || 0);
    });
    return totals;
  }

  function renderCatChart(categories) {
    const canvas = $("catChart");
    const entries = Object.entries(categories || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    const list = $("cat-list");
    if (list) {
      while (list.firstChild) list.removeChild(list.firstChild);
      if (!entries.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "No expense data for this period";
        list.appendChild(empty);
      } else {
        const total = entries.reduce((sum, [, amount]) => sum + Number(amount), 0);
        entries.forEach(([category, amount], index) => {
          const row = document.createElement("div");
          row.className = "cat-row";
          const name = document.createElement("span");
          name.className = "cat-name";
          const dot = document.createElement("span");
          dot.className = "cat-dot";
          dot.style.background = CAT_COLORS[index];
          name.append(dot, document.createTextNode(category));
          const pct = document.createElement("span");
          pct.className = "cat-pct";
          pct.textContent = total ? Math.round(amount / total * 100) + "%" : "0%";
          const value = document.createElement("span");
          value.className = "cat-amount";
          value.textContent = fmt(amount);
          row.append(name, pct, value);
          list.appendChild(row);
        });
      }
    }

    if (!canvas || !entries.length) return;
    renderChartWhenReady(charts => charts.renderCategories(canvas, entries, CAT_COLORS));
  }

  function renderInsightsCard() {
    const list = $("insights-list");
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);

    const income = Number(summaryData.income || 0);
    const expense = Number(summaryData.expense || 0);
    const savings = Number(summaryData.savings_rate || 0);
    const categories = summaryData.category_totals || {};
    const top = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];

    const items = [];
    if (top && income > 0) {
      const potential = Math.max(0, Number(top[1]) * .15);
      items.push({
        type: "warn",
        icon: "⚡",
        title: `Potential saving: ${fmt(potential)}`,
        body: `${top[0]} is your largest expense category. Cutting it by 15% would free about ${fmt(potential)}.`
      });
    }
    items.push({
      type: savings >= 20 ? "ok" : "warn",
      icon: savings >= 20 ? "📊" : "⚠️",
      title: savings >= 20 ? "Savings rate is on track" : "Savings rate needs attention",
      body: `${savings.toFixed(1)}% of income is currently retained after expenses.`
    });

    items.forEach(item => {
      const wrap = document.createElement("div");
      wrap.className = "insight-item";
      const header = document.createElement("div");
      header.className = "insight-item-header";
      const icon = document.createElement("div");
      icon.className = `insight-bullet ${item.type}`;
      icon.textContent = item.icon;
      const body = document.createElement("div");
      const title = document.createElement("div");
      title.className = "insight-text-title";
      title.textContent = item.title;
      const description = document.createElement("div");
      description.className = "insight-text-body";
      description.textContent = item.body;
      body.append(title, description);
      header.append(icon, body);
      wrap.appendChild(header);
      list.appendChild(wrap);
    });
  }

  function updateBudgetUI() {
    renderBudgetContainer($("budget-items"), budgetCategoryTotals, false);
    renderBudgetContainer($("budget-page-list"), budgetCategoryTotals, true);
  }

  function renderBudgetContainer(container, categories, detailed) {
    if (!container) return;
    container.replaceChildren();

    if (!budgetsData.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No budgets set";
      container.appendChild(empty);
      return;
    }

    budgetsData.forEach(budget => {
      const spent = Number(categories[budget.category] || 0);
      const limit = Number(budget.limit_amt || 0);
      const pct = limit > 0 ? (spent / limit) * 100 : 0;
      const barPct = Math.min(100, Math.max(0, pct));
      const over = limit > 0 && spent > limit;
      const reached = limit > 0 && !over && spent >= limit;

      const item = document.createElement("div");
      item.className = detailed ? "budget-page-item" : "budget-item";

      const header = document.createElement("div");
      header.className = detailed ? "bpi-header" : "budget-item-header";

      const left = document.createElement("div");
      left.className = detailed ? "" : "budget-item-left";
      left.style.display = "flex";
      left.style.alignItems = "center";
      left.style.gap = "10px";
      left.style.minWidth = "0";

      const icon = document.createElement("div");
      icon.className = "budget-icon";
      icon.textContent = getCategoryEmoji(budget.category);
      icon.setAttribute("role", "img");
      icon.setAttribute("aria-label", `${budget.category} category`);
      const name = document.createElement("span");
      name.className = detailed ? "bpi-name" : "budget-name";
      name.textContent = budget.category;
      left.append(icon, name);

      if (detailed) {
        const remove = document.createElement("button");
        remove.className = "del-btn";
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${budget.category} budget`);
        remove.addEventListener("click", () => deleteBudget(budget.category));
        header.append(left, remove);
      } else {
        const amount = document.createElement("div");
        amount.className = `budget-amounts ${over ? "over" : "ok"}`;
        const main = document.createElement("div");
        main.className = "amount-main";
        main.textContent = `${fmt(spent)} / ${fmt(limit)}`;
        const sub = document.createElement("div");
        sub.className = "amount-sub";
        sub.textContent = over
          ? `Over by ${fmt(spent - limit)}`
          : reached
            ? "Monthly limit reached"
            : `Remaining ${fmt(limit - spent)}`;
        amount.append(main, sub);
        header.append(left, amount);
      }

      const bar = document.createElement("div");
      bar.className = "budget-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", `${budget.category} budget this month`);
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", barPct.toFixed(1));
      bar.setAttribute("aria-valuetext", `${pct.toFixed(0)}% of monthly limit used`);

      const fill = document.createElement("div");
      fill.className = `budget-fill ${over ? "red" : reached || pct >= 80 ? "yellow" : "green"}`;
      fill.style.width = barPct.toFixed(1) + "%";
      bar.appendChild(fill);

      item.appendChild(header);
      if (detailed) {
        const amounts = document.createElement("div");
        amounts.className = "bpi-amounts";

        const spentBlock = document.createElement("div");
        spentBlock.className = "bpi-amount";
        const spentLabel = document.createElement("span");
        spentLabel.className = "bpi-amount-label";
        spentLabel.textContent = "Spent this month";
        const spentValue = document.createElement("strong");
        spentValue.textContent = fmt(spent);
        spentBlock.append(spentLabel, spentValue);

        const limitBlock = document.createElement("div");
        limitBlock.className = "bpi-amount";
        const limitLabel = document.createElement("span");
        limitLabel.className = "bpi-amount-label";
        limitLabel.textContent = "Monthly limit";
        const limitValue = document.createElement("strong");
        limitValue.textContent = fmt(limit);
        limitBlock.append(limitLabel, limitValue);

        amounts.append(spentBlock, limitBlock);
        item.appendChild(amounts);
      }
      item.appendChild(bar);

      if (detailed) {
        const status = document.createElement("div");
        status.className = `budget-status ${over ? "over" : reached ? "reached" : ""}`;
        status.textContent = over
          ? `${pct.toFixed(0)}% used · Over budget by ${fmt(spent - limit)}`
          : reached
            ? "100% used · Monthly limit reached"
            : `${pct.toFixed(0)}% of monthly limit used · ${fmt(limit - spent)} remaining`;
        item.appendChild(status);
      }
      container.appendChild(item);
    });
  }

  function setTransactionTypeFilter(type) {
    if (!["all", "income", "expense"].includes(type)) return;

    transactionTypeFilter = type;
    document.querySelectorAll(".txn-filter-btn").forEach(button => {
      const selected = button.dataset.filter === type;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });

    renderTransactions();
  }

  function renderTransactions() {
    const container = $("all-txns");
    if (!container) return;
    const search = ($("search-input")?.value || "").trim().toLowerCase();
    let filtered = txnsData;

    if (transactionTypeFilter !== "all") {
      filtered = filtered.filter(txn => String(txn.type || "").toLowerCase() === transactionTypeFilter);
    }

    if (search) {
      filtered = filtered.filter(txn =>
        String(txn.description || "").toLowerCase().includes(search) ||
        String(txn.category || "").toLowerCase().includes(search)
      );
    }

    while (container.firstChild) container.removeChild(container.firstChild);
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No transactions found";
      container.appendChild(empty);
      return;
    }

    filtered.forEach(txn => {
      const row = document.createElement("div");
      row.className = "full-txn-item";

      const icon = document.createElement("div");
      icon.className = "txn-icon";
      icon.style.background = txn.type === "income"
        ? "rgba(34,197,94,.1)"
        : `rgba(${hashColor(txn.category)},.1)`;
      icon.textContent = getCategoryEmoji(txn.category, txn.type);
      icon.setAttribute("role", "img");
      icon.setAttribute("aria-label", `${txn.category || "Transaction"} category`);

      const info = document.createElement("div");
      info.className = "txn-info";
      const title = document.createElement("div");
      title.className = "txn-name";
      title.textContent = txn.description || txn.category || "Transaction";
      const meta = document.createElement("div");
      meta.className = "txn-meta";
      const account = getAccountName(txn.account_id);
      meta.textContent = [txn.category, account, txn.date].filter(Boolean).join(", ");
      info.append(title, meta);

      const category = document.createElement("span");
      category.className = "cat-badge";
      category.style.cssText = "background:var(--bg3);color:var(--text2);padding:3px 8px;border-radius:5px;font-size:11px";
      category.textContent = txn.category || "";

      const amount = document.createElement("span");
      amount.className = `txn-amount ${txn.type === "income" ? "inc" : "exp"}`;
      amount.textContent = (txn.type === "income" ? "+" : "-") + fmtDec(txn.amount);

      const edit = document.createElement("button");
      edit.className = "edit-btn";
      edit.type = "button";
      edit.setAttribute("aria-label", "Edit transaction");
      edit.title = "Edit";
      setUiIcon(edit, "edit");
      edit.addEventListener("click", () => openEditModal(txn.id));

      const del = document.createElement("button");
      del.className = "del-btn";
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteTxn(txn.id));

      const actions = document.createElement("div");
      actions.className = "txn-row-actions";
      actions.append(edit, del);

      row.append(icon, info, category, amount, actions);
      container.appendChild(row);
    });
  }

  function renderRecentTransactions(transactions) {
    const container = $("recent-txns");
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);

    if (!transactions.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No transactions yet";
      container.appendChild(empty);
      return;
    }

    transactions.slice(0, 6).forEach(txn => {
      const row = document.createElement("div");
      row.className = "txn-item";

      const icon = document.createElement("div");
      icon.className = "txn-icon";
      icon.style.background = txn.type === "income"
        ? "rgba(34,197,94,.1)"
        : `rgba(${hashColor(txn.category)},.1)`;
      icon.textContent = getCategoryEmoji(txn.category, txn.type);
      icon.setAttribute("role", "img");
      icon.setAttribute("aria-label", `${txn.category || "Transaction"} category`);

      const info = document.createElement("div");
      info.className = "txn-info";
      const title = document.createElement("div");
      title.className = "txn-name";
      title.textContent = txn.description || txn.category || "Transaction";
      const meta = document.createElement("div");
      meta.className = "txn-meta";
      const account = getAccountName(txn.account_id);
      meta.textContent = `${txn.category || ""}${account ? " · " + account : ""} • ${txn.date || ""}`;
      info.append(title, meta);

      const amount = document.createElement("span");
      amount.className = `txn-amount ${txn.type === "income" ? "inc" : "exp"}`;
      amount.textContent = (txn.type === "income" ? "+" : "-") + fmtDec(txn.amount);

      row.append(icon, info, amount);
      container.appendChild(row);
    });
  }

  function renderAccounts() {
    const container = $("accounts-list");
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);

    if (!accountsData.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No accounts yet";
      container.appendChild(empty);
      return;
    }

    accountsData.forEach(account => {
      const card = document.createElement("div");
      card.className = "account-card";

      const top = document.createElement("div");
      top.className = "account-top";
      const name = document.createElement("span");
      name.className = "account-name";
      name.textContent = account.name;
      const type = document.createElement("span");
      type.className = "account-badge";
      type.textContent = account.type;
      top.append(name, type);

      const balance = document.createElement("div");
      balance.className = "account-bal";
      balance.textContent = fmtDec(account.current_balance ?? account.balance);

      const actions = document.createElement("div");
      actions.className = "account-actions";

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "edit-btn";
      edit.setAttribute("aria-label", "Edit account");
      setUiIcon(edit, "edit");
      edit.addEventListener("click", () => editAccount(account.id));

      const del = document.createElement("button");
      del.type = "button";
      del.className = "del-btn";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteAccount(account.id));

      actions.append(edit, del);
      card.append(top, balance, actions);
      container.appendChild(card);
    });
  }

  function populateAccountSelect(id, selectedId = null) {
    const select = $(id);
    if (!select) return;
    while (select.firstChild) select.removeChild(select.firstChild);

    const none = document.createElement("option");
    none.value = "";
    none.textContent = "— None —";
    select.appendChild(none);

    accountsData.forEach(account => {
      const option = document.createElement("option");
      option.value = String(account.id);
      option.textContent = `${account.name}${account.type ? " (" + account.type + ")" : ""}`;
      option.selected = selectedId !== null && String(account.id) === String(selectedId);
      select.appendChild(option);
    });
  }

  async function loadTransactions() {
    try {
      const limit = currentPage === "transactions" || currentPage === "budgets" ? 5000 : 10;
      const [transactions, countResult] = await Promise.all([
        apiFetch("/transactions?skip=0&limit=" + limit),
        apiFetch("/transactions/count")
      ]);
      txnsData = transactions;
      $("txn-count-badge").textContent = Number(countResult.count ?? txnsData.length);
      renderRecentTransactions(txnsData);
      renderTransactions();
    } catch (error) {
      showToast("Could not load transactions: " + error.message, "error");
    }
  }

  async function loadBudgets() {
    try {
      budgetsData = await apiFetch("/budgets");
      $("budget-count-badge").textContent = budgetsData.length;
      $("budget-count-header").textContent =
        `${budgetsData.length} active budget${budgetsData.length === 1 ? "" : "s"}`;
      updateBudgetUI();
    } catch (error) {
      showToast("Could not load budgets: " + error.message, "error");
    }
  }

  async function loadRecurring() {
    try {
      recurringData = await apiFetch("/recurring?include_archived=true");
      const activeCount = recurringData.filter(
        item => item.is_active && !item.is_archived
      ).length;
      const badge = $("recurring-count-badge");
      if (badge) {
        badge.textContent = String(activeCount);
        badge.hidden = activeCount === 0;
      }
      renderRecurringItems();
    } catch (error) {
      showToast("Could not load recurring schedules: " + error.message, "error");
    }
  }

  function localDateValue() {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
  }

  function formatRecurringDate(value) {
    const date = new Date(String(value) + "T00:00:00");
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleDateString(undefined, {day:"numeric",month:"short",year:"numeric"});
  }

  function recurringDueLabel(value) {
    const today = new Date();
    today.setHours(0,0,0,0);
    const due = new Date(String(value) + "T00:00:00");
    const days = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (days < 0) return "Overdue by " + Math.abs(days) + " day" + (Math.abs(days) === 1 ? "" : "s");
    if (days === 0) return "Due today";
    if (days === 1) return "Due tomorrow";
    return "Due in " + days + " days";
  }

  function recurringButton(label, tone, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recurring-action " + tone;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function renderRecurringItems() {
    const container = $("recurring-items");
    if (!container) return;
    container.replaceChildren();

    const visibleItems = recurringData.filter(
      item => Boolean(item.is_archived) === showArchivedRecurring
    );
    const active = visibleItems.filter(
      item => item.is_active && !item.is_archived
    );
    const summary = $("recurring-summary");
    const heading = $("recurring-list-heading");
    const toggle = $("recurring-archive-toggle");
    if (heading) {
      heading.textContent = showArchivedRecurring
        ? "Archived schedules"
        : "Active schedules";
    }
    if (toggle) {
      toggle.textContent = showArchivedRecurring
        ? "Show active"
        : "Show archived";
      toggle.setAttribute("aria-pressed", String(showArchivedRecurring));
    }

    if (summary) {
      summary.replaceChildren();
      const metrics = showArchivedRecurring
        ? [{label:"Archived schedules",value:visibleItems.length}]
        : [
            {label:"Active schedules",value:active.length},
            {
              label:"Recurring expenses",
              value:active.filter(item => item.type === "expense").length
            },
            {
              label:"Recurring income",
              value:active.filter(item => item.type === "income").length
            }
          ];
      metrics.forEach(metric => {
        const card = document.createElement("div");
        card.className = "recurring-summary-card";
        const value = document.createElement("strong");
        value.textContent = String(metric.value);
        const label = document.createElement("span");
        label.textContent = metric.label;
        card.append(value,label);
        summary.appendChild(card);
      });
    }

    if (!visibleItems.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = showArchivedRecurring
        ? "No archived schedules yet. Archive a bill or subscription to move it here."
        : "No recurring schedules yet. Add a bill, subscription or regular income above.";
      container.appendChild(empty);
      return;
    }

    visibleItems.forEach(item => {
      const card = document.createElement("article");
      card.className = "recurring-card";
      if (!item.is_active || item.is_archived) {
        card.classList.add("is-paused");
      }
      if (item.is_archived) card.classList.add("is-archived");

      const head = document.createElement("div");
      head.className = "recurring-card-head";
      const identity = document.createElement("div");
      identity.className = "recurring-card-identity";
      const title = document.createElement("h3");
      title.textContent = item.name;
      const meta = document.createElement("p");
      const frequency = item.frequency[0].toUpperCase() + item.frequency.slice(1);
      meta.textContent = item.category + " · " + frequency;
      if (item.last_recorded_due_date) {
        meta.textContent += " · Last recorded " +
          formatRecurringDate(item.last_recorded_due_date);
      }
      identity.append(title,meta);

      const amount = document.createElement("strong");
      amount.className = "recurring-amount " +
        (item.type === "income" ? "income" : "expense");
      amount.textContent = (item.type === "income" ? "+" : "−") + fmt(item.amount);
      head.append(identity,amount);

      const due = document.createElement("div");
      due.className = "recurring-due-row";
      const dueText = document.createElement("strong");
      dueText.textContent = item.is_archived
        ? "Archived"
        : item.is_active
          ? recurringDueLabel(item.next_due_date)
          : "Paused";
      const dueDate = document.createElement("span");
      dueDate.textContent = (item.is_archived ? "Last scheduled: " : "Next: ") +
        formatRecurringDate(item.next_due_date);
      due.append(dueText,dueDate);

      const actions = document.createElement("div");
      actions.className = "recurring-actions";
      if (item.is_archived) {
        actions.appendChild(recurringButton(
          "Restore",
          "primary",
          () => setRecurringArchived(item, false)
        ));
      } else {
        if (item.is_active) {
          actions.appendChild(recurringButton(
            "Mark paid / received",
            "primary",
            () => recordRecurringPayment(item)
          ));
        }
        actions.appendChild(recurringButton(
          item.is_active ? "Pause" : "Resume",
          "secondary",
          () => toggleRecurringItem(item)
        ));
        actions.appendChild(recurringButton(
          "Archive",
          "secondary",
          () => setRecurringArchived(item, true)
        ));
      }

      card.append(head,due,actions);
      container.appendChild(card);
    });
  }

  function toggleRecurringArchiveView() {
    showArchivedRecurring = !showArchivedRecurring;
    renderRecurringItems();
  }

  async function setRecurringArchived(item, archived) {
    const action = archived ? "Archive" : "Restore";
    const message = archived
      ? "Archive " + item.name + "? It will be hidden from active schedules. Payment history will be kept."
      : "Restore " + item.name + "? It will remain paused until you resume it.";
    if (!window.confirm(message)) return;

    try {
      await apiFetch("/recurring/" + item.id, {
        method: "PUT",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({is_archived:archived})
      });
      await loadRecurring();
      showToast(
        archived
          ? "Schedule archived. Payment history preserved."
          : "Schedule restored. Resume it when you are ready."
      );
    } catch (error) {
      showToast(error.message || action + " failed.", "error");
    }
  }

  async function createRecurringItem() {
    const name = $("r-name").value.trim();
    const amount = Number($("r-amount").value);
    const category = $("r-category").value.trim();
    const nextDueDate = $("r-next-date").value;
    const accountValue = $("r-account").value;
    if (!name || !Number.isFinite(amount) || amount <= 0 || !category || !nextDueDate) {
      showToast("Enter a name, valid amount, category and next due date.", "error");
      return;
    }
    try {
      await apiFetch("/recurring", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          name, amount, type:$("r-type").value, category,
          frequency:$("r-frequency").value,
          next_due_date:nextDueDate,
          account_id:accountValue ? Number(accountValue) : null
        })
      });
      $("r-name").value = "";
      $("r-amount").value = "";
      $("r-category").value = "";
      $("r-next-date").value = localDateValue();
      $("r-account").value = "";
      await loadRecurring();
      showToast("Recurring schedule added.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function recordRecurringPayment(item) {
    if (!window.confirm("Record " + item.name + " for " + formatRecurringDate(item.next_due_date) + " as paid / received? This creates one transaction.")) return;
    try {
      await apiFetch("/recurring/" + item.id + "/record", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({due_date:item.next_due_date})
      });
      await refreshAll();
      showToast("Recurring transaction recorded.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function toggleRecurringItem(item) {
    try {
      await apiFetch("/recurring/" + item.id, {
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({is_active:!item.is_active})
      });
      await loadRecurring();
      showToast(item.is_active ? "Schedule paused." : "Schedule resumed.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function deleteRecurringItem(item) {
    if (!window.confirm("Delete " + item.name + "? Payment history is always retained.")) return;
    try {
      await apiFetch("/recurring/" + item.id,{method:"DELETE"});
      await loadRecurring();
      showToast("Recurring schedule deleted.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function loadAccounts() {
    if (accountsLoadPromise) return accountsLoadPromise;

    accountsLoadPromise = (async () => {
      try {
        accountsData = await apiFetch("/accounts");
        renderAccounts();
        populateAccountSelect("r-account");
        populateAccountSelect("m-account");
        populateAccountSelect("me-account");
      } catch (error) {
        showToast("Could not load accounts: " + error.message, "error");
      }
    })();
    try {
      await accountsLoadPromise;
    } finally {
      accountsLoadPromise = null;
    }
  }

  async function loadSummary() {
    try {
      const period = selectedRange.toLowerCase();
      const [selected, all, monthlyBudgetSummary] = await Promise.all([
        apiFetch("/summary?period=" + encodeURIComponent(period)),
        apiFetch("/summary?period=all"),
        period === "1m" ? Promise.resolve(null) : apiFetch("/summary?period=1m")
      ]);
      const budgetSummary = period === "1m" ? selected : monthlyBudgetSummary;
      budgetCategoryTotals = budgetSummary?.category_totals || {};

      summaryData = selected;
      summaryAll = all;

      const totalBalance = Number(all.balance || 0);
      const income = Number(selected.income || 0);
      const expense = Number(selected.expense || 0);
      const savings = Number(selected.savings_rate || 0);
      const balance = Number(selected.balance || 0);

      $("s-bal").textContent = fmtDec(totalBalance);
      $("s-inc").textContent = fmtDec(income);
      $("s-exp").textContent = fmtDec(expense);
      $("s-sav").textContent = savings.toFixed(1) + "%";

      updateBadge("badge-inc", Number(selected.income_change || 0));
      updateBadge("badge-exp", Number(selected.expense_change || 0));
      updateBadge("badge-bal", 0);
      updateBadge("badge-sav", 0);

      $("cf-amount").textContent = fmtDec(balance);
      $("cf-tag").textContent = rangeCashflowLabel(period);
      $("leg-inc").textContent = fmt(income);
      $("leg-exp").textContent = fmt(expense);

      const categoryTotals = selected.category_totals || {};
      $("cat-total").textContent = fmt(expense);
      $("cat-period").textContent = rangeCategoryLabel(period);

      $("hero-sub").textContent = savings >= 20
        ? `Your savings rate is ${savings.toFixed(1)}%. Keep building consistent cash flow.`
        : `Your savings rate is ${savings.toFixed(1)}%. Let's find opportunities to reduce spending.`;

      const monthlyAll = summaryAll.monthly || {};
      const incArr = buildSpark(monthlyAll, "income");
      const expArr = buildSpark(monthlyAll, "expense");
      const balArr = incArr.map((value, index) => value - (expArr[index] || 0));
      const savArr = incArr.map((value, index) =>
        value > 0 ? ((value - (expArr[index] || 0)) / value) * 100 : 0
      );

      makeSparkline("spark-bal", balArr.length ? balArr : [0, totalBalance], "#22c55e");
      makeSparkline("spark-inc", incArr.length ? incArr : [0, income], "#22c55e");
      makeSparkline("spark-exp", expArr.length ? expArr : [0, expense], "#ef4444");
      makeSparkline("spark-sav", savArr.length ? savArr : [0, savings], "#f59e0b");

      renderCatChart(categoryTotals);
      renderBudgetContainer($("budget-items"), budgetCategoryTotals, false);
      renderBudgetContainer($("budget-page-list"), budgetCategoryTotals, true);
      renderCashflowChart(selected.monthly || {});
      renderInsightsCard();
    } catch (error) {
      console.error("Summary error", error);
      showToast("Could not load dashboard: " + error.message, "error");
    }
  }

  function updateDashboardByRange() {
    const categoryTotals = summaryData.category_totals || {};
    renderCatChart(categoryTotals);
    renderBudgetContainer($("budget-items"), budgetCategoryTotals, false);
    renderBudgetContainer($("budget-page-list"), budgetCategoryTotals, true);
    $("cat-period").textContent = rangeCategoryLabel(selectedRange.toLowerCase());
    renderCashflowChart(summaryData.monthly || {});
  }

  async function refreshAll() {
    await Promise.all([loadTransactions(), loadBudgets(), loadAccounts(), loadRecurring()]);
    await loadSummary();
  }

  async function refreshDashboard() {
    await Promise.all([loadTransactions(), loadBudgets()]);
    await loadSummary();
  }

  function refreshCurrentPage() {
    if (currentPage === "transactions") {
      Promise.all([loadTransactions(), loadAccounts(), loadSummary()]);
    } else if (currentPage === "budgets") {
      Promise.all([loadTransactions(), loadBudgets(), loadSummary()]);
    } else if (currentPage === "recurring") {
      Promise.all([loadRecurring(), loadAccounts()]);
    } else if (currentPage === "accounts") {
      Promise.all([loadAccounts(), loadSummary()]);
    } else if (currentPage === "insights") {
      loadInsightsPage();
    } else if (currentPage === "planning") {
      loadPlanningPage();
    } else if (currentPage === "ai-page") {
      return;
    } else {
      Promise.all([loadTransactions(), loadBudgets(), loadSummary()]);
    }
  }

  async function openModal() {
    $("modal").classList.add("open");
    $("m-date").value = new Date().toISOString().slice(0, 10);
    $("m-amount").value = "";
    $("m-category").value = "";
    $("m-desc").value = "";
    await loadAccounts();
    populateAccountSelect("m-account");
  }

  function closeModal() {
    $("modal").classList.remove("open");
  }

  async function submitModal() {
    const amount = Number($("m-amount").value);
    const category = $("m-category").value.trim();
    const date = $("m-date").value;
    const description = $("m-desc").value.trim() || category;
    const accountId = $("m-account").value || null;

    if (!Number.isFinite(amount) || amount <= 0 || !category || !date) {
      showToast("Enter a valid amount, category, and date.", "error");
      return;
    }

    try {
      await apiFetch("/transactions", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          type: $("m-type").value,
          amount,
          description,
          category,
          date,
          account_id: accountId
        })
      });
      closeModal();
      await refreshAll();
      showToast("Transaction added.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function openEditModal(id) {
    const txn = txnsData.find(item => item.id === id);
    if (!txn) return;
    await loadAccounts();
    editingTxnId = id;
    $("me-type").value = txn.type;
    $("me-amount").value = txn.amount;
    $("me-desc").value = txn.description || "";
    $("me-category").value = txn.category || "";
    $("me-date").value = txn.date || "";
    populateAccountSelect("me-account", txn.account_id);
    $("modal-edit").classList.add("open");
  }

  function closeEditModal() {
    $("modal-edit").classList.remove("open");
    editingTxnId = null;
  }

  async function saveEdit() {
    if (!editingTxnId) return;
    const amount = Number($("me-amount").value);
    const category = $("me-category").value.trim();
    const date = $("me-date").value;
    const description = $("me-desc").value.trim() || category;
    const accountId = $("me-account").value || null;

    if (!Number.isFinite(amount) || amount <= 0 || !category || !date) {
      showToast("Enter valid transaction details.", "error");
      return;
    }

    try {
      await apiFetch("/transactions/" + editingTxnId, {
        method: "PUT",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          type: $("me-type").value,
          amount,
          description,
          category,
          date,
          account_id: accountId
        })
      });
      closeEditModal();
      await refreshAll();
      showToast("Transaction updated.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function addTransaction() {
    const amount = Number($("t-amount").value);
    const category = $("t-category").value.trim();
    const date = $("t-date").value;
    const description = $("t-desc").value.trim() || category;
    if (!Number.isFinite(amount) || amount <= 0 || !category || !date) {
      showToast("Enter valid transaction details.", "error");
      return;
    }

    try {
      await apiFetch("/transactions", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          type: $("t-type").value,
          amount,
          description,
          category,
          date
        })
      });
      $("t-amount").value = "";
      $("t-category").value = "";
      $("t-desc").value = "";
      await refreshAll();
      showToast("Transaction added.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function deleteTxn(id) {
    try {
      await apiFetch("/transactions/" + id, {method: "DELETE"});
      await refreshAll();
      showToast("Transaction deleted.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function deleteAllTransactions() {
    try {
      const result = await apiFetch("/transactions/all", {method: "DELETE"});
      await refreshAll();
      showToast(`${result.deleted || 0} transaction(s) deleted.`);
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function addBudget() {
    const category = $("b-cat").value.trim();
    const limit = Number($("b-limit").value);
    if (!category || !Number.isFinite(limit) || limit <= 0) {
      showToast("Enter a valid category and monthly limit.", "error");
      return;
    }

    try {
      await apiFetch("/budgets", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({category, limit_amt: limit})
      });
      $("b-cat").value = "";
      $("b-limit").value = "";
      await refreshAll();
      showToast("Budget saved.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function deleteBudget(category) {
    try {
      await apiFetch("/budgets/" + encodeURIComponent(category), {method: "DELETE"});
      await refreshAll();
      showToast("Budget removed.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function openAccountModal(data = null) {
    editingAccountId = data ? data.id : null;
    $("account-modal-title").textContent = data ? "Edit Account" : "Add Account";
    $("ac-name").value = data ? data.name : "";
    $("ac-balance").value = data ? data.balance : "";
    $("ac-type").value = data ? data.type : "checking";
    $("modal-account").classList.add("open");
  }

  function closeAccountModal() {
    $("modal-account").classList.remove("open");
    editingAccountId = null;
  }

  async function saveAccount() {
    const name = $("ac-name").value.trim();
    const balance = Number($("ac-balance").value);
    const type = $("ac-type").value;

    if (!name || !Number.isFinite(balance)) {
      showToast("Enter a valid account name and initial balance.", "error");
      return;
    }

    try {
      await apiFetch(
        editingAccountId ? "/accounts/" + editingAccountId : "/accounts",
        {
          method: editingAccountId ? "PUT" : "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({name, balance, type})
        }
      );
      closeAccountModal();
      await refreshAll();
      showToast(editingAccountId ? "Account updated." : "Account created.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function deleteAccount(id) {
    try {
      await apiFetch("/accounts/" + id, {method: "DELETE"});
      await refreshAll();
      showToast("Account deleted.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function editAccount(id) {
    const account = accountsData.find(item => item.id === id);
    if (account) openAccountModal(account);
  }

  function parseCSVLine(line) {
    const result = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === "," && !quoted) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  function normalizeDate(raw) {
    if (!raw) return new Date().toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    const match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (match) {
      let [, month, day, year] = match;
      if (year.length === 2) year = (Number(year) > 50 ? "19" : "20") + year;
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime())
      ? new Date().toISOString().slice(0, 10)
      : parsed.toISOString().slice(0, 10);
  }

  function parseCSVDocument(source) {
    const input = String(source || "").replace(/^\uFEFF/, "");
    const records = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let index = 0; index < input.length; index += 1) {
      const character = input[index];
      if (character === '"') {
        if (quoted && input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (character === "," && !quoted) {
        row.push(cell.trim());
        cell = "";
      } else if ((character === "\n" || character === "\r") && !quoted) {
        if (character === "\r" && input[index + 1] === "\n") index += 1;
        row.push(cell.trim());
        cell = "";
        if (row.some(value => value !== "")) records.push(row);
        row = [];
      } else {
        cell += character;
      }
    }

    row.push(cell.trim());
    if (row.some(value => value !== "")) records.push(row);
    return records;
  }

  function parseImportAmount(value) {
    let raw = String(value ?? "").trim();
    if (!raw) return NaN;
    const parenthesized = /^\(.*\)$/.test(raw);
    raw = raw
      .replace(/[₹$€£,\s]/g, "")
      .replace(/[()]/g, "")
      .replace(/[^0-9.+-]/g, "");
    const amount = Number(raw);
    if (!Number.isFinite(amount)) return NaN;
    return parenthesized ? -Math.abs(amount) : amount;
  }

  function parseImportDate(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;

    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    let year;
    let month;
    let day;

    if (iso) {
      [, year, month, day] = iso;
    } else {
      const numeric = raw.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})$/);
      if (numeric) {
        let first = Number(numeric[1]);
        let second = Number(numeric[2]);
        year = numeric[3];
        if (year.length === 2) year = (Number(year) > 50 ? "19" : "20") + year;
        // FinanceAI is primarily used with Indian date conventions (DD/MM/YYYY).
        if (first > 12) {
          day = String(first);
          month = String(second);
        } else if (second > 12) {
          month = String(first);
          day = String(second);
        } else {
          day = String(first);
          month = String(second);
        }
      } else {
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return null;
        year = String(parsed.getFullYear());
        month = String(parsed.getMonth() + 1);
        day = String(parsed.getDate());
      }
    }

    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (
      !Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) ||
      check.getUTCFullYear() !== y ||
      check.getUTCMonth() + 1 !== m ||
      check.getUTCDate() !== d
    ) return null;

    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  async function exportCSV() {
    try {
      const response = await apiResponse("/transactions/export.csv", {
        headers: {Accept: "text/csv"}
      });
      if (!response.ok) {
        let message = response.statusText || "Export failed";
        try {
          const payload = await response.json();
          message = payload.detail || payload.message || message;
        } catch (_) {}
        throw new Error(message);
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const filename = filenameMatch?.[1] || "financeai-transactions.csv";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("Transactions CSV exported.");
    } catch (error) {
      showToast("Export failed: " + error.message, "error");
    }
  }

  function csvElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function buildCSVImportRows(records) {
    const headers = records[0].map(header =>
      String(header || "").toLowerCase().replace(/[^a-z0-9]/g, "")
    );
    const rows = [];
    let skipped = 0;

    for (const values of records.slice(1)) {
      const sourceRow = {};
      headers.forEach((header, position) => {
        sourceRow[header] = String(values[position] ?? "").trim();
      });
      const get = (...names) => {
        for (const name of names) {
          if (sourceRow[name] !== undefined && sourceRow[name] !== "") return sourceRow[name];
        }
        return "";
      };

      const debit = parseImportAmount(get("debit", "withdrawal", "debitamount"));
      const credit = parseImportAmount(get("credit", "deposit", "creditamount"));
      const hasDebitCredit = Number.isFinite(debit) || Number.isFinite(credit);
      let amount = parseImportAmount(get("amount", "transactionamount", "amountinr", "value", "total"));
      let typeValue = get("type", "transactiontype", "kind").toLowerCase();

      if (hasDebitCredit && !(Number.isFinite(amount) && amount !== 0)) {
        if (Number.isFinite(credit) && credit > 0) {
          amount = credit;
          typeValue = "income";
        } else if (Number.isFinite(debit) && debit > 0) {
          amount = debit;
          typeValue = "expense";
        }
      }

      const date = parseImportDate(get("date", "transactiondate", "posteddate", "transdate"));
      const amountAbs = Math.abs(amount);
      if (!Number.isFinite(amountAbs) || amountAbs <= 0 || !date) {
        skipped += 1;
        continue;
      }

      let type = "expense";
      if (["income", "credit", "deposit", "salary", "refund", "interest"].includes(typeValue)) {
        type = "income";
      } else if (["expense", "debit", "withdrawal", "payment", "purchase"].includes(typeValue)) {
        type = "expense";
      } else if (hasDebitCredit && Number.isFinite(credit) && credit > 0) {
        type = "income";
      } else if (amount < 0) {
        type = "expense";
      }

      const category = get("category", "cat", "subcategory") || "Uncategorized";
      const description = get("description", "desc", "note", "merchant", "narration", "details") || category;
      const rawAccount = get("accountid", "accountcode", "account", "wallet");
      const numericAccount = /^\d+$/.test(rawAccount) ? Number(rawAccount) : null;
      const existingAccount = numericAccount !== null
        ? accountsData.find(account => Number(account.id) === numericAccount)
        : null;

      rows.push({
        payload: {
          type,
          amount: amountAbs,
          category: category.slice(0, 50),
          description: description.slice(0, 200),
          date,
          account_id: existingAccount ? Number(existingAccount.id) : null
        },
        sourceAccount: rawAccount,
      });
    }

    return {rows, skipped};
  }

  function renderCSVImportPreview(fileName, rows, skipped) {
    const summary = $("csv-import-summary");
    const mappingsSection = $("csv-account-mapping-section");
    const mappings = $("csv-account-mappings");
    const preview = $("csv-preview-rows");
    const count = $("csv-preview-count");
    const footnote = $("csv-import-footnote");
    const confirm = $("csv-import-confirm");
    if (!summary || !mappings || !preview || !count || !footnote || !confirm) return;

    summary.replaceChildren();
    [
      ["File", fileName],
      ["Valid rows", String(rows.length)],
      ["Skipped", String(skipped)],
    ].forEach(([label, value]) => {
      const chip = csvElement("div", "csv-summary-chip");
      chip.append(csvElement("span", "", label), csvElement("strong", "", value));
      summary.appendChild(chip);
    });

    mappings.replaceChildren();
    const sourceAccounts = [...new Set(rows.map(row => row.sourceAccount).filter(Boolean))];
    mappingsSection.hidden = sourceAccounts.length === 0;
    sourceAccounts.forEach(code => {
      const row = csvElement("div", "csv-account-map-row");
      row.appendChild(csvElement("span", "csv-account-code", code));
      const select = csvElement("select");
      select.dataset.sourceAccount = code;
      const none = csvElement("option", "", "Leave unassigned");
      none.value = "";
      select.appendChild(none);
      accountsData.forEach(account => {
        const option = csvElement("option", "", `${account.name} (${account.type || "account"})`);
        option.value = String(account.id);
        if (/^\d+$/.test(code) && Number(code) === Number(account.id)) option.selected = true;
        select.appendChild(option);
      });
      row.appendChild(select);
      mappings.appendChild(row);
    });

    preview.replaceChildren();
    rows.slice(0, 10).forEach(({payload, sourceAccount}) => {
      const row = csvElement("tr");
      row.appendChild(csvElement("td", "", payload.date));
      row.appendChild(csvElement("td", "", payload.description));
      row.appendChild(csvElement("td", "", payload.category));
      row.appendChild(csvElement("td", "", payload.type));
      const amount = csvElement(
        "td",
        `numeric ${payload.type === "income" ? "amount-income" : "amount-expense"}`,
        (payload.type === "income" ? "+" : "−") + fmtDec(payload.amount),
      );
      row.appendChild(amount);
      row.appendChild(csvElement("td", "", sourceAccount || "—"));
      preview.appendChild(row);
    });
    count.textContent = `Showing ${Math.min(10, rows.length)} of ${rows.length}`;
    footnote.textContent = skipped
      ? `${skipped} row(s) could not be read and will not be imported. Exact matching transactions already in your account will be skipped as duplicates.`
      : "Exact matching transactions already in your account will be skipped as duplicates. Account codes without a mapping will be imported as unassigned.";
    confirm.textContent = `Import ${rows.length} transaction${rows.length === 1 ? "" : "s"}`;
    confirm.disabled = rows.length === 0;
  }

  function closeCSVImport() {
    const modal = $("modal-csv-import");
    if (modal) {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
    }
    pendingCSVImport = null;
  }

  async function importCSV(input) {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const records = parseCSVDocument(await file.text());
      if (records.length < 2) {
        throw new Error("CSV must contain a header row and at least one data row.");
      }
      const {rows, skipped} = buildCSVImportRows(records);
      if (!rows.length) {
        throw new Error(`No valid rows found. ${skipped} row(s) were skipped. Check that the CSV contains Amount and Date columns.`);
      }

      pendingCSVImport = {rows, skipped, fileName: file.name};
      renderCSVImportPreview(file.name, rows, skipped);
      $("modal-csv-import")?.classList.add("open");
      $("modal-csv-import")?.setAttribute("aria-hidden", "false");
    } catch (error) {
      showToast("Could not read CSV: " + error.message, "error");
    } finally {
      input.value = "";
    }
  }

  async function confirmCSVImport() {
    if (!pendingCSVImport?.rows?.length) return;
    const button = $("csv-import-confirm");
    const originalText = button?.textContent || "Import transactions";
    if (button) {
      button.disabled = true;
      button.textContent = "Importing…";
    }

    try {
      const mappings = {};
      document.querySelectorAll("#csv-account-mappings select[data-source-account]").forEach(select => {
        mappings[select.dataset.sourceAccount] = select.value ? Number(select.value) : null;
      });

      const payload = pendingCSVImport.rows.map(({payload: row, sourceAccount}) => ({
        ...row,
        account_id: sourceAccount
          ? (Object.prototype.hasOwnProperty.call(mappings, sourceAccount)
            ? mappings[sourceAccount]
            : (row.account_id ?? null))
          : row.account_id,
      }));

      const result = await apiFetch("/transactions/import", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
      });
      await Promise.all([loadTransactions(), loadAccounts(), loadSummary()]);

      const imported = Number(result.imported || 0);
      const duplicates = Number(result.duplicate_count || result.duplicates?.length || 0);
      const failed = Number(result.failed || 0);
      const invalid = Number(pendingCSVImport.skipped || 0);
      closeCSVImport();

      const parts = [`Imported ${imported}`];
      if (duplicates) parts.push(`skipped ${duplicates} duplicate${duplicates === 1 ? "" : "s"}`);
      if (invalid + failed) parts.push(`skipped ${invalid + failed} invalid/failed row(s)`);
      showToast(parts.join(" · ") + ".", failed ? "error" : "success");

      if (failed && result.errors?.[0]?.error) {
        showToast("First import error: " + result.errors[0].error, "error");
      }
    } catch (error) {
      showToast("Import failed: " + error.message, "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  async function importBudgetsCSV(input) {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (!lines.length) {
        showToast("CSV has no data rows.", "error");
        return;
      }

      const parsed = lines.map(parseCSVLine);
      const first = parsed[0] || [];
      const firstLower = first.map(value => String(value || "").trim().toLowerCase());
      const looksLikeHeader =
        firstLower.length >= 2 &&
        /(category|cat)/.test(firstLower[0]) &&
        /(limit|amount|budget)/.test(firstLower[1]);

      const dataRows = looksLikeHeader ? parsed.slice(1) : parsed;
      let imported = 0;
      let skipped = 0;

      for (const values of dataRows) {
        const category = String(values[0] || "").trim();
        const limit = Number(String(values[1] || "").replace(/,/g, "").replace(/₹/g, "").trim());

        if (!category || !Number.isFinite(limit) || limit <= 0) {
          skipped += 1;
          continue;
        }

        try {
          await apiFetch("/budgets", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
              category,
              limit_amt: limit
            })
          });
          imported += 1;
        } catch (error) {
          skipped += 1;
          console.warn("Budget import row failed:", category, error);
        }
      }

      input.value = "";

      if (!imported) {
        showToast("No valid budget rows found.", "error");
        return;
      }

      await refreshAll();
      showToast(
        `Imported ${imported} budget(s)${skipped ? `; skipped ${skipped}`: ""}.`
      );
    } catch (error) {
      input.value = "";
      showToast("Budget import failed: " + error.message, "error");
    }
  }

  function exportBudgetsCSV() {
    const rows = [["category", "limit_amt"]];
    budgetsData.forEach(budget => rows.push([budget.category, budget.limit_amt]));

    const csv = rows
      .map(row => row.map(value => {
        const text = String(value ?? "");
        return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
      }).join(","))
      .join("\n");

    const blob = new Blob([csv], {type: "text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "financeai-budgets.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function applyDashboardRange(range) {
    selectedRange = range;
    isAllView = range === "All";
    syncTopbarRangeButtons();
    document.querySelectorAll(".time-btn").forEach(button => {
      button.classList.toggle(
        "active",
        button.textContent.trim().toLowerCase() === range.toLowerCase()
      );
    });
    loadSummary();
  }

  function filterThisMonth() {
    applyDashboardRange("1M");
  }

  function filterAllTime() {
    applyDashboardRange("All");
  }

  function showAllExpenses() {
    applyDashboardRange("All");
  }

  function showMonthlyExpenses() {
    applyDashboardRange("1M");
  }

  function setRange(range, element) {
    selectedRange = range;
    isAllView = range === "All";
    document.querySelectorAll(".time-btn").forEach(button =>
      button.classList.remove("active")
    );
    element?.classList.add("active");
    syncTopbarRangeButtons();
    loadSummary();
  }

  function rangeCashflowLabel(period) {
    const labels = {
      "1m": "Net this month",
      "3m": "Net last 3 months",
      "6m": "Net last 6 months",
      "1y": "Net last 12 months",
      "all": "Net all time"
    };
    return labels[period] || "Net cash flow";
  }

  function rangeCategoryLabel(period) {
    const labels = {
      "1m": new Date().toLocaleDateString("en-US", {month: "long", year: "numeric"}),
      "3m": "Last 3 months",
      "6m": "Last 6 months",
      "1y": "Last 12 months",
      "all": "All time"
    };
    return labels[period] || "Selected period";
  }

  function setGreeting() {
    const hour = new Date().getHours();
    $("greeting").textContent =
      hour < 12 ? "Good morning" :
      hour < 17 ? "Good afternoon" : "Good evening";
  }

  function applyTheme(theme) {
    const light = theme === "light";
    document.body.classList.toggle("light", light);
    localStorage.setItem("theme", light ? "light" : "dark");
    const label = $("profile-theme-label");
    const value = $("profile-theme-value");
    const icon = $("profile-theme-icon");
    const button = $("profile-theme-toggle");
    if (label) label.textContent = light ? "Switch to dark mode" : "Switch to light mode";
    if (value) value.textContent = light ? "Light" : "Dark";
    if (icon) icon.textContent = light ? "☾" : "☀";
    if (button) button.setAttribute("aria-pressed", String(light));
  }

  function toggleTheme() {
    applyTheme(document.body.classList.contains("light") ? "dark" : "light");
  }

  function toggleProfileMenu(forceOpen) {
    const menu = $("profile-menu");
    const trigger = $("profile-trigger");
    if (!menu || !trigger) return;
    const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : menu.hidden;
    menu.hidden = !shouldOpen;
    trigger.setAttribute("aria-expanded", String(shouldOpen));
  }

  function closeProfileMenu() {
    toggleProfileMenu(false);
  }

  function toggleSidebar() {
    document.body.classList.toggle("sidebar-open");
  }

  let aiPagePromise;
  function getAIPage() {
    if (!aiPagePromise) {
      aiPagePromise = import(chunkUrl("ai-page.js"))
        .then(module => module.createAIPage({ $, apiFetch, apiResponse, showToast }))
        .catch(error => {
          aiPagePromise = null;
          throw error;
        });
    }
    return aiPagePromise;
  }

  function activateAIPage() {
    void getAIPage()
      .then(page => page.activateAIPage())
      .catch(error => showToast("Could not load the AI assistant: " + error.message, "error"));
  }

  function quickAsk(text) {
    void getAIPage()
      .then(page => {
        page.activateAIPage({ startNewChat: false });
        page.quickAsk(text);
      })
      .catch(error => showToast("Could not load the AI assistant: " + error.message, "error"));
  }

  function sendChat() {
    void getAIPage()
      .then(page => page.sendChat())
      .catch(error => showToast("Could not load the AI assistant: " + error.message, "error"));
  }
  let optionalPagesPromise;
  function getOptionalPages() {
    if (!optionalPagesPromise) {
      optionalPagesPromise = import(chunkUrl("optional-pages.js"))
        .then(module => module.createOptionalPages({
          $,
          apiFetch,
          fmt,
          fmtDec,
          showToast,
          setCurrentPage: page => { currentPage = page; },
          loadNetWorthChart: (canvas, history) => loadChartModule()
            .then(charts => charts.renderNetWorth(canvas, history))
        }))
        .catch(error => {
          optionalPagesPromise = null;
          throw error;
        });
    }
    return optionalPagesPromise;
  }

  function activateInsights() {
    pageNavigationGeneration += 1;
    void getOptionalPages()
      .then(pages => pages.activateInsights())
      .catch(error => showToast("Could not load insights: " + error.message, "error"));
  }

  function activatePlanning() {
    pageNavigationGeneration += 1;
    void getOptionalPages()
      .then(pages => pages.activatePlanning())
      .catch(error => showToast("Could not load planning: " + error.message, "error"));
  }

  function loadInsightsPage() {
    return getOptionalPages()
      .then(pages => pages.loadInsightsPage())
      .catch(error => showToast("Could not load insights: " + error.message, "error"));
  }

  function loadPlanningPage() {
    return getOptionalPages()
      .then(pages => pages.loadPlanningPage())
      .catch(error => showToast("Could not load planning: " + error.message, "error"));
  }
  async function goPage(name, element) {
    const navigationGeneration = ++pageNavigationGeneration;
    if (name === "insights") {
      activateInsights();
      return;
    }
    if (name === "planning") {
      activatePlanning();
      return;
    }

    try {
      await ensurePageLoaded(name);
    } catch (error) {
      showToast("Could not load page: " + error.message, "error");
      return;
    }
    if (navigationGeneration !== pageNavigationGeneration) return;

    currentPage = name;
    document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));

    const page = $("page-" + name);
    if (page) page.classList.add("active");
    if (element) element.classList.add("active");

    const titles = {
      dashboard: "Overview",
      transactions: "Transactions",
      budgets: "Budgets",
      recurring: "Recurring payments",
      accounts: "Accounts",
      planning: "Planning & Wealth",
      "ai-page": "AI Assistant"
    };
    $("topbar-title").textContent = titles[name] || name;

    const content = $("content");
    if (name === "ai-page") {
      content.style.overflow = "hidden";
      content.style.padding = "0";
      activateAIPage();
    } else {
      content.style.overflow = "";
      content.style.padding = "";
    }

    refreshCurrentPage();
  }

  function init() {
    setGreeting();
    syncTopbarRangeButtons();
    const savedTheme = localStorage.getItem("theme") || "dark";
    applyTheme(savedTheme);

    $("planning-nav-item")?.addEventListener("click", activatePlanning);
    $("insights-nav-item")?.addEventListener("click", activateInsights);

    $("modal")?.addEventListener("click", event => {
      if (event.target === $("modal")) closeModal();
    });
    $("modal-edit")?.addEventListener("click", event => {
      if (event.target === $("modal-edit")) closeEditModal();
    });
    $("modal-account")?.addEventListener("click", event => {
      if (event.target === $("modal-account")) closeAccountModal();
    });
    $("modal-csv-import")?.addEventListener("click", event => {
      if (event.target === $("modal-csv-import")) closeCSVImport();
    });
    $("csv-import-close")?.addEventListener("click", closeCSVImport);
    $("csv-import-cancel")?.addEventListener("click", closeCSVImport);
    $("csv-import-confirm")?.addEventListener("click", confirmCSVImport);

    $("profile-trigger")?.addEventListener("click", () => toggleProfileMenu());
    $("profile-add-account")?.addEventListener("click", () => {
      closeProfileMenu();
      openAccountModal();
    });
    $("profile-theme-toggle")?.addEventListener("click", () => {
      toggleTheme();
      updateUserUI();
    });
    document.addEventListener("click", event => {
      if (!event.target.closest(".profile-wrap")) closeProfileMenu();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeProfileMenu();
        closeCSVImport();
      }
    });
    $("search-input")?.addEventListener("input", renderTransactions);
    $("content")?.addEventListener("click", event => {
      const button = event.target.closest(".txn-filter-btn");
      if (button?.dataset.filter) setTransactionTypeFilter(button.dataset.filter);
      if (event.target.closest("#view-all-expenses")) {
        if (selectedRange === "1M") showAllExpenses();
        else showMonthlyExpenses();
      }
    });

    $("m-date").value = new Date().toISOString().slice(0, 10);
    $("search-input")?.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.target.value = "";
        renderTransactions();
      }
    });

    refreshDashboard();
  }

  // Preserve the existing inline onclick API.
  Object.assign(window, {
    goPage,
    toggleTheme,
    toggleSidebar,
    openModal,
    closeModal,
    submitModal,
    openEditModal,
    closeEditModal,
    saveEdit,
    addTransaction,
    deleteTxn,
    deleteAllTransactions,
    addBudget,
    deleteBudget,
    createRecurringItem,
    toggleRecurringArchiveView,
    openAccountModal,
    closeAccountModal,
    saveAccount,
    deleteAccount,
    editAccount,
    importCSV,
    exportCSV,
    filterThisMonth,
    setRange,
    filterAllTime,
    quickAsk,
    sendChat,
    showAllExpenses,
    showMonthlyExpenses,
    refreshCurrentPage,
    setTransactionTypeFilter,
    importBudgetsCSV,
    exportBudgetsCSV,
    logout
  });

  $("auth-form")?.addEventListener("submit", submitAuth);
  $("auth-toggle")?.addEventListener("click", () => setAuthMode(authMode === "login" ? "signup" : "login"));
  $("auth-password-toggle")?.addEventListener("click", () => {
    const input = $("auth-password");
    const button = $("auth-password-toggle");
    if (!input || !button) return;
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    button.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
    button.setAttribute("aria-pressed", reveal ? "true" : "false");
  });
  $("auth-password")?.addEventListener("input", updatePasswordRules);
  $("auth-forgot")?.addEventListener("click", requestPasswordRecovery);
  $("auth-google")?.addEventListener("click", signInWithGoogle);
  $("logout-btn")?.addEventListener("click", logout);
  $("sidebar-logout-btn")?.addEventListener("click", logout);
  setAuthMode("login");

  window.addEventListener("DOMContentLoaded", initAuth);
})();
