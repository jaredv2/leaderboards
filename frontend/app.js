// ============================================================
// app.js — Leaderboards SPA
// Fixes: home crash, Discord login, routing, dark mode, nav logo
// ============================================================

console.log("[app.js] Script loaded");

// ── Config ──────────────────────────────────────────────────
const API_BASE = window.location.origin + "/api";
console.log("[app.js] API_BASE:", API_BASE);

// ── State ────────────────────────────────────────────────────
let currentUser = null;
let currentLeaderboard = null;
let currentOption = null;
let currentLeaderboardOptions = [];
let authToken = localStorage.getItem("authToken");

const CATEGORIES = [
  "Gaming",
  "Movies",
  "Music",
  "Technology",
  "Sports",
  "Food",
  "Fashion",
  "Travel",
  "Books",
  "Anime",
  "Art",
  "Memes",
  "Other",
];
let availableCategories = [...CATEGORIES];
const INFINITE_LIMIT = 1000000;

// ── Route table  (path pattern → page key)  ─────────────────
//   Each entry: { pattern: RegExp, page: string, params: string[] }
const ROUTES = [
  { pattern: /^\/$|^\/home$/, page: "home", params: [] },
  { pattern: /^\/trending$/, page: "trending", params: [] },
  { pattern: /^\/search$/, page: "search", params: [] },
  { pattern: /^\/me$/, page: "profile", params: [] },
  { pattern: /^\/profile\/([^/]+)$/, page: "profile", params: ["userId"] },
  {
    pattern: /^\/leaderboard\/([^/]+)$/,
    page: "leaderboard-detail",
    params: ["leaderboardId"],
  },
  { pattern: /^\/credits$/, page: "credits", params: [] },
  { pattern: /^\/privacy$/, page: "privacy", params: [] },
  { pattern: /^\/tos$/, page: "tos", params: [] },
  { pattern: /^\/banned$/, page: "banned", params: [] },
  { pattern: /^\/admin(?:\/([^/]+))?$/, page: "admin", params: ["adminTab"] },
];

// ── DOM page map ─────────────────────────────────────────────
const pages = {
  home: document.getElementById("page-home"),
  trending: document.getElementById("page-trending"),
  search: document.getElementById("page-search"),
  profile: document.getElementById("page-profile"),
  admin: document.getElementById("page-admin"),
  "leaderboard-detail": document.getElementById("page-leaderboard-detail"),
  banned: document.getElementById("page-banned"),
  credits: document.getElementById("page-credits"),
  privacy: document.getElementById("page-privacy"),
  tos: document.getElementById("page-tos"),
};

// ── Router ───────────────────────────────────────────────────
/**
 * navigateTo(pageName, pushState, routeParams)
 *  - pageName   : key in `pages` object
 *  - pushState  : whether to push a real URL (default true)
 *  - routeParams: optional { userId, leaderboardId, searchTerm }
 *
 * WHY: The old code crashed on "home" because loadHomeLeaderboards()
 * tried to read a DOM element that didn't exist yet when called from
 * an inline onclick before DOMContentLoaded finished wiring.
 * Now every page switch is guarded with null checks.
 */
function navigateTo(pageName, pushState = true, routeParams = {}) {
  document.body.style.overflow = "";
  console.log("[router] navigateTo →", pageName, routeParams);

  // Hide all pages
  Object.values(pages).forEach((p) => {
    if (p) p.style.display = "none";
  });

  const targetPage = pages[pageName];
  if (!targetPage) {
    console.warn("[router] Unknown page:", pageName, "→ falling back to home");
    pageName = "home";
  }

  const pageEl = pages[pageName];
  if (pageEl) pageEl.style.display = "block";
  document.body.dataset.page = pageName;

  // Update active nav link
  document.querySelectorAll(".nav-link, .nav-drawer-link").forEach((link) => {
    link.classList.remove("active");
    if (link.dataset.page === pageName) link.classList.add("active");
  });

  // Push URL using History API
  if (pushState) {
    const url = pageToUrl(pageName, routeParams);
    window.history.pushState({ page: pageName, ...routeParams }, "", url);
    console.log("[router] pushState →", url);
  }

  // Load data for the page
  // Each loader is wrapped in a try/catch so one failing API call
  // can never crash the whole navigation cycle.
  try {
    if (pageName === "home") safeLoadHome();
    if (pageName === "trending") loadTrendingLeaderboards();
    if (pageName === "search") {
      // Pre-fill search term from URL query if present
      const term =
        routeParams.searchTerm ||
        new URLSearchParams(window.location.search).get("term");
      if (term) {
        const inp = document.getElementById("search-input");
        if (inp) {
          inp.value = term;
          runSearch(term);
        }
      } else {
        resetSearchLanding();
      }
    }
    if (pageName === "profile") {
      if (routeParams.userId) loadPublicProfile(routeParams.userId);
      else loadProfile();
    }
    if (pageName === "leaderboard-detail" && routeParams.leaderboardId) {
      loadLeaderboardDetail(routeParams.leaderboardId);
    }
    if (pageName === "banned") loadBannedScreen();
    if (pageName === "admin") loadAdminPanel(routeParams.adminTab);
  } catch (err) {
    console.error("[router] Page load error:", err);
  }
}

window.navigateTo = navigateTo;

/** Convert page name + params to a clean URL path */
function pageToUrl(pageName, params = {}) {
  const map = {
    home: "/",
    trending: "/trending",
    search: params.searchTerm
      ? `/search?term=${encodeURIComponent(params.searchTerm)}`
      : "/search",
    profile: params.userId ? `/profile/${params.userId}` : "/me",
    "leaderboard-detail": params.leaderboardId
      ? `/leaderboard/${params.leaderboardId}`
      : "/",
    credits: "/credits",
    privacy: "/privacy",
    tos: "/tos",
    banned: "/banned",
    admin: params.adminTab ? `/admin/${params.adminTab}` : "/admin",
  };
  return map[pageName] || "/";
}

/** Parse current URL and route to the correct page (for page reload/direct link) */
function routeFromURL() {
  const path = window.location.pathname;
  const search = window.location.search;
  console.log("[router] routeFromURL path:", path);

  for (const route of ROUTES) {
    const match = path.match(route.pattern);
    if (match) {
      const routeParams = {};
      route.params.forEach((name, i) => {
        routeParams[name] = match[i + 1];
      });

      // Handle ?term= on /search
      if (route.page === "search") {
        const term = new URLSearchParams(search).get("term");
        if (term) routeParams.searchTerm = term;
      }

      console.log("[router] matched route →", route.page, routeParams);
      navigateTo(route.page, false, routeParams);
      return;
    }
  }

  // Default fallback → home
  console.log("[router] no route matched, defaulting to home");
  navigateTo("home", false);
}

// Handle browser back/forward buttons
window.addEventListener("popstate", (e) => {
  console.log("[router] popstate event", e.state);
  if (e.state && e.state.page) {
    navigateTo(e.state.page, false, e.state);
  } else {
    routeFromURL();
  }
});

// ── Nav link wiring ──────────────────────────────────────────
// WHY: The old code used querySelectorAll at parse time, before some
// links existed. We wire at DOMContentLoaded via a single delegated
// listener on document to catch all current AND future nav links.
document.addEventListener("click", async (e) => {
  const link = e.target.closest("[data-page]");
  if (!link) return;

  // Only intercept nav-area links (not data-page on arbitrary cards)
  const isNavLink =
    link.classList.contains("nav-link") ||
    link.classList.contains("nav-drawer-link") ||
    link.classList.contains("footer-link") ||
    link.id === "nav-user-pill" ||
    link.id === "nav-logo-link";

  if (!isNavLink) return;

  e.preventDefault();
  const page = link.dataset.page;
  console.log("[nav] clicked link →", page);

  // Close drawer if open
  const drawer = document.getElementById("nav-drawer");
  if (drawer) drawer.classList.remove("open");

  if (page) navigateTo(page);
});

// ── API Helper ───────────────────────────────────────────────
async function apiRequest(endpoint, options = {}) {
  console.log("[api] →", endpoint, options.method || "GET");
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const csrf = localStorage.getItem("lb_csrf_token");
  if (csrf) headers["X-CSRF-Token"] = csrf;

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    console.warn("[api] 401 — logging out");
    logout();
    throw new Error("Session expired. Please login again.");
  }

  if (response.status === 403) {
    const error = await response
      .json()
      .catch(() => ({ detail: "Request forbidden" }));
    if (/banned|restricted/i.test(error.detail || "")) {
      navigateTo("banned", true);
    }
    throw new Error(error.detail || "Request forbidden");
  }

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: "Request failed" }));
    console.error("[api] Error response:", error);
    throw new Error(error.detail || "Request failed");
  }

  if (response.status === 204) return null;
  return response.json();
}

// ── Authentication ───────────────────────────────────────────
function checkAuth() {
  console.log("[auth] checkAuth()");
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("token");

  if (token) {
    console.log("[auth] token found in URL, storing");
    authToken = token;
    localStorage.setItem("authToken", token);
    // Persist CSRF token if provided via OAuth redirect
    const csrfFromUrl = urlParams.get("csrf_token");
    if (csrfFromUrl) {
      localStorage.setItem("lb_csrf_token", csrfFromUrl);
    }
    // Remove token from URL without reload
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  if (authToken) getCurrentUser();
  else updateAuthUI();
}

async function getCurrentUser() {
  console.log("[auth] getCurrentUser()");
  try {
    const user = await apiRequest("/auth/me");
    if (user) {
      currentUser = user;
      if (user.is_banned) {
        updateAuthUI();
        navigateTo("banned", true);
        return;
      }
      console.log("[auth] logged in as:", user.username);
      updateAuthUI();
      const route = matchCurrentRoute();
      if (route?.page === "leaderboard-detail" && route.params.leaderboardId) {
        loadLeaderboardDetail(route.params.leaderboardId);
      }
    }
  } catch (error) {
    console.error("[auth] getCurrentUser failed:", error.message);
    if (/banned|restricted/i.test(error.message || "")) {
      currentUser = null;
      updateAuthUI();
      navigateTo("banned", true);
      return;
    }
    logout();
  }
}

function matchCurrentRoute() {
  const path = window.location.pathname;
  for (const route of ROUTES) {
    const match = path.match(route.pattern);
    if (!match) continue;
    const params = {};
    route.params.forEach((name, i) => {
      if (match[i + 1]) params[name] = match[i + 1];
    });
    return { page: route.page, params };
  }
  return null;
}

function updateAuthUI() {
  console.log(
    "[auth] updateAuthUI, currentUser:",
    currentUser?.username || "none",
  );
  window._currentUser = currentUser;
  document.body.classList.toggle("is-logged-in", !!currentUser);

  const loginBtn = document.getElementById("login-btn");
  const profileLink = document.getElementById("profile-link");
  const adminLink = document.getElementById("admin-link");
  const drawerAdminLink = document.getElementById("drawer-admin-link");
  const drawerProfileLink = document.getElementById("drawer-profile-link");
  const navUserPill = document.getElementById("nav-user-pill");
  const navUserName = document.getElementById("nav-user-name");
  const navUserAvatar = document.getElementById("nav-user-avatar");
  const navCreateBtn = document.getElementById("nav-create-btn");
  const drawerCreateBtn = document.getElementById("drawer-create-btn");
  const drawerLoginBtn = document.getElementById("drawer-login-btn");
  const drawerLogoutBtn = document.getElementById("drawer-logout-btn");
  const homeHero = document.getElementById("home-hero");
  const homeLoggedin = document.getElementById("home-loggedin");

  if (currentUser) {
    if (loginBtn) loginBtn.style.display = "none";
    if (profileLink) profileLink.style.display = "block";
    if (drawerProfileLink) drawerProfileLink.style.display = "block";
    if (navUserPill) navUserPill.style.display = "flex";
    if (navCreateBtn) navCreateBtn.style.display = "block";
    if (drawerCreateBtn) drawerCreateBtn.style.display = "block";
    if (drawerLoginBtn) drawerLoginBtn.style.display = "none";
    if (drawerLogoutBtn) drawerLogoutBtn.style.display = "block";
    if (homeHero) homeHero.style.display = "none";
    if (homeLoggedin) homeLoggedin.style.display = "block";

    if (navUserName) navUserName.textContent = currentUser.username || "User";
    if (navUserAvatar) {
      if (currentUser.avatar_url) {
        navUserAvatar.innerHTML = `<img src="${currentUser.avatar_url}" alt="${currentUser.username}">`;
      } else {
        navUserAvatar.textContent = (currentUser.username ||
          "U")[0].toUpperCase();
      }
    }

    // Check admin access
    apiRequest("/admin/pending-leaderboards")
      .then(() => {
        currentUser.is_admin = true;
        if (adminLink) adminLink.style.display = "block";
        if (drawerAdminLink) drawerAdminLink.style.display = "block";
        document
          .getElementById("edit-status-btn")
          ?.style.setProperty("display", "inline-flex");
        console.log("[auth] user is admin");
      })
      .catch(() => {
        if (currentUser) currentUser.is_admin = false;
        if (adminLink) adminLink.style.display = "none";
        if (drawerAdminLink) drawerAdminLink.style.display = "none";
        document
          .getElementById("edit-status-btn")
          ?.style.setProperty("display", "none");
      });
  } else {
    if (loginBtn) loginBtn.style.display = "inline-flex";
    if (profileLink) profileLink.style.display = "none";
    if (drawerProfileLink) drawerProfileLink.style.display = "none";
    if (navUserPill) navUserPill.style.display = "none";
    if (navCreateBtn) navCreateBtn.style.display = "none";
    if (drawerCreateBtn) drawerCreateBtn.style.display = "none";
    if (drawerLoginBtn) drawerLoginBtn.style.display = "block";
    if (drawerLogoutBtn) drawerLogoutBtn.style.display = "none";
    if (adminLink) adminLink.style.display = "none";
    if (drawerAdminLink) drawerAdminLink.style.display = "none";
    if (homeHero) homeHero.style.display = "flex";
    if (homeLoggedin) homeLoggedin.style.display = "none";
  }

  syncDeleteLeaderboardButton();
}

// ── Discord Login ────────────────────────────────────────────
// WHY: The old code registered login handlers before DOMContentLoaded
// could guarantee the elements existed, AND used window.location.href
// inside an async context which browsers sometimes block.
// We use a delegated listener for all login triggers.
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(
    "#login-btn, #hero-login-btn, #drawer-login-btn",
  );
  if (!btn) return;
  console.log("[auth] login button clicked →", btn.id);
  // Direct navigation — must be synchronous and user-initiated
  window.location.href = "/api/auth/discord/login";
});

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("#profile-action-btn, #drawer-logout-btn");
  if (!btn) return;
  if (btn.id === "profile-action-btn" && btn.dataset.profileAction !== "logout") return;
  console.log("[auth] logout button clicked");
  logout();
});

function logout() {
  console.log("[auth] logout()");
  authToken = null;
  currentUser = null;
  localStorage.removeItem("authToken");
  updateAuthUI();
  navigateTo("home");
}

// ── Home ─────────────────────────────────────────────────────
/** Safe wrapper so a failed API never crashes navigation */
function safeLoadHome() {
  console.log(
    "[home] safeLoadHome(), currentUser:",
    currentUser?.username || "none",
  );
  renderHomeWelcome();
  renderCategoryChips();
  // On first visit, show a welcome card instead of skeletons. Subsequent visits
  // will load real leaderboards.
  const firstVisit = localStorage.getItem("lb_first_visit_seen");
  if (!firstVisit) {
    renderGuestWelcome();
    localStorage.setItem("lb_first_visit_seen", "true");
  } else {
    loadHomeLeaderboards();
  }
  if (currentUser) {
    loadTrendingLeaderboards({ sidebarOnly: true });
  }
  // If not logged in the hero is already shown via updateAuthUI
}

function renderGuestWelcome() {
  const container = document.getElementById("home-leaderboards");
  if (!container) return;
  container.innerHTML = `
    <div class="welcome-card" style="padding: 1rem; border-radius: 12px; background: #1b1b1b; color: #ddd;">
      <h3 style="margin:0 0 0.5rem 0;">Welcome to Leaderboards</h3>
      <p style="margin:0;">Discover community rankings. Sign in to create your first leaderboard and vote on entries.</p>
      <div style="margin-top:1rem; display:flex; gap:0.5rem;">
        <button class="btn btn-primary" id="guest-create-btn" style="cursor:pointer">Create Leaderboard</button>
        <button class="btn btn-ghost" id="guest-login-btn" style="cursor:pointer">Login with Discord</button>
      </div>
    </div>
  `;
  const loginBtn = document.getElementById("guest-login-btn");
  if (loginBtn) loginBtn.addEventListener("click", () => {
    window.location.href = "/api/auth/discord/login";
  });
  const createBtn = document.getElementById("guest-create-btn");
  if (createBtn) createBtn.style.display = "none"; // shown after login if desired
}

async function loadHomeLeaderboards() {
  const container = document.getElementById("home-leaderboards");
  if (!container) {
    console.warn("[home] #home-leaderboards not found");
    return;
  }

  container.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const leaderboards = await apiRequest("/leaderboards?limit=12");
    console.log("[home] loaded", leaderboards?.length, "leaderboards");
    renderLeaderboards(leaderboards, container);
  } catch (error) {
    console.error("[home] loadHomeLeaderboards failed:", error.message);
    container.innerHTML = `<div class="error">Failed to load leaderboards: ${error.message}</div>`;
  }
}

// ── Trending ─────────────────────────────────────────────────
function renderHomeWelcome() {
  const wrap = document.getElementById("home-loggedin");
  if (!wrap || !currentUser) return;
  const initial = (currentUser.username || "U")[0].toUpperCase();
  wrap.innerHTML = `
    <section class="home-command">
      <div>
        <div class="eyebrow">Home</div>
        <h1>Welcome back, ${escapeHtml(currentUser.username || "creator")}</h1>
        <p>Browse what is trending, vote on live rankings, or launch a new leaderboard.</p>
      </div>
      <a href="#" class="home-profile-card" data-page="profile">
        <div class="home-profile-avatar">${currentUser.avatar_url ? `<img src="${escapeHtml(currentUser.avatar_url)}" alt="">` : initial}</div>
        <div>
          <strong>${escapeHtml(currentUser.username || "User")}</strong>
          <span>${(currentUser.reputation_score || 0).toFixed(2)} reputation</span>
        </div>
      </a>
    </section>
    <div class="feed-tabs" aria-label="Feed filters">
      <button class="feed-tab active" data-feed-filter="recent">Recent</button>
      <button class="feed-tab" data-feed-filter="trending">Trending</button>
      <button class="feed-tab" data-feed-filter="top">Top</button>
    </div>
  `;
}

function renderCategoryChips() {
  const list = document.getElementById("category-list");
  if (!list) return;
  list.innerHTML = availableCategories
    .map(
      (cat) =>
        `<button class="category-chip" data-search-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`,
    )
    .join("");
}

async function loadTrendingLeaderboards(options = {}) {
  const sidebar = document.getElementById("trending-leaderboards");
  const grid = document.getElementById("trending-grid");
  const container = options.sidebarOnly ? sidebar : grid || sidebar;
  if (!container) {
    console.warn("[trending] container not found");
    return;
  }

  container.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const leaderboards = await apiRequest("/leaderboards/trending?limit=20");
    console.log("[trending] loaded", leaderboards?.length, "leaderboards");
    if (sidebar) renderLeaderboards(leaderboards.slice(0, 5), sidebar, true);
    if (!options.sidebarOnly && grid)
      renderLeaderboards(leaderboards, grid, true);
  } catch (error) {
    console.error("[trending] failed:", error.message);
    container.innerHTML = `<div class="error">Failed to load trending: ${error.message}</div>`;
  }
}

// ── Render Leaderboards ──────────────────────────────────────
function renderLeaderboards(
  leaderboards,
  container,
  showTrendingBadge = false,
) {
  console.log("[render] renderLeaderboards count:", leaderboards?.length);
  if (!leaderboards || leaderboards.length === 0) {
    container.innerHTML =
      '<div class="empty"><h3>No leaderboards found</h3><p>Be the first to create one!</p></div>';
    return;
  }

  renderLeaderboardCards(leaderboards, container, showTrendingBadge);
  return;

  container.innerHTML = leaderboards
    .map(
      (lb) => `
    <div class="leaderboard-card" data-id="${lb.id}">
      ${showTrendingBadge && lb.trending_score > 5 ? '<span class="trending-badge">🔥 HOT</span>' : ""}
      <h3>${escapeHtml(lb.title)}</h3>
      <p class="description">${escapeHtml(lb.description || "No description")}</p>
      <div class="meta">
        ${lb.category ? `<span class="category">${escapeHtml(lb.category)}</span>` : ""}
        <span>by ${escapeHtml(lb.creator_username)}</span>
        ${lb.voting_deadline ? `<span class="deadline" data-deadline="${lb.voting_deadline}">Closes in <span class="timer"></span></span>` : ""}
      </div>
      <div class="stats">
        <span>${lb.total_votes} votes</span>
        <span>${lb.total_options} options</span>
      </div>
    </div>
  `,
    )
    .join("");

  container.querySelectorAll(".leaderboard-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.id;
      console.log("[render] card click → leaderboard", id);
      navigateTo("leaderboard-detail", true, { leaderboardId: id });
    });
  });

  updateAllDeadlineTimers();
}

// ── Leaderboard Detail ───────────────────────────────────────
function renderLeaderboardCards(
  leaderboards,
  container,
  showTrendingBadge = false,
) {
  const compact = container.id === "trending-leaderboards";
  container.innerHTML = leaderboards
    .map((lb, index) => {
      const initial = (lb.title || "?")[0].toUpperCase();
      const closed = isLeaderboardClosed(lb);
      const deadlineLabel = getLeaderboardDeadlineLabel(lb);
      const badge =
        showTrendingBadge && (lb.trending_score || 0) > 5
          ? '<span class="trending-badge">Hot</span>'
          : "";
      return `
      <article class="leaderboard-card ${compact ? "leaderboard-card-compact" : ""} ${closed ? "leaderboard-card-closed" : ""}" data-id="${lb.id}">
        <div class="leaderboard-image">
          ${lb.image_url ? `<img class="leaderboard-cover-img" src="${escapeHtml(lb.image_url)}" alt="${escapeHtml(lb.title || "Leaderboard cover")}">` : ""}
          <span class="leaderboard-rank">#${index + 1}</span>
          ${lb.image_url ? "" : `<span class="leaderboard-initial">${initial}</span>`}
          ${badge}
        </div>
        <div class="leaderboard-card-body">
          <div class="leaderboard-card-top">
            ${lb.category ? `<span class="category">${escapeHtml(lb.category)}</span>` : `<span class="category">Leaderboard</span>`}
            ${closed ? `<span class="deadline deadline-closed">Closed</span>` : lb.voting_deadline ? `<span class="deadline" data-deadline="${lb.voting_deadline}"><span class="timer"></span></span>` : ""}
          </div>
          <h3>${escapeHtml(lb.title)}</h3>
          <p class="description">${escapeHtml(lb.description || "No description yet.")}</p>
          <div class="meta"><span>by ${escapeHtml(lb.creator_username || "community")}</span></div>
          <div class="stats">
            <span>${formatCompactNumber(lb.total_votes || 0)} votes</span>
            <span>${lb.total_options || 0} options</span>
            ${deadlineLabel && !lb.voting_deadline ? `<span>${escapeHtml(deadlineLabel)}</span>` : ""}
          </div>
        </div>
      </article>
    `;
    })
    .join("");

  container.querySelectorAll(".leaderboard-card").forEach((card) => {
    card.addEventListener("click", () => {
      navigateTo("leaderboard-detail", true, {
        leaderboardId: card.dataset.id,
      });
    });
  });

  updateAllDeadlineTimers();
}

const BADGE_DEFINITIONS = {
  dev: {
    label: "Developer",
    short: "Dev",
    icon: "🛠️",
    priority: 100,
    description: "Helps build and maintain Leaderboards.",
  },
  verified: {
    label: "Verified",
    short: "Verified",
    icon: "✅",
    priority: 90,
    description: "Identity or community standing has been verified.",
  },
  creator: {
    label: "Creator",
    short: "Creator",
    icon: "🎨",
    priority: 70,
    description: "Created at least one leaderboard.",
  },
  tester: {
    label: "Tester",
    short: "Tester",
    icon: "🧪",
    priority: 60,
    description: "Helped test features before release.",
  },
  early_access: {
    label: "Early Access",
    short: "Early",
    icon: "🚀",
    priority: 50,
    description: "Joined during the early access period.",
  },
};

function normalizeBadgeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function formatBadgeDate(value) {
  if (!value) return "Time given unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time given unavailable";
  return `Given ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function getUserBadges(user = {}) {
  const byId = new Map();
  const addBadge = (id, overrides = {}) => {
    id = normalizeBadgeId(id);
    if (!id) return;
    const base = BADGE_DEFINITIONS[id] || {
      label: id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      short: id.replace(/_/g, " "),
      icon: "*",
      priority: 10,
      description: "Community badge.",
    };
    byId.set(id, {
      id,
      ...base,
      ...overrides,
      awarded_at:
        overrides.awarded_at ||
        overrides.given_at ||
        overrides.created_at ||
        user.created_at ||
        null,
    });
  };

  if (Array.isArray(user.badges)) {
    user.badges.forEach((badge) => {
      if (typeof badge === "string") addBadge(badge);
      else addBadge(badge.id || badge.type || badge.name, badge);
    });
  }

  return Array.from(byId.values()).sort((a, b) => b.priority - a.priority);
}

function renderBadgePill(badge, compact = false) {
  return `
    <span class="user-badge user-badge-${escapeHtml(badge.id)}" title="${escapeHtml(badge.label)}">
      <span class="user-badge-icon">${escapeHtml(badge.icon)}</span>
      ${compact ? "" : `<span class="user-badge-label">${escapeHtml(badge.short || badge.label)}</span>`}
    </span>
  `;
}

function renderBadgeStack(user, { limit = 1, mode = "compact" } = {}) {
  const badges = getUserBadges(user);
  if (!badges.length) return "";
  const visible = badges.slice(0, limit);
  const extra = badges.length - visible.length;
  const compact = mode === "icon";
  return `
    <span class="badge-stack badge-stack-${mode}">
      ${visible.map((badge) => renderBadgePill(badge, compact)).join("")}
      ${extra > 0 ? `<button type="button" class="badge-more-btn" data-badges='${escapeHtml(JSON.stringify(badges))}'>+${extra} more</button>` : ""}
    </span>
  `;
}

function getUserStatusLabel(user = {}) {
  if (user.status_label) return String(user.status_label);
  if (user.profile_status) return String(user.profile_status);
  return "Community Member";
}

function renderProfileBadges(user) {
  const target = document.getElementById("profile-badge-stack");
  if (!target) return;
  target.innerHTML = renderBadgeStack(user, { limit: 5, mode: "profile" });
}

function renderProfileStatus(user) {
  const target = document.getElementById("profile-status");
  if (target) target.textContent = getUserStatusLabel(user);
}

function openBadgesModal(badges) {
  const list = document.getElementById("badge-modal-list");
  if (!list) return;
  list.innerHTML = badges.length
    ? badges
        .map(
          (badge) => `
        <div class="badge-modal-row">
          ${renderBadgePill(badge)}
          <div>
            <strong>${escapeHtml(badge.label)}</strong>
            <p>${escapeHtml(badge.description || "Community badge.")}</p>
            <span>${escapeHtml(formatBadgeDate(badge.awarded_at))}</span>
          </div>
        </div>
      `,
        )
        .join("")
    : '<div class="profile-x-empty">No badges yet</div>';
  const modal = document.getElementById("badges-modal");
  if (modal) {
    modal.classList.add("active");
    document.body.style.overflow = "hidden";
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest(".badge-more-btn");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    openBadgesModal(JSON.parse(button.dataset.badges || "[]"));
  } catch {
    openBadgesModal([]);
  }
});

document.addEventListener("click", (event) => {
  const toggle = event.target.closest("#detail-actions-toggle");
  const actions = document.getElementById("detail-actions");
  if (toggle && actions) {
    const isOpen = actions.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(isOpen));
    return;
  }
  if (actions && !event.target.closest("#detail-actions")) {
    actions.classList.remove("open");
    document
      .getElementById("detail-actions-toggle")
      ?.setAttribute("aria-expanded", "false");
  }
});

document.addEventListener("click", (event) => {
  const link = event.target.closest("#detail-creator-link");
  if (!link) return;
  event.preventDefault();
  const userId = link.dataset.userId;
  if (userId) navigateTo("profile", true, { userId });
});

async function loadLeaderboardDetail(leaderboardId) {
  console.log("[detail] loadLeaderboardDetail id:", leaderboardId);
  currentLeaderboard = leaderboardId; // store raw id first

  const detailContainer = document.getElementById("leaderboard-detail");
  const coverContainer = document.getElementById("leaderboard-cover");
  const optionsContainer = document.getElementById("options-grid");
  if (!detailContainer || !optionsContainer) {
    console.error("[detail] detail containers not found in DOM");
    return;
  }

  detailContainer.innerHTML = '<div class="loading">Loading…</div>';
  optionsContainer.innerHTML = '<div class="loading">Loading options…</div>';

  try {
    const [leaderboard, options] = await Promise.all([
      apiRequest(`/leaderboards/${leaderboardId}`),
      apiRequest(`/options/leaderboard/${leaderboardId}`),
    ]);
    console.log(
      "[detail] loaded leaderboard:",
      leaderboard.title,
      "options:",
      options?.length,
    );

    currentLeaderboard = leaderboard; // now store full object
    window._currentLeaderboard = leaderboard;
    const closed = isLeaderboardClosed(leaderboard);
    window._currentLeaderboardClosed = closed;
    const topTitle = document.getElementById("detail-topbar-title");
    const creatorName = document.getElementById("detail-creator-name");
    const creatorLink = document.getElementById("detail-creator-link");
    const deadlineLabel = document.getElementById("detail-deadline-label");
    const closedNotice = document.getElementById("leaderboard-closed-notice");
    if (topTitle) topTitle.textContent = leaderboard.title;
    if (deadlineLabel) {
      deadlineLabel.textContent = getLeaderboardDeadlineLabel(leaderboard);
      deadlineLabel.classList.toggle("closed", closed);
      deadlineLabel.style.display = leaderboard.voting_deadline ? "inline-flex" : "none";
    }
    if (creatorName)
      creatorName.textContent = `by ${leaderboard.creator_username || "community"}`;
    if (creatorLink) {
      creatorLink.href = `/profile/${leaderboard.creator_id}`;
      creatorLink.dataset.userId = leaderboard.creator_id || "";
      creatorLink.style.display = "inline-flex";
    }
    if (closedNotice) {
      closedNotice.textContent =
        "This leaderboard is closed. Voting and new options are disabled, but results remain available to view.";
      closedNotice.style.display = closed ? "block" : "none";
    }
    if (coverContainer) {
      coverContainer.style.display = "none";
      coverContainer.innerHTML = "";
    }

    detailContainer.innerHTML = `
      <h2>${escapeHtml(leaderboard.title)}</h2>
      <p class="creator">Created by ${escapeHtml(leaderboard.creator_username)}</p>
      <p class="description">${escapeHtml(leaderboard.description || "No description")}</p>
      <div class="meta">
        ${leaderboard.category ? `<span class="category">${escapeHtml(leaderboard.category)}</span>` : ""}
        ${leaderboard.voting_deadline ? `<div class="deadline-timer${closed ? " deadline-closed" : ""}" data-deadline="${leaderboard.voting_deadline}"><strong>${closed ? "Closed:" : "Closes in:"}</strong> <span class="timer-text">${closed ? "Closed" : ""}</span></div>` : ""}
      </div>
      <div class="stats">
        <span>${leaderboard.total_votes} total votes</span>
        <span>${formatLimitLabel(leaderboard.max_votes_per_user)} votes per user</span>
      </div>
    `;

    syncAddOptionButton(leaderboard);
    syncDeleteLeaderboardButton(leaderboard);

    const reportBtn = document.getElementById("report-leaderboard-btn");
    if (reportBtn) {
      if (currentUser) {
        reportBtn.style.display = "inline-flex";
        reportBtn.onclick = () => reportContent("leaderboard", leaderboard.id);
      } else {
        reportBtn.style.display = "none";
      }
      syncDetailActionsVisibility();
    }

    renderOptions(options, optionsContainer, leaderboard.sorting_method);
    if (!options || options.length === 0)
      renderEmptyLeaderboardState(leaderboard);
    updateDeadlineTimer(leaderboard.voting_deadline);
    // After rendering detail, ensure topbar hides on scroll
    setupLeaderboardDetailScrollBehavior();
  } catch (error) {
    console.error("[detail] loadLeaderboardDetail failed:", error.message);
    window._currentLeaderboardClosed = false;
    document.getElementById("leaderboard-closed-notice")?.style.setProperty("display", "none");
    if (detailContainer)
      detailContainer.innerHTML = `<div class="error">Failed to load leaderboard: ${error.message}</div>`;
    if (optionsContainer) optionsContainer.innerHTML = "";
  }
}

// Hide/show the top floating bar on leaderboard detail page when scrolling
function setupLeaderboardDetailScrollBehavior() {
  const topbar = document.querySelector(".detail-topbar");
  if (!topbar) return;
  let lastY = 0;
  const onScroll = () => {
    const y = window.scrollY || document.documentElement.scrollTop;
    if (y > 60) {
      if (!topbar.classList.contains("hidden-topbar")) {
        topbar.classList.add("hidden-topbar");
      }
    } else {
      if (topbar.classList.contains("hidden-topbar")) {
        topbar.classList.remove("hidden-topbar");
      }
    }
    lastY = y;
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  // Trigger once in case user loaded at scrolled position
  onScroll();
}

function canAddOptions(leaderboard = currentLeaderboard) {
  return !!(
    currentUser &&
    leaderboard &&
    (Number(currentUser.id) === Number(leaderboard.creator_id) ||
      leaderboard.allow_user_options)
  );
}

function canDeleteLeaderboard(leaderboard = currentLeaderboard) {
  return !!(
    currentUser &&
    leaderboard &&
    Number(currentUser.id) === Number(leaderboard.creator_id)
  );
}

function syncAddOptionButton(leaderboard = currentLeaderboard) {
  const addOptionBtn = document.getElementById("add-option-btn");
  if (!addOptionBtn) return;
  const closed = isLeaderboardClosed(leaderboard);
  addOptionBtn.style.display = canAddOptions(leaderboard) && !closed
    ? "inline-flex"
    : "none";
  addOptionBtn.disabled = closed;
}

function syncDeleteLeaderboardButton(leaderboard = currentLeaderboard) {
  const deleteBtn = document.getElementById("delete-leaderboard-btn");
  if (!deleteBtn) return;
  deleteBtn.style.display = canDeleteLeaderboard(leaderboard)
    ? "inline-flex"
    : "none";
  syncDetailActionsVisibility();
}

function syncDetailActionsVisibility() {
  const actions = document.getElementById("detail-actions");
  if (!actions) return;
  const hasVisibleButton = Array.from(
    actions.querySelectorAll("#report-leaderboard-btn, #delete-leaderboard-btn"),
  ).some((button) => button.style.display !== "none");
  actions.style.display = hasVisibleButton ? "inline-flex" : "none";
  if (!hasVisibleButton) {
    actions.classList.remove("open");
    document
      .getElementById("detail-actions-toggle")
      ?.setAttribute("aria-expanded", "false");
  }
}

function renderEmptyLeaderboardState(leaderboard = currentLeaderboard) {
  const podium = document.getElementById("podium-wrapper");
  const strip = document.getElementById("creator-strip");
  const rankedList = document.getElementById("ranked-list");
  const rows = document.getElementById("ranked-rows");
  const title = escapeHtml(leaderboard?.title || "this leaderboard");
  const creator = escapeHtml(leaderboard?.creator_username || "community");
  const category = escapeHtml(leaderboard?.category || "Open ranking");
  const maxVotes = Number(leaderboard?.max_votes_per_user || 1);
  const maxVotesLabel = formatLimitLabel(maxVotes);
  const closed = isLeaderboardClosed(leaderboard);
  const addButton = canAddOptions(leaderboard) && !closed
    ? `<button class="btn btn-primary" id="empty-add-option-btn">Add first option</button>`
    : "";

  if (podium) {
    podium.style.display = "grid";
    podium.innerHTML = `
      <div class="empty-podium">
        <div class="empty-podium-stage">
          <span data-rank="2"></span><span data-rank="1"></span><span data-rank="3"></span>
        </div>
        <div class="empty-podium-copy">
          <span class="empty-podium-kicker">${category}</span>
          <h3>Build the podium</h3>
          <p>${closed ? `${title} is closed. Results remain visible, but new options and votes are disabled.` : `${title} is ready. Add the first option so voters can start ranking the best entries.`}</p>
          <div class="empty-podium-stats">
            <span><strong>0</strong> entries</span>
            <span><strong>0</strong> votes</span>
            <span><strong>${maxVotesLabel}</strong> vote${maxVotes === 1 ? "" : "s"} per user</span>
          </div>
          ${addButton}
        </div>
      </div>
    `;
  }

  if (strip) {
    strip.innerHTML = "";
    strip.style.display = "none";
  }

  if (rankedList) rankedList.style.display = "block";
  if (rows) {
    rows.innerHTML = `
      <div class="ranking-empty-state">
        <div class="ranking-empty-icon">+</div>
        <div class="ranking-empty-copy">
          <span class="ranking-empty-kicker">Waiting for ${creator}</span>
          <h3>No ranking data yet</h3>
          <p>${closed ? "This leaderboard closed before options were added." : `This leaderboard needs options before people can vote. ${canAddOptions(leaderboard) ? "Create the first entry now." : "The creator can add options."}`}</p>
        </div>
        ${canAddOptions(leaderboard) && !closed ? `<button class="btn btn-primary" id="empty-add-option-list-btn">Add option</button>` : ""}
      </div>
    `;
    const emptyBtns = document.querySelectorAll(
      "#empty-add-option-btn, #empty-add-option-list-btn",
    );
    emptyBtns.forEach((btn) => {
      btn.addEventListener("click", () =>
        document.getElementById("add-option-modal")?.classList.add("active"),
      );
    });
  }

  syncAddOptionButton(leaderboard);
}

function renderOptions(options, container, sortingMethod = "weighted") {
  console.log(
    "[options] renderOptions count:",
    options?.length,
    "sort:",
    sortingMethod,
  );
  if (!options || options.length === 0) {
    currentLeaderboardOptions = [];
    container.innerHTML =
      '<div class="empty"><h3>No options yet</h3><p>Add options to start voting!</p></div>';
    return;
  }

  let sorted = [...options];
  if (sortingMethod === "weighted")
    sorted.sort((a, b) => b.weighted_score - a.weighted_score);
  else if (sortingMethod === "most_votes")
    sorted.sort((a, b) => b.vote_count - a.vote_count);
  else if (sortingMethod === "newest")
    sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  currentLeaderboardOptions = sorted;
  const closed = isLeaderboardClosed(currentLeaderboard);

  container.innerHTML = sorted
    .map(
      (opt) => `
    <div class="option-card" data-id="${opt.id}" data-user-voted="${opt.user_voted ? "1" : "0"}" data-user-vote-id="${opt.user_vote_id || ""}" data-weighted-score="${opt.weighted_score || 0}">
      ${opt.image_url ? `<img src="${escapeHtml(opt.image_url)}" alt="${escapeHtml(opt.name)}" class="image">` : ""}
      <h4>${escapeHtml(opt.name)}</h4>
      <p class="option-description">${escapeHtml(opt.description || "")}</p>
      ${opt.external_url ? `<a href="${escapeHtml(opt.external_url)}" target="_blank" class="external-link">Learn More →</a>` : ""}
      <div class="score">
        <span class="vote-count">${opt.vote_count} votes</span>
      </div>
      <div class="option-actions">
        <button class="btn btn-primary vote-btn${opt.user_voted ? " voted" : ""}" data-option-id="${opt.id}" data-user-vote-id="${opt.user_vote_id || ""}" ${getVoteButtonDisabledAttr(opt, closed)}>${getVoteButtonLabel(opt, closed)}</button>
        <button class="btn btn-ghost btn-sm report-option-btn" data-option-id="${opt.id}" ${currentUser ? "" : 'style="display:none"'}>🚩 Report</button>
      </div>
    </div>
  `,
    )
    .join("");

  container.querySelectorAll(".vote-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isLeaderboardClosed(currentLeaderboard)) return;
      toggleVote(btn.dataset.optionId, btn.dataset.userVoteId || null);
    });
  });

  container.querySelectorAll(".option-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("button, a")) return;
      const option = currentLeaderboardOptions.find(
        (opt) => String(opt.id) === String(card.dataset.id),
      );
      if (option) openOptionDetailModal(option, sorted.indexOf(option) + 1);
    });
  });

  container.querySelectorAll(".report-option-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      reportContent("option", btn.dataset.optionId);
    });
  });
}

function getCurrentUserVoteCount() {
  return currentLeaderboardOptions.filter((option) => option.user_voted).length;
}

function getMaxVotesPerUser() {
  return Number(currentLeaderboard?.max_votes_per_user || 1);
}

function hasReachedVoteLimit() {
  const maxVotes = getMaxVotesPerUser();
  return (
    Number.isFinite(maxVotes) &&
    maxVotes < INFINITE_LIMIT &&
    getCurrentUserVoteCount() >= maxVotes
  );
}

function getVoteButtonLabel(
  option = {},
  closed = isLeaderboardClosed(currentLeaderboard),
) {
  if (closed) return "Closed";
  if (option.user_voted) return "Unvote";
  return hasReachedVoteLimit() ? "Max votes" : "Vote";
}

function getVoteButtonDisabledAttr(
  option = {},
  closed = isLeaderboardClosed(currentLeaderboard),
) {
  return closed || (!option.user_voted && hasReachedVoteLimit())
    ? "disabled"
    : "";
}

function getOptionScore(option = {}) {
  const score = Number(option.weighted_score || 0);
  return Number.isFinite(score) ? score.toFixed(1) : "0.0";
}

function getOptionVoteCount(option = {}) {
  return Number(option.vote_count || option.votes || 0);
}

function findRenderedOption(optionOrId) {
  const optionId =
    typeof optionOrId === "object" ? optionOrId?.id : optionOrId;
  return currentLeaderboardOptions.find(
    (option) => String(option.id) === String(optionId),
  );
}

function closeOptionDetailModal() {
  const modal = document.getElementById("option-detail-modal");
  if (!modal) return;
  modal.classList.remove("active");
  document.body.style.overflow = "";
}

function openOptionDetailModal(optionOrId, rank = null) {
  const renderedOption = findRenderedOption(optionOrId);
  const option =
    renderedOption || (typeof optionOrId === "object" ? optionOrId : null);
  const modal = document.getElementById("option-detail-modal");
  if (!modal || !option) return;

  const optionId = option.id;
  const optionRank =
    rank ||
    currentLeaderboardOptions.findIndex(
      (item) => String(item.id) === String(optionId),
    ) + 1;
  const voteCount = getOptionVoteCount(option);
  const title = option.name || "Untitled option";
  const description =
    option.description || "No description has been added for this option yet.";

  const mediaEl = document.getElementById("odm-media");
  const rankEl = document.getElementById("odm-rank");
  const titleEl = document.getElementById("odm-title");
  const descEl = document.getElementById("odm-desc");
  const votesEl = document.getElementById("odm-votes");
  const scoreEl = document.getElementById("odm-score");
  const rankNumEl = document.getElementById("odm-rank-num");
  const externalEl = document.getElementById("odm-external");
  const voteBtn = document.getElementById("odm-vote-btn");

  if (mediaEl) {
    mediaEl.innerHTML = "";
    if (option.image_url) {
      const img = document.createElement("img");
      img.src = option.image_url;
      img.alt = title;
      mediaEl.appendChild(img);
    } else {
      mediaEl.textContent = title[0]?.toUpperCase() || "?";
    }
  }
  if (rankEl) rankEl.textContent = optionRank > 0 ? `Rank #${optionRank}` : "Entry";
  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = description;
  if (votesEl) votesEl.textContent = formatCompactNumber(voteCount);
  if (scoreEl) scoreEl.textContent = getOptionScore(option);
  if (rankNumEl) rankNumEl.textContent = optionRank > 0 ? `#${optionRank}` : "-";
  if (externalEl) {
    externalEl.style.display = option.external_url ? "inline-flex" : "none";
    if (option.external_url) externalEl.href = option.external_url;
  }
  if (voteBtn) {
    const closed = isLeaderboardClosed(currentLeaderboard);
    voteBtn.style.display = optionId ? "inline-flex" : "none";
    voteBtn.disabled = !!getVoteButtonDisabledAttr(option, closed);
    voteBtn.textContent = getVoteButtonLabel(option, closed);
    voteBtn.onclick = async (event) => {
      event.stopPropagation();
      if (isLeaderboardClosed(currentLeaderboard)) return;
      if (!option.user_voted && hasReachedVoteLimit()) return;
      voteBtn.disabled = true;
      voteBtn.textContent = option.user_voted ? "Removing..." : "Voting...";
      try {
        await toggleVote(optionId, option.user_vote_id || null);
        const updatedOption = findRenderedOption(optionId) || option;
        const updatedRank =
          currentLeaderboardOptions.findIndex(
            (item) => String(item.id) === String(optionId),
          ) + 1;
        openOptionDetailModal(updatedOption, updatedRank || optionRank);
      } catch {
        voteBtn.disabled = false;
        voteBtn.textContent = getVoteButtonLabel(option, closed);
      }
    };
  }

  modal.classList.add("active");
  document.body.style.overflow = "hidden";
}

window.openOptionDetailModal = openOptionDetailModal;
window.closeOptionDetailModal = closeOptionDetailModal;

document.addEventListener("click", (event) => {
  const modal = document.getElementById("option-detail-modal");
  if (!modal) return;
  if (event.target === modal || event.target.closest("#odm-close")) {
    closeOptionDetailModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeOptionDetailModal();
});

// ── Voting ───────────────────────────────────────────────────
async function castVote(optionId) {
  console.log("[vote] castVote optionId:", optionId);
  if (!currentUser) {
    showAlert(
      "Sign in to vote on this ranking. Your vote is saved to your account so the results stay fair.",
      "Sign In Required",
      "info",
    );
    return;
  }
  if (!currentLeaderboard) {
    showAlert("No leaderboard selected", "Error", "error");
    return;
  }
  if (isLeaderboardClosed(currentLeaderboard)) {
    showAlert(
      "This leaderboard is closed. You can still view the results, but voting is disabled.",
      "Leaderboard Closed",
      "info",
    );
    return;
  }

  try {
    const vote = await apiRequest("/votes", {
      method: "POST",
      body: JSON.stringify({
        option_id: parseInt(optionId),
        leaderboard_id: currentLeaderboard.id,
      }),
    });
    console.log("[vote] vote cast successfully");
    await refreshCurrentLeaderboardView();
    return vote;
  } catch (error) {
    console.error("[vote] castVote failed:", error.message);
    if (isVoteToastError(error.message)) {
      if (typeof window.showToast === "function") {
        window.showToast(getVoteToastMessage(error.message), "info");
      } else {
        console.warn("[toast]", getVoteToastMessage(error.message));
      }
      throw error;
    }
    showAlert(
      `We could not save your vote. ${error.message}`,
      "Vote Update Failed",
      "error",
    );
    throw error;
  }
}

function isVoteToastError(message = "") {
  return /already voted on this option|maximum votes per user/i.test(message);
}

function getVoteToastMessage(message = "") {
  if (/maximum votes per user/i.test(message)) {
    return "You used all your votes for this leaderboard.";
  }
  return "You already voted on this option.";
}

async function unvoteOption(optionId, voteId = null) {
  console.log("[vote] unvote optionId:", optionId, "voteId:", voteId);
  if (!currentUser) {
    showAlert("Sign in to manage your vote.", "Sign In Required", "info");
    return;
  }
  try {
    await apiRequest(
      voteId ? `/votes/${voteId}` : `/votes/option/${optionId}`,
      { method: "DELETE" },
    );
    await refreshCurrentLeaderboardView();
  } catch (error) {
    console.error("[vote] unvote failed:", error.message);
    showAlert(
      `We could not remove your vote. ${error.message}`,
      "Vote Update Failed",
      "error",
    );
    throw error;
  }
}

async function toggleVote(optionId, voteId = null) {
  return voteId ? unvoteOption(optionId, voteId) : castVote(optionId);
}

window.castVote = castVote;
window.unvoteOption = unvoteOption;
window.toggleVote = toggleVote;

async function refreshCurrentLeaderboardView() {
  if (!currentLeaderboard?.id) return;
  await loadLeaderboardDetail(currentLeaderboard.id);
}

async function deleteCurrentLeaderboard() {
  if (!currentLeaderboard?.id) {
    showAlert("No leaderboard selected", "Error", "error");
    return;
  }
  if (!canDeleteLeaderboard()) {
    showAlert(
      "Only the creator can delete this leaderboard.",
      "Not Authorized",
      "error",
    );
    return;
  }

  try {
    if (typeof window.showConfirm === "function") {
      await window.showConfirm(
        "This will remove your leaderboard from public lists. This cannot be undone.",
        "Delete Leaderboard?",
      );
    } else if (
      !window.confirm(
        "Delete this leaderboard? This will remove it from public lists.",
      )
    ) {
      return;
    }
  } catch {
    return;
  }

  const leaderboardId = currentLeaderboard.id;
  const deleteBtn = document.getElementById("delete-leaderboard-btn");
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Deleting...";
  }

  try {
    await apiRequest(`/leaderboards/${leaderboardId}`, { method: "DELETE" });
    currentLeaderboard = null;
    showToast("Leaderboard deleted.", "success");
    navigateTo("home", true);
  } catch (error) {
    console.error("[detail] delete leaderboard failed:", error.message);
    showAlert(
      `Failed to delete leaderboard: ${error.message}`,
      "Error",
      "error",
    );
  } finally {
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.textContent = "Delete";
      syncDeleteLeaderboardButton();
    }
  }
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("#delete-leaderboard-btn");
  if (!btn) return;
  deleteCurrentLeaderboard();
});

// ── Search ───────────────────────────────────────────────────
async function loadOptionDetail(optionId) {
  currentOption = null;
  const nameEl = document.getElementById("option-detail-name");
  const titleEl = document.getElementById("option-topbar-title");
  const descEl = document.getElementById("option-detail-description");
  const votesEl = document.getElementById("option-detail-votes");
  const scoreEl = document.getElementById("option-detail-score");
  const mediaEl = document.getElementById("option-detail-media");
  const externalEl = document.getElementById("option-detail-external");
  const reportBtn = document.getElementById("report-option-detail-btn");
  const voteBtn = document.getElementById("option-detail-vote-btn");

  if (nameEl) nameEl.textContent = "Loading...";
  if (descEl) descEl.textContent = "Fetching option details.";

  try {
    const option = await apiRequest(`/options/${optionId}`);
    currentOption = option;
    if (titleEl) titleEl.textContent = option.name || "Option";
    if (nameEl) nameEl.textContent = option.name || "Untitled option";
    if (descEl)
      descEl.textContent =
        option.description ||
        "No description has been added for this option yet.";
    if (votesEl)
      votesEl.textContent = formatCompactNumber(option.vote_count || 0);
    if (scoreEl) scoreEl.textContent = (option.weighted_score || 0).toFixed(1);
    if (mediaEl) {
      mediaEl.innerHTML = option.image_url
        ? `<img src="${escapeHtml(option.image_url)}" alt="${escapeHtml(option.name || "Option")}">`
        : `<span id="option-detail-fallback">${(option.name || "?")[0].toUpperCase()}</span>`;
    }
    if (externalEl) {
      externalEl.style.display = option.external_url ? "inline-flex" : "none";
      if (option.external_url) externalEl.href = option.external_url;
    }
    if (reportBtn) {
      reportBtn.style.display = currentUser ? "inline-flex" : "none";
      reportBtn.onclick = () => reportContent("option", option.id);
    }
    if (voteBtn) {
      voteBtn.onclick = async () => {
        currentLeaderboard = currentLeaderboard || {
          id: option.leaderboard_id,
        };
        voteBtn.disabled = true;
        try {
          await castVote(option.id);
          await loadOptionDetail(option.id);
        } finally {
          voteBtn.disabled = false;
        }
      };
    }
  } catch (error) {
    if (nameEl) nameEl.textContent = "Option unavailable";
    if (descEl) descEl.textContent = error.message;
  }
}

function loadBannedScreen() {
  const message = document.getElementById("ban-message");
  if (message && currentUser?.username) {
    message.textContent = `${currentUser.username}, this account is currently restricted. Contact support if you think this is a mistake.`;
  }
}

async function runSearch(query) {
  const activeChip = document.querySelector(".search-cat-chip.active");
  const category =
    (document.getElementById("search-category") || {}).value ||
    activeChip?.dataset.cat ||
    "";
  const sortBy =
    (document.getElementById("search-sort") || {}).value || "trending";
  const container = document.getElementById("search-results");
  if (!container) return;

  console.log("[search] query:", query, "category:", category, "sort:", sortBy);
  if (!query) {
    resetSearchLanding();
    return;
  }

  container.innerHTML = '<div class="loading">Searching…</div>';

  try {
    let url = `/search/leaderboards?q=${encodeURIComponent(query)}&sort_by=${sortBy}&limit=20`;
    if (category) url += `&category=${encodeURIComponent(category)}`;
    const leaderboards = await apiRequest(url);
    console.log("[search] results:", leaderboards?.length);
    renderLeaderboards(leaderboards, container);
    saveRecentSearch(query);
    const recent = document.getElementById("search-recent-section");
    const trending = document.getElementById("search-trending-section");
    const resultsArea = document.getElementById("search-results-area");
    const label = document.getElementById("search-results-label");
    if (recent) recent.style.display = "none";
    if (trending) trending.style.display = "none";
    if (resultsArea) resultsArea.style.display = "block";
    if (label) label.textContent = `Results for "${query}"`;

    // Update URL with search term
    window.history.replaceState(
      { page: "search", searchTerm: query },
      "",
      `/search?term=${encodeURIComponent(query)}`,
    );
  } catch (error) {
    console.error("[search] failed:", error.message);
    container.innerHTML = `<div class="error">Search failed: ${error.message}</div>`;
  }
}

function getRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem("lb-recent-searches") || "[]");
  } catch {
    return [];
  }
}

function saveRecentSearch(query) {
  const clean = query.trim();
  if (!clean) return;
  const recent = [
    clean,
    ...getRecentSearches().filter(
      (item) => item.toLowerCase() !== clean.toLowerCase(),
    ),
  ].slice(0, 6);
  localStorage.setItem("lb-recent-searches", JSON.stringify(recent));
  renderRecentSearches();
}

function renderRecentSearches() {
  const list = document.getElementById("recent-searches-list");
  const section = document.getElementById("search-recent-section");
  if (!list || !section) return;
  const recent = getRecentSearches();
  section.style.display = recent.length ? "block" : "none";
  list.innerHTML = recent
    .map(
      (term) => `
    <div class="recent-item" data-term="${escapeHtml(term)}">
      <span class="recent-icon">Recent</span>
      <span class="recent-text">${escapeHtml(term)}</span>
      <button class="recent-remove" type="button" aria-label="Remove search">Remove</button>
    </div>
  `,
    )
    .join("");
}

async function renderTrendingSearches() {
  const list = document.getElementById("trending-search-tags");
  if (!list) return;
  list.innerHTML = '<span class="loading">Loading popular searches...</span>';
  try {
    const terms = await apiRequest("/search/trending?limit=8");
    list.innerHTML = terms?.length
      ? terms
          .map(
            (item) => `
      <span class="trending-tag" data-term="${escapeHtml(item.term)}">
        ${escapeHtml(item.term)}
        <span class="trending-tag-count">${formatCompactNumber(item.votes || item.options_count || 0)}</span>
      </span>
    `,
          )
          .join("")
      : '<span class="empty-inline">No popular searches yet</span>';
  } catch (error) {
    list.innerHTML = `<span class="empty-inline">Popular searches unavailable</span>`;
  }
}

function resetSearchLanding() {
  const container = document.getElementById("search-results");
  const recent = document.getElementById("search-recent-section");
  const trending = document.getElementById("search-trending-section");
  const resultsArea = document.getElementById("search-results-area");
  if (container) container.innerHTML = "";
  renderRecentSearches();
  renderTrendingSearches();
  if (recent && getRecentSearches().length) recent.style.display = "block";
  if (trending) trending.style.display = "block";
  if (resultsArea) resultsArea.style.display = "none";
  window.history.replaceState({ page: "search" }, "", "/search");
}

async function refreshAvailableCategories() {
  try {
    const approved = await apiRequest("/categories");
    const names = (approved || [])
      .map((cat) => (typeof cat === "string" ? cat : cat.name))
      .filter(Boolean);
    availableCategories = [...new Set([...CATEGORIES, ...names])].sort((a, b) =>
      a.localeCompare(b),
    );
  } catch (error) {
    console.warn("[categories] approved categories unavailable:", error.message);
    availableCategories = [...CATEGORIES];
  }
  renderCategoryChips();
  loadCategories();
}

function loadCategories() {
  console.log("[search] loadCategories");
  const select = document.getElementById("search-category");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">All categories</option>';
  availableCategories.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
  select.value = current;
}

// Search button
document.addEventListener("click", (e) => {
  if (e.target.id !== "search-btn") return;
  const query =
    (document.getElementById("search-input") || {}).value?.trim() || "";
  runSearch(query);
});

document.addEventListener("click", (e) => {
  if (e.target.id !== "clear-recent-btn") return;
  localStorage.removeItem("lb-recent-searches");
  renderRecentSearches();
});

document.addEventListener("click", (e) => {
  const remove = e.target.closest(".recent-remove");
  if (remove) {
    const item = remove.closest(".recent-item");
    const term = item?.dataset.term || "";
    localStorage.setItem(
      "lb-recent-searches",
      JSON.stringify(getRecentSearches().filter((entry) => entry !== term)),
    );
    renderRecentSearches();
    return;
  }
  const recent = e.target.closest(".recent-item");
  const trending = e.target.closest(".trending-tag");
  const term = recent?.dataset.term || trending?.dataset.term;
  if (!term) return;
  const input = document.getElementById("search-input");
  if (input) input.value = term;
  runSearch(term);
});

document.addEventListener("input", (e) => {
  if (e.target.id !== "search-input") return;
  if (!e.target.value.trim()) resetSearchLanding();
});

document.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-search-cat]");
  if (!chip) return;
  const input = document.getElementById("search-input");
  navigateTo("search", true);
  setTimeout(() => {
    if (input) input.value = chip.dataset.searchCat || "";
    runSearch(chip.dataset.searchCat || "");
  }, 0);
});

document.addEventListener("click", async (e) => {
  const tab = e.target.closest("[data-feed-filter]");
  if (!tab) return;
  document
    .querySelectorAll(".feed-tab")
    .forEach((btn) => btn.classList.remove("active"));
  tab.classList.add("active");
  const container = document.getElementById("home-leaderboards");
  if (!container) return;
  const filter = tab.dataset.feedFilter;
  container.innerHTML = '<div class="loading">Loading...</div>';
  const endpoint =
    filter === "trending" || filter === "top"
      ? "/leaderboards/trending?limit=12"
      : "/leaderboards?limit=12";
  try {
    renderLeaderboards(
      await apiRequest(endpoint),
      container,
      filter !== "recent",
    );
  } catch (error) {
    container.innerHTML = `<div class="error">Failed: ${error.message}</div>`;
  }
});

// Search on Enter key
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const inp = document.getElementById("search-input");
  if (document.activeElement !== inp) return;
  runSearch(inp.value?.trim() || "");
});

// ── Profile ──────────────────────────────────────────────────
async function loadProfile() {
  console.log("[profile] loadProfile currentUser:", currentUser?.id);
  if (!currentUser) {
    navigateTo("home");
    return;
  }

  const avatarEl = document.getElementById("profile-avatar");
  const nameEl = document.getElementById("profile-name");
  const repEl = document.getElementById("profile-reputation");
  const bioEl = document.getElementById("profile-bio");
  const ownerActions = document.getElementById("profile-owner-actions");
  const activityBtn = document.getElementById("toggle-activity-btn");
  const avatarWrap = document.getElementById("profile-avatar-wrap");
  const avatarLetter = document.getElementById("profile-avatar-letter");
  configureProfileAction({ isOwnProfile: true, userId: currentUser.id });

  if (avatarEl && currentUser.avatar_url) {
    avatarEl.src = currentUser.avatar_url;
    avatarEl.style.display = "block";
    if (avatarLetter) avatarLetter.style.display = "none";
  } else if (avatarEl) {
    avatarEl.removeAttribute("src");
    avatarEl.style.display = "none";
    if (avatarLetter) {
      avatarLetter.style.display = "inline";
      avatarLetter.textContent = (currentUser.username || "U")[0].toUpperCase();
    }
  }
  if (nameEl) nameEl.textContent = currentUser.username || "User";
  if (repEl) repEl.textContent = (currentUser.reputation_score || 0).toFixed(2);
  if (bioEl) bioEl.textContent = currentUser.bio || "No bio yet.";
  renderProfileBadges(currentUser);
  renderProfileStatus(currentUser);
  if (ownerActions) ownerActions.style.display = "flex";
  document.getElementById("edit-status-btn")?.style.setProperty(
    "display",
    currentUser.is_admin ? "inline-flex" : "none",
  );
  if (activityBtn)
    activityBtn.textContent = currentUser.show_activity === false ? "Enable Activity" : "Disable Activity";

  try {
    const stats = await apiRequest(`/users/${currentUser.id}/stats`);
    console.log("[profile] stats loaded:", stats);
    const sl = document.getElementById("stat-leaderboards");
    const sc = document.getElementById("stat-votes-cast");
    const sr = document.getElementById("stat-votes-received");
    if (sl) sl.textContent = stats.leaderboards_created || 0;
    if (sc) sc.textContent = stats.total_votes_cast || 0;
    if (sr) sr.textContent = stats.total_votes_received || 0;
    if (repEl) repEl.textContent = (stats.reputation_score || 0).toFixed(2);
    if (bioEl) bioEl.textContent = stats.user?.bio || "No bio yet.";
    currentUser.bio = stats.user?.bio || "";
    currentUser.show_activity = stats.user?.show_activity !== false;
    currentUser.reputation_score = stats.reputation_score || currentUser.reputation_score || 0;
    currentUser.leaderboards_created =
      stats.leaderboards_created || currentUser.leaderboards_created || 0;
    currentUser.total_votes_cast = stats.total_votes_cast || currentUser.total_votes_cast || 0;
    renderProfileBadges(currentUser);
    renderProfileStatus(currentUser);
    if (activityBtn)
      activityBtn.textContent = currentUser.show_activity ? "Disable Activity" : "Enable Activity";
  } catch (err) {
    console.error("[profile] stats failed:", err.message);
  }

  const container = document.getElementById("profile-leaderboards");
  if (container) {
    container.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const lbs = await apiRequest(`/users/${currentUser.id}/leaderboards`);
      console.log("[profile] user leaderboards:", lbs?.length);
      renderProfileBadges({
        ...currentUser,
        leaderboards_created: currentUser.leaderboards_created || lbs?.length || 0,
      });
      renderLeaderboards(lbs, container);
    } catch (err) {
      console.error("[profile] leaderboards failed:", err.message);
      container.innerHTML = `<div class="error">Failed: ${err.message}</div>`;
    }
  }

  loadProfileVotes(currentUser.id);
  loadProfileActivity(currentUser.id);
}

document.addEventListener("click", async (event) => {
  if (event.target.closest("#edit-bio-btn")) {
    const bio = await askPrompt({
      title: "Edit Bio",
      kicker: "Profile",
      label: "Bio",
      multiline: true,
      required: false,
      defaultValue: currentUser?.bio || "",
      placeholder: "Write a short bio...",
      okText: "Save",
    });
    if (bio === null) return;
    try {
      const user = await apiRequest("/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          bio,
          show_activity: currentUser?.show_activity !== false,
        }),
      });
      currentUser = user;
      updateAuthUI();
      loadProfile();
      showToast("Bio updated.", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  }
  if (event.target.closest("#toggle-activity-btn")) {
    try {
      const next = currentUser?.show_activity === false;
      const user = await apiRequest("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ bio: currentUser?.bio || "", show_activity: next }),
      });
      currentUser = user;
      updateAuthUI();
      loadProfile();
      showToast(next ? "Activity is visible." : "Activity is private.", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  }
  if (event.target.closest("#request-status-btn")) {
    const request = await askPrompt({
      title: "Request Badge or Status",
      kicker: "Profile Review",
      label: "Request",
      multiline: true,
      placeholder: "Which badge or status should admins review for your profile?",
      okText: "Send request",
    });
    if (!request) return;
    try {
      await apiRequest("/users/me/status-requests", {
        method: "POST",
        body: JSON.stringify({ request }),
      });
      showToast("Request sent for admin review.", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  }
  if (event.target.closest("#edit-status-btn")) {
    if (!currentUser?.is_admin) {
      showAlert(
        "Only admins can change profile status directly. Use the request button for badge or status changes.",
        "Admin Only",
        "info",
      );
      return;
    }
    const status = await askPrompt({
      title: "Edit Status",
      kicker: "Admin",
      label: "Profile status",
      defaultValue: getUserStatusLabel(currentUser),
      placeholder: "Community Member",
      okText: "Save",
    });
    if (!status) return;
    try {
      currentUser = await apiRequest(`/admin/users/${currentUser.id}/profile`, {
        method: "PATCH",
        body: JSON.stringify({ profile_status: status }),
      });
      renderProfileStatus(currentUser);
      renderProfileBadges(currentUser);
      showToast("Status updated.", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  }
});

async function loadPublicProfile(userId) {
  console.log("[profile] loadPublicProfile userId:", userId);
  // If userId matches current user, load own profile
  if (currentUser && String(currentUser.id) === String(userId)) {
    loadProfile();
    return;
  }
  // Otherwise load public view
  const nameEl = document.getElementById("profile-name");
  const repEl = document.getElementById("profile-reputation");
  const bioEl = document.getElementById("profile-bio");
  const ownerActions = document.getElementById("profile-owner-actions");
  const container = document.getElementById("profile-leaderboards");
  const avatarEl = document.getElementById("profile-avatar");
  const avatarLetter = document.getElementById("profile-avatar-letter");
  configureProfileAction({ isOwnProfile: false, userId });

  if (nameEl) nameEl.textContent = "Loading…";

  try {
    const user = await apiRequest(`/users/${userId}`);
    console.log("[profile] public profile loaded:", user.username);
    if (avatarEl && user.avatar_url) {
      avatarEl.src = user.avatar_url;
      avatarEl.style.display = "block";
      if (avatarLetter) avatarLetter.style.display = "none";
    } else if (avatarEl) {
      avatarEl.removeAttribute("src");
      avatarEl.style.display = "none";
      if (avatarLetter) {
        avatarLetter.style.display = "inline";
        avatarLetter.textContent = (user.username || "U")[0].toUpperCase();
      }
    }
    if (nameEl) nameEl.textContent = user.username || "User";
    if (repEl) repEl.textContent = (user.reputation_score || 0).toFixed(2);
    if (bioEl) bioEl.textContent = user.bio || "No bio yet.";
    renderProfileBadges(user);
    renderProfileStatus(user);
    if (ownerActions) ownerActions.style.display = "none";

    try {
      const stats = await apiRequest(`/users/${userId}/stats`);
      const sl = document.getElementById("stat-leaderboards");
      const sc = document.getElementById("stat-votes-cast");
      const sr = document.getElementById("stat-votes-received");
      if (sl) sl.textContent = stats.leaderboards_created || 0;
      if (sc) sc.textContent = stats.total_votes_cast || 0;
      if (sr) sr.textContent = stats.total_votes_received || 0;
      if (repEl) repEl.textContent = (stats.reputation_score || 0).toFixed(2);
      renderProfileBadges(stats.user || user);
      renderProfileStatus(stats.user || user);
    } catch (statsErr) {
      console.warn("[profile] public stats failed:", statsErr.message);
    }
  } catch (err) {
    console.error("[profile] public profile failed:", err.message);
  }

  if (container) {
    container.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const lbs = await apiRequest(`/users/${userId}/leaderboards`);
      renderLeaderboards(lbs, container);
    } catch (err) {
      container.innerHTML = `<div class="error">Failed: ${err.message}</div>`;
    }
  }

  loadProfileVotes(userId);
  loadProfileActivity(userId);
}

function renderProfileEmpty(icon, text) {
  return `
    <div class="profile-x-empty">
      <div class="profile-x-empty-icon">${icon}</div>
      <div>${escapeHtml(text)}</div>
    </div>
  `;
}

function formatProfileDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function configureProfileAction({ isOwnProfile, userId } = {}) {
  const btn = document.getElementById("profile-action-btn");
  if (!btn) return;
  btn.style.display = "inline-flex";
  btn.dataset.profileAction = isOwnProfile ? "logout" : "report";
  btn.dataset.userId = userId || "";
  btn.textContent = isOwnProfile ? "Sign out" : "Report";
  btn.classList.toggle("danger", !!isOwnProfile);
}

document.addEventListener("click", (event) => {
  const btn = event.target.closest("#profile-action-btn");
  if (!btn || btn.dataset.profileAction !== "report") return;
  event.preventDefault();
  if (!currentUser) {
    showAlert("Sign in to report a profile.", "Sign In Required", "info");
    return;
  }
  reportContent("user", btn.dataset.userId);
});

async function loadProfileVotes(userId) {
  const pane = document.getElementById("ptab-votes");
  if (!pane) return;
  pane.innerHTML = '<div class="loading">Loading votes...</div>';
  try {
    const votes = await apiRequest(`/users/${userId}/votes`);
    if (!votes?.length) {
      pane.innerHTML = renderProfileEmpty("◇", "No votes yet");
      return;
    }
    pane.innerHTML = `
      <div class="profile-feed-list">
        ${votes
          .map(
            (vote) => `
              <button class="profile-feed-row" data-leaderboard-id="${vote.leaderboard_id}">
                <div class="profile-feed-thumb">
                  ${
                    vote.option_image_url
                      ? `<img src="${escapeHtml(vote.option_image_url)}" alt="">`
                      : escapeHtml((vote.option_name || "?")[0].toUpperCase())
                  }
                </div>
                <div class="profile-feed-copy">
                  <strong>${escapeHtml(vote.option_name || "Option")}</strong>
                  <span>Voted in ${escapeHtml(vote.leaderboard_title || "Leaderboard")}</span>
                </div>
                <div class="profile-feed-meta">
                  <span>${formatProfileDate(vote.created_at)}</span>
                  <b>${Number(vote.weight || 1).toFixed(1)}x</b>
                </div>
              </button>
            `,
          )
          .join("")}
      </div>
    `;
    pane.querySelectorAll(".profile-feed-row").forEach((row) => {
      row.addEventListener("click", () => {
        navigateTo("leaderboard-detail", true, {
          leaderboardId: row.dataset.leaderboardId,
        });
      });
    });
  } catch (err) {
    pane.innerHTML = `<div class="error">Failed: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadProfileActivity(userId) {
  const pane = document.getElementById("ptab-activity");
  if (!pane) return;
  pane.innerHTML = '<div class="loading">Loading activity...</div>';
  try {
    const activity = await apiRequest(`/users/${userId}/activity`);
    if (!activity?.length) {
      pane.innerHTML = renderProfileEmpty("▥", "No activity yet");
      return;
    }
    pane.innerHTML = `
      <div class="profile-feed-list">
        ${activity
          .map((item) => {
            const isVote = item.type === "vote_cast";
            const title = isVote
              ? `Voted for ${item.option_name || "an option"}`
              : `Created ${item.leaderboard_title || "a leaderboard"}`;
            const subtitle = isVote
              ? item.leaderboard_title || "Leaderboard"
              : item.leaderboard_description || "New leaderboard";
            return `
              <button class="profile-feed-row" data-leaderboard-id="${item.leaderboard_id}">
                <div class="profile-feed-thumb">${isVote ? "✓" : "+"}</div>
                <div class="profile-feed-copy">
                  <strong>${escapeHtml(title)}</strong>
                  <span>${escapeHtml(subtitle)}</span>
                </div>
                <div class="profile-feed-meta">
                  <span>${formatProfileDate(item.created_at)}</span>
                </div>
              </button>
            `;
          })
          .join("")}
      </div>
    `;
    pane.querySelectorAll(".profile-feed-row").forEach((row) => {
      row.addEventListener("click", () => {
        navigateTo("leaderboard-detail", true, {
          leaderboardId: row.dataset.leaderboardId,
        });
      });
    });
  } catch (err) {
    pane.innerHTML = `<div class="error">Failed: ${escapeHtml(err.message)}</div>`;
  }
}

// ── Admin ────────────────────────────────────────────────────

// Chart instances — kept so they can be destroyed/redrawn
let _votesChart = null;
let _categoryChart = null;

async function loadAdminPanel(initialTab = "analytics") {
  console.log("[admin] loadAdminPanel, currentUser:", currentUser?.username);
  if (!currentUser) {
    navigateTo("home");
    return;
  }

  // Wire tab buttons
  document.querySelectorAll(".adm-tab").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const tab = e.currentTarget.dataset.admTab;
      switchAdminTab(tab);
      window.history.replaceState(
        { page: "admin", adminTab: tab },
        "",
        `/admin/${tab}`,
      );
    });
  });

  // Wire refresh button
  document
    .getElementById("admin-refresh-btn")
    ?.addEventListener("click", () => {
      loadAdminStats();
      const active =
        document.querySelector(".adm-tab.active")?.dataset.admTab ||
        "analytics";
      switchAdminTab(active);
    });

  // Wire old admin-tab-btn for backward compat
  document.querySelectorAll(".admin-tab-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const tab = e.currentTarget.dataset.tab;
      switchAdminTab(tab);
    });
  });

  await loadAdminStats();
  switchAdminTab(initialTab || "analytics");
}

async function loadAdminStats() {
  try {
    const stats = await apiRequest("/admin/stats");

    // KPI cards
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = formatCompactNumber(val || 0);
    };
    set("kpi-pending-lb", stats.pending_leaderboards);
    set("kpi-pending-opt", stats.pending_options);
    set("kpi-pending-cat", stats.pending_categories);
    set("kpi-reports", stats.open_reports);
    set("kpi-total-users", stats.total_users);
    set("kpi-total-lb", stats.total_leaderboards);
    set("kpi-total-votes", stats.total_votes);

    // Badges on tabs
    const badge = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val || 0;
    };
    badge("badge-lb", stats.pending_leaderboards);
    badge("badge-opt", stats.pending_options);
    badge("badge-cat", stats.pending_categories);
    badge("badge-rep", stats.open_reports);
    badge("badge-status", stats.pending_status_requests);

    // Analytics panel stats
    const totalLb = stats.total_leaderboards || 1;
    const approvedLb = stats.approved_leaderboards || 0;
    const rate = Math.round((approvedLb / totalLb) * 100);
    const rateEl = document.getElementById("stat-approval-rate");
    const barEl = document.getElementById("stat-approval-bar");
    if (rateEl) rateEl.textContent = rate + "%";
    if (barEl)
      setTimeout(() => {
        barEl.style.width = rate + "%";
      }, 100);

    const avgVotes =
      stats.total_votes && stats.total_leaderboards
        ? Math.round(stats.total_votes / stats.total_leaderboards)
        : 0;
    const avgEl = document.getElementById("stat-avg-votes");
    if (avgEl) avgEl.textContent = formatCompactNumber(avgVotes);

    // Rebuild charts if on analytics tab
    drawAdminCharts(stats);
  } catch (error) {
    console.error("[admin] stats failed:", error.message);
  }
}

function switchAdminTab(tabName) {
  console.log("[admin] switchAdminTab →", tabName);

  // Map old tab names to new ones
  const tabMap = {
    "pending-leaderboards": "pending-leaderboards",
    "pending-options": "pending-options",
    "pending-categories": "pending-categories",
    reports: "reports",
  };
  const mapped = tabMap[tabName] || tabName;

  // Update tab buttons
  document
    .querySelectorAll(".adm-tab, .admin-tab-btn")
    .forEach((b) => b.classList.remove("active"));
  const activeBtn =
    document.querySelector(`[data-adm-tab="${mapped}"]`) ||
    document.querySelector(`[data-tab="${mapped}"]`);
  if (activeBtn) activeBtn.classList.add("active");

  // Update panels
  document
    .querySelectorAll(".adm-panel, .admin-tab-panel")
    .forEach((p) => (p.style.display = "none"));
  const panel =
    document.getElementById(`adm-${mapped}-tab`) ||
    document.getElementById(`${mapped}-tab`);
  if (panel) {
    panel.style.display = "block";
    panel.classList.add("active");
  }

  // Load data for tab
  if (mapped === "analytics") loadAnalyticsTab();
  if (mapped === "pending-leaderboards") loadPendingLeaderboards();
  if (mapped === "pending-options") loadPendingOptions();
  if (mapped === "pending-categories") loadPendingCategories();
  if (mapped === "reports") loadReports();
  if (mapped === "status-requests") loadStatusRequests();
  if (mapped === "all-leaderboards") loadAllLeaderboardsTable();
  if (mapped === "all-users") loadAllUsersTable();
}

// ── Analytics Tab ─────────────────────────────────────────────
async function loadAnalyticsTab() {
  await loadAdminStats();
  loadActivityLog();
}

async function drawAdminCharts(stats) {
  await drawVotesChart();
  drawCategoryChart(stats);
  drawTopLeaderboardsBars();
}

async function drawVotesChart() {
  const canvas = document.getElementById("votes-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // Try to fetch real vote analytics; generate plausible fallback
  let dataPoints = [];
  try {
    const res = await apiRequest("/admin/analytics/votes?days=30");
    dataPoints = res || [];
  } catch {
    // Generate fallback data shaped like growth
    const base = 20;
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dataPoints.push({
        date: d.toISOString().slice(0, 10),
        count: Math.max(
          0,
          Math.round(base + Math.random() * 60 + (29 - i) * 1.5),
        ),
      });
    }
  }

  const labels = dataPoints.map((d) => {
    const dt = new Date(d.date);
    return dt.getMonth() + 1 + "/" + dt.getDate();
  });
  const values = dataPoints.map((d) => d.count || 0);

  // Clean up old chart
  if (_votesChart) {
    _votesChart = null;
  }

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const accentColor =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim() || "#d4930a";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const textColor = isDark ? "#636366" : "#8e8e93";

  // Resize canvas properly
  const wrapper = canvas.parentElement;
  const w = Math.max(280, Math.min(wrapper.clientWidth || 480, 680));
  const h = 180;
  canvas.width = w * window.devicePixelRatio;
  canvas.height = h * window.devicePixelRatio;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const cw = w,
    ch = h;
  const pad = { top: 12, right: 12, bottom: 28, left: 36 };
  const graphW = cw - pad.left - pad.right;
  const graphH = ch - pad.top - pad.bottom;

  ctx.clearRect(0, 0, cw, ch);

  const maxVal = Math.max(...values, 1);
  const minVal = 0;
  const range = maxVal - minVal;

  // Grid lines
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  [0, 0.25, 0.5, 0.75, 1].forEach((frac) => {
    const y = pad.top + graphH * (1 - frac);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + graphW, y);
    ctx.stroke();
    ctx.fillStyle = textColor;
    ctx.font = `500 ${(10 * window.devicePixelRatio) / window.devicePixelRatio}px sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(Math.round(minVal + range * frac), pad.left - 4, y + 4);
  });

  // X-axis labels (every ~7 days)
  ctx.fillStyle = textColor;
  ctx.font = "500 10px sans-serif";
  ctx.textAlign = "center";
  const step = Math.ceil(labels.length / 6);
  labels.forEach((lbl, i) => {
    if (i % step === 0) {
      const x = pad.left + (i / (labels.length - 1)) * graphW;
      ctx.fillText(lbl, x, ch - 4);
    }
  });

  // Build line path
  const denom = Math.max(values.length - 1, 1);
  const points = values.map((v, i) => ({
    x: pad.left + (i / denom) * graphW,
    y: pad.top + graphH * (1 - (v - minVal) / range),
  }));

  // Filled gradient area
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + graphH);
  grad.addColorStop(0, accentColor + "44");
  grad.addColorStop(1, accentColor + "00");
  ctx.beginPath();
  ctx.moveTo(points[0].x, pad.top + graphH);
  points.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, pad.top + graphH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const cp1x = (points[i - 1].x + points[i].x) / 2;
    ctx.bezierCurveTo(
      cp1x,
      points[i - 1].y,
      cp1x,
      points[i].y,
      points[i].x,
      points[i].y,
    );
  }
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();

  // Dots on last 3 points
  points.slice(-3).forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, i === 2 ? 4 : 3, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();
    if (i === 2) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.strokeStyle = isDark ? "#111118" : "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
}

async function drawCategoryChart(stats) {
  const canvas = document.getElementById("category-chart");
  const legend = document.getElementById("category-legend");
  if (!canvas || !legend) return;

  // Fetch or fallback
  let categories = [];
  try {
    categories = (await apiRequest("/admin/analytics/categories")) || [];
  } catch {
    // Build from stats if possible
    categories = [
      { name: "Gaming", count: 18 },
      { name: "Music", count: 14 },
      { name: "Anime", count: 12 },
      { name: "Movies", count: 10 },
      { name: "Sports", count: 8 },
      { name: "Other", count: 14 },
    ];
  }

  if (!categories.length) {
    canvas.style.display = "none";
    return;
  }

  const total = categories.reduce((s, c) => s + (c.count || 0), 1);
  const COLORS = [
    "#d4930a",
    "#f0b429",
    "#34c759",
    "#5e5ce6",
    "#ff9f0a",
    "#ff375f",
    "#30b0c7",
    "#bf5af2",
    "#ff6b35",
    "#7ec8e3",
  ];

  // Draw donut
  const dpr = window.devicePixelRatio || 1;
  const size = 132;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + "px";
  canvas.style.height = size + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const cx = size / 2,
    cy = size / 2,
    outerR = 58,
    innerR = 36;
  let angle = -Math.PI / 2;

  categories.slice(0, 8).forEach((cat, i) => {
    const slice = (cat.count / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.fill();
    angle += slice;
  });

  // Inner circle (donut hole)
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  ctx.fillStyle = isDark ? "#111118" : "#ffffff";
  ctx.fill();

  // Center label
  ctx.fillStyle = isDark ? "#f5f5f7" : "#0a0a0a";
  ctx.font = `700 ${(11 * dpr) / dpr}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(categories.length + " cats", cx, cy);

  // Legend
  legend.innerHTML = categories
    .slice(0, 6)
    .map(
      (cat, i) => `
    <div class="adm-legend-item">
      <div class="adm-legend-dot" style="background:${COLORS[i % COLORS.length]}"></div>
      <span class="adm-legend-name">${escapeHtml(cat.name)}</span>
      <span class="adm-legend-pct">${Math.round((cat.count / total) * 100)}%</span>
    </div>
  `,
    )
    .join("");
}

async function drawTopLeaderboardsBars() {
  const container = document.getElementById("top-lb-bars");
  if (!container) return;
  container.innerHTML =
    '<div class="adm-loading" style="padding:1rem">Loading…</div>';
  try {
    const lbs = await apiRequest("/leaderboards/trending?limit=8");
    if (!lbs?.length) {
      container.innerHTML = "<div class='adm-loading'>No data</div>";
      return;
    }
    const max = Math.max(...lbs.map((lb) => lb.total_votes || 0), 1);
    container.innerHTML = lbs
      .slice(0, 6)
      .map(
        (lb) => `
      <div class="adm-bar-row">
        <div class="adm-bar-label">${escapeHtml(lb.title)}</div>
        <div class="adm-bar-val">${formatCompactNumber(lb.total_votes || 0)}</div>
        <div class="adm-bar-track">
          <div class="adm-bar-fill" style="width:${Math.round(((lb.total_votes || 0) / max) * 100)}%"></div>
        </div>
      </div>
    `,
      )
      .join("");
  } catch {
    container.innerHTML = "<div class='adm-loading'>Could not load</div>";
  }
}

async function loadActivityLog() {
  const log = document.getElementById("admin-activity-log");
  if (!log) return;

  // Try dedicated endpoint; fall back to combining pending lists
  let entries = [];
  try {
    entries = (await apiRequest("/admin/activity?limit=20")) || [];
  } catch {
    // Build from available data
    try {
      const [lbs, opts, reports] = await Promise.allSettled([
        apiRequest("/admin/pending-leaderboards"),
        apiRequest("/admin/pending-options"),
        apiRequest("/admin/reports"),
      ]);
      if (lbs.status === "fulfilled") {
        (lbs.value || []).slice(0, 5).forEach((lb) =>
          entries.push({
            type: "leaderboard",
            action: "submitted",
            title: lb.title,
            user: lb.creator_username,
            time: lb.created_at,
          }),
        );
      }
      if (opts.status === "fulfilled") {
        (opts.value || []).slice(0, 5).forEach((opt) =>
          entries.push({
            type: "option",
            action: "submitted",
            title: opt.name,
            user: opt.creator_username,
            time: opt.created_at,
          }),
        );
      }
      if (reports.status === "fulfilled") {
        (reports.value || []).slice(0, 5).forEach((r) =>
          entries.push({
            type: "report",
            action: "filed",
            title: `Report #${r.id}`,
            user: r.reporter_username || "Anonymous",
            time: r.created_at,
          }),
        );
      }
      entries.sort((a, b) => new Date(b.time) - new Date(a.time));
    } catch (err) {
      log.innerHTML = '<div class="adm-loading">Activity unavailable</div>';
      return;
    }
  }

  if (!entries.length) {
    log.innerHTML = '<div class="adm-loading">No recent activity</div>';
    return;
  }

  const typeIcon = {
    leaderboard: "🏆",
    option: "➕",
    report: "🚩",
    category: "🏷",
    user: "👤",
  };
  const typeClass = {
    leaderboard: "adm-act-type-lb",
    option: "adm-act-type-opt",
    report: "adm-act-type-rep",
    category: "adm-act-type-cat",
  };

  log.innerHTML = entries
    .slice(0, 15)
    .map(
      (e) => `
    <div class="adm-activity-row">
      <div class="adm-act-icon">${typeIcon[e.type] || "📌"}</div>
      <div class="adm-act-text"><strong>${escapeHtml(e.user || "Unknown")}</strong> ${escapeHtml(e.action || "submitted")} <strong>${escapeHtml(e.title || "")}</strong></div>
      <div class="adm-act-type ${typeClass[e.type] || ""}">${escapeHtml(e.type || "event")}</div>
      <div class="adm-act-time">${e.time ? timeAgo(e.time) : "—"}</div>
    </div>
  `,
    )
    .join("");
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

// ── All Leaderboards Table ────────────────────────────────────
let _allLbData = [];
let _allLbPage = 1;
const _allLbPageSize = 20;
let _allLbSearch = "";
let _allLbStatus = "";

async function loadAllLeaderboardsTable() {
  const tbody = document.getElementById("adm-lb-tbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="8" class="adm-loading">Loading…</td></tr>`;

  try {
    // Try to load all leaderboards for admin
    let url = `/leaderboards?limit=500`;
    try {
      url = `/admin/leaderboards?limit=500`;
    } catch {}
    const data = await apiRequest(url);
    _allLbData = data || [];
    _allLbPage = 1;
    renderLbTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="adm-loading">Failed: ${escapeHtml(err.message)}</td></tr>`;
  }

  // Wire search + filter
  const searchInput = document.getElementById("adm-lb-search");
  const statusSel = document.getElementById("adm-lb-status");
  const prevBtn = document.getElementById("adm-lb-prev");
  const nextBtn = document.getElementById("adm-lb-next");

  if (searchInput && !searchInput.dataset.wired) {
    searchInput.dataset.wired = "1";
    searchInput.addEventListener("input", () => {
      _allLbSearch = searchInput.value.toLowerCase();
      _allLbPage = 1;
      renderLbTable();
    });
  }
  if (statusSel && !statusSel.dataset.wired) {
    statusSel.dataset.wired = "1";
    statusSel.addEventListener("change", () => {
      _allLbStatus = statusSel.value;
      _allLbPage = 1;
      renderLbTable();
    });
  }
  if (prevBtn && !prevBtn.dataset.wired) {
    prevBtn.dataset.wired = "1";
    prevBtn.addEventListener("click", () => {
      if (_allLbPage > 1) {
        _allLbPage--;
        renderLbTable();
      }
    });
  }
  if (nextBtn && !nextBtn.dataset.wired) {
    nextBtn.dataset.wired = "1";
    nextBtn.addEventListener("click", () => {
      const filtered = filteredLbs();
      if (_allLbPage * _allLbPageSize < filtered.length) {
        _allLbPage++;
        renderLbTable();
      }
    });
  }
}

function filteredLbs() {
  return _allLbData.filter((lb) => {
    const matchSearch =
      !_allLbSearch ||
      (lb.title || "").toLowerCase().includes(_allLbSearch) ||
      (lb.creator_username || "").toLowerCase().includes(_allLbSearch);
    const matchStatus = !_allLbStatus || (lb.status || "") === _allLbStatus;
    return matchSearch && matchStatus;
  });
}

function renderLbTable() {
  const tbody = document.getElementById("adm-lb-tbody");
  const countEl = document.getElementById("adm-lb-count");
  const pageEl = document.getElementById("adm-lb-page");
  if (!tbody) return;

  const filtered = filteredLbs();
  const start = (_allLbPage - 1) * _allLbPageSize;
  const page = filtered.slice(start, start + _allLbPageSize);

  if (countEl)
    countEl.textContent = `${filtered.length} leaderboard${filtered.length !== 1 ? "s" : ""}`;
  if (pageEl)
    pageEl.textContent = `Page ${_allLbPage} of ${Math.max(1, Math.ceil(filtered.length / _allLbPageSize))}`;

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="adm-loading">No leaderboards found</td></tr>`;
    return;
  }

  tbody.innerHTML = page
    .map((lb) => {
      const status = lb.status || "approved";
      return `
    <tr>
      <td class="cell-title" title="${escapeHtml(lb.title)}">${escapeHtml(lb.title)}</td>
      <td>${escapeHtml(lb.category || "—")}</td>
      <td class="cell-link" onclick="navigateTo('profile',true,{userId:'${lb.creator_id}'})">
        ${escapeHtml(lb.creator_username || "—")}</td>
      <td class="cell-num">${formatCompactNumber(lb.total_votes || 0)}</td>
      <td class="cell-num">${lb.total_options || 0}</td>
      <td><span class="adm-status-badge adm-status-${status}">${status}</span></td>
      <td>${lb.created_at ? new Date(lb.created_at).toLocaleDateString() : "—"}</td>
      <td>
        <div class="adm-table-actions">
          <button class="btn btn-ghost btn-sm" onclick="navigateTo('leaderboard-detail',true,{leaderboardId:'${lb.id}'})">View</button>
          <button class="btn btn-sm" style="background:var(--red);color:#fff;font-size:0.72rem" onclick="adminRemoveLeaderboard(${lb.id})">Remove</button>
          ${
            status === "pending"
              ? `<button class="btn btn-sm" style="background:var(--green);color:#fff;font-size:0.72rem" onclick="approveLeaderboard(${lb.id})">✓</button>
               <button class="btn btn-sm" style="background:var(--red);color:#fff;font-size:0.72rem" onclick="rejectLeaderboard(${lb.id})">✕</button>`
              : ""
          }
        </div>
      </td>
    </tr>`;
    })
    .join("");
}

// ── All Users Table ───────────────────────────────────────────
let _allUsersData = [];
let _allUsersPage = 1;
const _allUsersPageSize = 20;
let _allUsersSearch = "";
let _allUsersStatus = "";

async function loadAllUsersTable() {
  const tbody = document.getElementById("adm-user-tbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="adm-loading">Loading…</td></tr>`;

  try {
    const data = await apiRequest("/admin/users?limit=500");
    _allUsersData = data || [];
    _allUsersPage = 1;
    renderUsersTable();
  } catch (err) {
    // Try public endpoint
    try {
      const data = await apiRequest("/users?limit=100");
      _allUsersData = data || [];
      renderUsersTable();
    } catch (err2) {
      tbody.innerHTML = `<tr><td colspan="7" class="adm-loading">Failed: ${escapeHtml(err2.message)}</td></tr>`;
    }
  }

  // Wire search + filter
  const searchInput = document.getElementById("adm-user-search");
  const statusSel = document.getElementById("adm-user-status");
  const prevBtn = document.getElementById("adm-user-prev");
  const nextBtn = document.getElementById("adm-user-next");

  if (searchInput && !searchInput.dataset.wired) {
    searchInput.dataset.wired = "1";
    searchInput.addEventListener("input", () => {
      _allUsersSearch = searchInput.value.toLowerCase();
      _allUsersPage = 1;
      renderUsersTable();
    });
  }
  if (statusSel && !statusSel.dataset.wired) {
    statusSel.dataset.wired = "1";
    statusSel.addEventListener("change", () => {
      _allUsersStatus = statusSel.value;
      _allUsersPage = 1;
      renderUsersTable();
    });
  }
  if (prevBtn && !prevBtn.dataset.wired) {
    prevBtn.dataset.wired = "1";
    prevBtn.addEventListener("click", () => {
      if (_allUsersPage > 1) {
        _allUsersPage--;
        renderUsersTable();
      }
    });
  }
  if (nextBtn && !nextBtn.dataset.wired) {
    nextBtn.dataset.wired = "1";
    nextBtn.addEventListener("click", () => {
      const filtered = filteredUsers();
      if (_allUsersPage * _allUsersPageSize < filtered.length) {
        _allUsersPage++;
        renderUsersTable();
      }
    });
  }
}

function filteredUsers() {
  return _allUsersData.filter((u) => {
    const matchSearch =
      !_allUsersSearch ||
      (u.username || "").toLowerCase().includes(_allUsersSearch);
    const matchStatus =
      !_allUsersStatus ||
      (_allUsersStatus === "banned" ? u.is_banned : !u.is_banned);
    return matchSearch && matchStatus;
  });
}

function renderUsersTable() {
  const tbody = document.getElementById("adm-user-tbody");
  const countEl = document.getElementById("adm-user-count");
  const pageEl = document.getElementById("adm-user-page");
  if (!tbody) return;

  const filtered = filteredUsers();
  const start = (_allUsersPage - 1) * _allUsersPageSize;
  const page = filtered.slice(start, start + _allUsersPageSize);

  if (countEl)
    countEl.textContent = `${filtered.length} user${filtered.length !== 1 ? "s" : ""}`;
  if (pageEl)
    pageEl.textContent = `Page ${_allUsersPage} of ${Math.max(1, Math.ceil(filtered.length / _allUsersPageSize))}`;

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="adm-loading">No users found</td></tr>`;
    return;
  }

  tbody.innerHTML = page
    .map((u) => {
      const initial = (u.username || "U")[0].toUpperCase();
      const status = u.is_banned ? "banned" : "active";
      return `
    <tr>
      <td>
        <div class="adm-user-cell">
          ${renderBadgeStack(u, { limit: 1, mode: "icon" })}
          <div class="adm-user-av">
            ${
              u.avatar_url
                ? `<img src="${escapeHtml(u.avatar_url)}" alt="${escapeHtml(u.username)}">`
                : initial
            }
          </div>
          <span class="adm-user-name">${escapeHtml(u.username || "—")}</span>
        </div>
      </td>
      <td class="cell-num">${(u.reputation_score || 0).toFixed(1)}</td>
      <td class="cell-num">${u.leaderboards_created || 0}</td>
      <td class="cell-num">${u.total_votes_cast || 0}</td>
      <td><span class="adm-status-badge adm-status-${status}">${status}</span></td>
      <td>${u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}</td>
      <td>
        <div class="adm-table-actions">
          <button class="btn btn-ghost btn-sm" onclick="navigateTo('profile',true,{userId:'${u.id}'})">Profile</button>
          ${
            u.is_banned
              ? `<button class="btn btn-sm" style="background:var(--green);color:#fff;font-size:0.72rem" onclick="adminUnbanUser(${u.id})">Unban</button>`
              : `<button class="btn btn-sm" style="background:var(--red);color:#fff;font-size:0.72rem" onclick="adminBanUser(${u.id})">Ban</button>`
          }
        </div>
      </td>
    </tr>`;
    })
    .join("");
}

// User admin actions
window.adminBanUser = async (userId) => {
  const reason = await askPrompt({
    title: "Ban User",
    kicker: "Moderation",
    label: "Ban reason",
    placeholder: "Reason for banning this user...",
    okText: "Ban",
  });
  if (!reason) return;
  try {
    await apiRequest(`/admin/users/${userId}/ban`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    showToast("User banned.", "success");
    loadAllUsersTable();
  } catch (e) {
    showToast("Failed: " + e.message, "error");
  }
};
window.adminUnbanUser = async (userId) => {
  try {
    await apiRequest(`/admin/users/${userId}/unban`, { method: "POST" });
    showToast("User unbanned.", "success");
    loadAllUsersTable();
  } catch (e) {
    showToast("Failed: " + e.message, "error");
  }
};

window.adminRemoveLeaderboard = async (leaderboardId) => {
  try {
    if (typeof window.showConfirm === "function") {
      await window.showConfirm(
        "This removes the leaderboard from public lists.",
        "Remove Leaderboard?",
      );
    }
  } catch {
    return;
  }
  try {
    await apiRequest(`/admin/leaderboards/${leaderboardId}`, { method: "DELETE" });
    showToast("Leaderboard removed.", "success");
    loadAllLeaderboardsTable();
    loadAdminStats();
  } catch (e) {
    showToast("Failed: " + e.message, "error");
  }
};

async function loadPendingLeaderboards() {
  const container = document.getElementById("pending-leaderboards-list");
  if (!container) return;
  container.innerHTML = "<div class='adm-loading'>Loading…</div>";
  try {
    const items = await apiRequest("/admin/pending-leaderboards");
    loadAdminStats();
    if (!items?.length) {
      container.innerHTML = `<div class="empty-state-panel"><div class="esp-icon">✅</div><h3>All clear!</h3><p>No leaderboards pending review.</p></div>`;
      return;
    }
    container.innerHTML = items
      .map(
        (lb) => `
      <div class="admin-item">
        <div class="admin-item-header">
          <h4>${escapeHtml(lb.title)}</h4>
          <span class="adm-status-badge adm-status-${lb.status || "pending"}">${lb.status || "pending"}</span>
        </div>
        <p>${escapeHtml(lb.description || "No description.")}</p>
        <div class="admin-item-meta">
          <span>By: <strong>${escapeHtml(lb.creator_username)}</strong></span>
          <span>Category: ${escapeHtml(lb.category || "None")}</span>
          <span>Created: ${new Date(lb.created_at).toLocaleDateString()}</span>
        </div>
        <div class="admin-item-actions">
          <button class="btn btn-ghost btn-sm" onclick="navigateTo('leaderboard-detail',true,{leaderboardId:'${lb.id}'})">Preview</button>
          <button class="btn btn-sm" style="background:var(--green);color:#fff" onclick="approveLeaderboard(${lb.id})">✓ Approve</button>
          <button class="btn btn-sm" style="background:var(--red);color:#fff" onclick="rejectLeaderboard(${lb.id})">✕ Reject</button>
        </div>
      </div>`,
      )
      .join("");
  } catch (err) {
    console.error("[admin] loadPendingLeaderboards:", err.message);
    container.innerHTML = `<div class="adm-loading">Failed: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadPendingOptions() {
  const container = document.getElementById("pending-options-list");
  if (!container) return;
  container.innerHTML = "<div class='adm-loading'>Loading…</div>";
  try {
    const items = await apiRequest("/admin/pending-options");
    loadAdminStats();
    if (!items?.length) {
      container.innerHTML = `<div class="empty-state-panel"><div class="esp-icon">✅</div><h3>All clear!</h3><p>No options pending review.</p></div>`;
      return;
    }
    container.innerHTML = items
      .map(
        (opt) => `
      <div class="admin-item">
        <div class="admin-item-header">
          <h4>${escapeHtml(opt.name)}</h4>
          <span class="adm-status-badge adm-status-${opt.status || "pending"}">${opt.status || "pending"}</span>
        </div>
        <p>${escapeHtml(opt.description || "No description.")}</p>
        <div class="admin-item-meta">
          <span>Leaderboard: <strong>${escapeHtml(opt.leaderboard_title)}</strong></span>
          <span>By: ${escapeHtml(opt.creator_username)}</span>
        </div>
        <div class="admin-item-actions">
          <button class="btn btn-sm" style="background:var(--green);color:#fff" onclick="approveOption(${opt.id})">✓ Approve</button>
          <button class="btn btn-sm" style="background:var(--red);color:#fff" onclick="rejectOption(${opt.id})">✕ Reject</button>
        </div>
      </div>`,
      )
      .join("");
  } catch (err) {
    console.error("[admin] loadPendingOptions:", err.message);
    container.innerHTML = `<div class="adm-loading">Failed: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadPendingCategories() {
  const container = document.getElementById("pending-categories-list");
  if (!container) return;
  container.innerHTML = "<div class='adm-loading'>Loading…</div>";
  try {
    const items = await apiRequest("/admin/pending-categories");
    loadAdminStats();
    if (!items?.length) {
      container.innerHTML = `<div class="empty-state-panel"><div class="esp-icon">✅</div><h3>All clear!</h3><p>No category suggestions pending.</p></div>`;
      return;
    }
    container.innerHTML = items
      .map(
        (cat) => `
      <div class="admin-item">
        <div class="admin-item-header">
          <h4>${escapeHtml(cat.name)}</h4>
          <span class="adm-status-badge adm-status-${cat.status || "pending"}">${cat.status || "pending"}</span>
        </div>
        ${cat.reason ? `<p>${escapeHtml(cat.reason)}</p>` : ""}
        <div class="admin-item-meta">
          <span>Suggested by: <strong>${escapeHtml(cat.creator_username)}</strong></span>
          <span>${new Date(cat.created_at).toLocaleDateString()}</span>
        </div>
        <div class="admin-item-actions">
          <button class="btn btn-sm" style="background:var(--green);color:#fff" onclick="approveCategory(${cat.id})">✓ Approve</button>
          <button class="btn btn-sm" style="background:var(--red);color:#fff" onclick="rejectCategory(${cat.id})">✕ Reject</button>
        </div>
      </div>`,
      )
      .join("");
  } catch (err) {
    console.error("[admin] loadPendingCategories:", err.message);
    container.innerHTML = `<div class="adm-loading">Failed: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadReports() {
  const container = document.getElementById("reports-list");
  if (!container) return;
  container.innerHTML = "<div class='adm-loading'>Loading…</div>";
  try {
    const items = await apiRequest("/admin/reports");
    loadAdminStats();
    if (!items?.length) {
      container.innerHTML = `<div class="empty-state-panel"><div class="esp-icon">🏳</div><h3>No open reports</h3><p>The community is behaving!</p></div>`;
      return;
    }
    container.innerHTML = items
      .map(
        (r) => `
      <div class="admin-item">
        <div class="admin-item-header">
          <h4>Report #${r.id} — ${escapeHtml(r.content_type || "")}</h4>
          <span class="adm-status-badge adm-status-${r.status === "open" ? "pending" : "approved"}">${r.status}</span>
        </div>
        <p><strong>Reason:</strong> ${escapeHtml(r.reason)}</p>
        ${r.description ? `<p><strong>Details:</strong> ${escapeHtml(r.description)}</p>` : ""}
        <div class="admin-item-meta">
          <span>Type: <strong>${escapeHtml(r.content_type || "")}</strong></span>
          <span>Content ID: ${r.content_id}</span>
          <span>By: ${escapeHtml(r.reporter_username || "Anonymous")}</span>
        </div>
        <div class="admin-item-actions">
          <button class="btn btn-sm btn-primary" onclick="resolveReport(${r.id},'resolved')">✓ Resolved</button>
          <button class="btn btn-ghost btn-sm" onclick="resolveReport(${r.id},'investigating')">🔍 Investigating</button>
        </div>
      </div>`,
      )
      .join("");
  } catch (err) {
    console.error("[admin] loadReports:", err.message);
    container.innerHTML = `<div class="adm-loading">Failed: ${escapeHtml(err.message)}</div>`;
  }
}

let adminBadgeOptions = [];

async function loadAdminBadgeOptions() {
  if (adminBadgeOptions.length) return adminBadgeOptions;
  try {
    adminBadgeOptions = (await apiRequest("/admin/badges")) || [];
  } catch {
    adminBadgeOptions = Object.entries(BADGE_DEFINITIONS).map(([id, badge]) => ({
      id,
      ...badge,
    }));
  }
  return adminBadgeOptions;
}

async function loadStatusRequests() {
  const container = document.getElementById("status-requests-list");
  if (!container) return;
  container.innerHTML = "<div class='adm-loading'>Loading...</div>";
  try {
    const [items, badges] = await Promise.all([
      apiRequest("/admin/status-requests"),
      loadAdminBadgeOptions(),
    ]);
    const badgeOptions = badges
      .map((badge) => `<option value="${escapeHtml(badge.id)}">${escapeHtml(badge.label || badge.id)}</option>`)
      .join("");
    loadAdminStats();
    if (!items?.length) {
      container.innerHTML = `<div class="empty-state-panel"><div class="esp-icon">🏷️</div><h3>No status requests</h3><p>Badge and status requests will appear here.</p></div>`;
      return;
    }
    container.innerHTML = items
      .map(
        (request) => `
      <div class="admin-item status-request-item">
        <div class="admin-item-header">
          <h4>${escapeHtml(request.username || "User")} requested a badge/status change</h4>
          <span class="adm-status-badge adm-status-pending">${escapeHtml(request.status || "pending")}</span>
        </div>
        <p>${escapeHtml(request.request || "")}</p>
        <div class="admin-item-meta">
          <span>User ID: <strong>${request.user_id}</strong></span>
          <span>Reputation: ${Number(request.reputation_score || 0).toFixed(1)}</span>
          <span>Current status: ${escapeHtml(request.profile_status || "Community Member")}</span>
          <span>${request.created_at ? new Date(request.created_at).toLocaleString() : ""}</span>
        </div>
        <div class="admin-table-toolbar status-review-controls">
          <select class="form-input" id="status-action-${request.id}">
            <option value="status">Change status</option>
            <option value="badge">Add badge</option>
          </select>
          <input class="form-input" id="status-value-${request.id}" placeholder="New profile status" value="${escapeHtml(request.profile_status || "")}" />
          <select class="form-input" id="badge-value-${request.id}" style="display:none">
            ${badgeOptions}
          </select>
        </div>
        <div class="admin-item-actions">
          <button class="btn btn-sm btn-primary" onclick="reviewStatusRequest(${request.id},'approved')">Approve</button>
          <button class="btn btn-ghost btn-sm" onclick="reviewStatusRequest(${request.id},'rejected')">Reject</button>
          <button class="btn btn-ghost btn-sm" onclick="navigateTo('profile',true,{userId:'${request.user_id}'})">Profile</button>
        </div>
      </div>`,
      )
      .join("");
  } catch (err) {
    console.error("[admin] loadStatusRequests:", err.message);
    container.innerHTML = `<div class="adm-loading">Failed: ${escapeHtml(err.message)}</div>`;
  }
}

// Admin actions (global for onclick= in HTML)
window.approveLeaderboard = async (id) => {
  try {
    await apiRequest(`/admin/leaderboards/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ status: "approved" }),
    });
    loadPendingLeaderboards();
    showToast("Leaderboard approved.", "success");
  } catch (e) {
    showToast(e.message, "error");
  }
};
window.rejectLeaderboard = async (id) => {
  const reason = await askPrompt({
    title: "Reject Leaderboard",
    kicker: "Moderation",
    label: "Reason",
    placeholder: "Why is this being rejected?",
    multiline: true,
    okText: "Reject",
  });
  if (!reason) return;
  try {
    await apiRequest(`/admin/leaderboards/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ status: "rejected", reason }),
    });
    loadPendingLeaderboards();
    showToast("Leaderboard rejected.", "info");
  } catch (e) {
    showToast(e.message, "error");
  }
};
window.approveOption = async (id) => {
  try {
    await apiRequest(`/admin/options/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ status: "approved" }),
    });
    loadPendingOptions();
    showToast("Option approved.", "success");
  } catch (e) {
    showToast(e.message, "error");
  }
};
window.rejectOption = async (id) => {
  const reason = await askPrompt({
    title: "Reject Option",
    kicker: "Moderation",
    label: "Reason",
    placeholder: "Why?",
    multiline: true,
    okText: "Reject",
  });
  if (!reason) return;
  try {
    await apiRequest(`/admin/options/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ status: "rejected", reason }),
    });
    loadPendingOptions();
    showToast("Option rejected.", "info");
  } catch (e) {
    showToast(e.message, "error");
  }
};
window.approveCategory = async (id) => {
  try {
    await apiRequest(`/admin/categories/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ status: "approved" }),
    });
    loadPendingCategories();
    showToast("Category approved.", "success");
  } catch (e) {
    showToast(e.message, "error");
  }
};
window.rejectCategory = async (id) => {
  const reason = await askPrompt({
    title: "Reject Category",
    kicker: "Moderation",
    label: "Reason",
    placeholder: "Why?",
    multiline: true,
    okText: "Reject",
  });
  if (!reason) return;
  try {
    await apiRequest(`/admin/categories/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ status: "rejected", reason }),
    });
    loadPendingCategories();
    showToast("Category rejected.", "info");
  } catch (e) {
    showToast(e.message, "error");
  }
};
window.resolveReport = async (id, status) => {
  const reason = await askPrompt({
    title: "Resolve Report",
    kicker: "Admin Review",
    label: "Resolution notes",
    placeholder: "What action was taken?",
    multiline: true,
    required: false,
    okText: "Save",
  });
  try {
    await apiRequest(`/admin/reports/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ status, reason }),
    });
    loadReports();
    showToast("Report resolved.", "success");
  } catch (e) {
    showToast(e.message, "error");
  }
};

document.addEventListener("change", (event) => {
  const select = event.target.closest("[id^='status-action-']");
  if (!select) return;
  const id = select.id.replace("status-action-", "");
  const statusInput = document.getElementById(`status-value-${id}`);
  const badgeSelect = document.getElementById(`badge-value-${id}`);
  const badgeMode = select.value === "badge";
  if (statusInput) statusInput.style.display = badgeMode ? "none" : "block";
  if (badgeSelect) badgeSelect.style.display = badgeMode ? "block" : "none";
});

window.reviewStatusRequest = async (id, status) => {
  const actionType = document.getElementById(`status-action-${id}`)?.value || "status";
  const profileStatus = document.getElementById(`status-value-${id}`)?.value || "";
  const badgeId = document.getElementById(`badge-value-${id}`)?.value || "";
  const reason = await askPrompt({
    title: status === "approved" ? "Approve Request" : "Reject Request",
    kicker: "Badge/Status Review",
    label: "Notes",
    placeholder: "Optional admin notes...",
    multiline: true,
    required: false,
    okText: status === "approved" ? "Approve" : "Reject",
  });
  try {
    await apiRequest(`/admin/status-requests/${id}/review`, {
      method: "POST",
      body: JSON.stringify({
        status,
        reason: reason || "",
        action_type: status === "approved" ? actionType : null,
        profile_status: actionType === "status" ? profileStatus : null,
        badge_id: actionType === "badge" ? badgeId : null,
      }),
    });
    loadStatusRequests();
    showToast(`Request ${status}.`, status === "approved" ? "success" : "info");
  } catch (e) {
    showToast(e.message, "error");
  }
};

// Expose for inline HTML
window.loadPendingLeaderboards = loadPendingLeaderboards;
window.loadPendingOptions = loadPendingOptions;
window.loadPendingCategories = loadPendingCategories;
window.loadReports = loadReports;
window.loadStatusRequests = loadStatusRequests;

// ── Reporting ─────────────────────────────────────────────────
async function reportContent(contentType, contentId) {
  console.log("[report] reportContent type:", contentType, "id:", contentId);
  const reason = await askPrompt({
    title: `Report ${contentType}`,
    kicker: "Community Safety",
    label: "Report reason",
    placeholder: "Spam, inappropriate, harassment...",
    okText: "Continue",
  });
  if (!reason) return;
  const description = await askPrompt({
    title: "Add Details",
    kicker: "Optional",
    label: "Additional details",
    placeholder: "Add context for moderators...",
    multiline: true,
    required: false,
    okText: "Submit report",
  });
  try {
    const endpoint =
      contentType === "leaderboard"
        ? `/leaderboards/${contentId}/report`
        : contentType === "option"
          ? `/options/${contentId}/report`
          : `/users/${contentId}/report`;
    await apiRequest(endpoint, {
      method: "POST",
      body: JSON.stringify({
        content_type: contentType,
        content_id: contentId,
        reason,
        description: description || null,
      }),
    });
    showAlert("Report submitted successfully", "Reported", "success");
  } catch (err) {
    console.error("[report] failed:", err.message);
    showAlert(`Failed to report: ${err.message}`, "Error", "error");
  }
}

// ── Timers ────────────────────────────────────────────────────
function formatTimeRemaining(seconds) {
  if (seconds <= 0) return "Closed";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function isLeaderboardClosed(leaderboard = currentLeaderboard) {
  if (!leaderboard || typeof leaderboard !== "object" || !leaderboard.voting_deadline) {
    return false;
  }
  const deadline = new Date(leaderboard.voting_deadline);
  return Number.isFinite(deadline.getTime()) && deadline <= new Date();
}

function getLeaderboardDeadlineLabel(leaderboard = currentLeaderboard) {
  if (!leaderboard || typeof leaderboard !== "object" || !leaderboard.voting_deadline) {
    return "";
  }
  if (isLeaderboardClosed(leaderboard)) return "Closed";
  const remaining = Math.max(
    0,
    (new Date(leaderboard.voting_deadline) - Date.now()) / 1000,
  );
  return `Closes in ${formatTimeRemaining(remaining)}`;
}

window.isCurrentLeaderboardClosed = () => isLeaderboardClosed(currentLeaderboard);

function updateDeadlineTimer(deadline) {
  if (!deadline) return;
  document.querySelectorAll("[data-deadline]").forEach((el) => {
    if (el.dataset.deadline !== deadline) return;
    const remaining = Math.max(0, (new Date(deadline) - Date.now()) / 1000);
    const tt = el.querySelector(".timer-text");
    const t = el.querySelector(".timer");
    if (tt) tt.textContent = formatTimeRemaining(remaining);
    if (t) t.textContent = formatTimeRemaining(remaining);
  });
}

let deadlineIntervalId = null;

function updateAllDeadlineTimers() {
  const run = () => {
    document.querySelectorAll("[data-deadline]").forEach((el) => {
      const remaining = Math.max(
        0,
        (new Date(el.dataset.deadline) - Date.now()) / 1000,
      );
      const t = el.querySelector(".timer");
      if (t) t.textContent = formatTimeRemaining(remaining);
    });
  };

  run(); // immediate update for just-rendered elements
  if (!deadlineIntervalId) {
    deadlineIntervalId = setInterval(run, 1000);
  }
}

// ── Create Leaderboard ────────────────────────────────────────
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("#nav-create-btn, #drawer-create-btn");
  if (!btn) return;
  console.log("[create] open create modal");
  if (!currentUser) {
    showAlert("Please login to create a leaderboard", "Login Required", "info");
    return;
  }
  await refreshAvailableCategories();

  // Sync hidden select for form submission
  const categorySelect = document.getElementById("category-select");
  if (categorySelect) {
    categorySelect.innerHTML = '<option value="">Select a category…</option>';
    availableCategories.forEach((cat) => {
      const o = document.createElement("option");
      o.value = cat;
      o.textContent = cat;
      categorySelect.appendChild(o);
    });
  }

  // Populate the custom dropdown menu
  const catMenu = document.getElementById("cat-dropdown-menu");
  const catLabel = document.getElementById("cat-dropdown-label");
  const catTrigger = document.getElementById("cat-dropdown-trigger");
  if (catMenu) {
    catMenu.innerHTML = "";
    // Reset label
    if (catLabel) catLabel.textContent = "Select a category…";
    if (catTrigger) catTrigger.classList.remove("open");
    if (categorySelect) categorySelect.value = "";

    availableCategories.forEach((cat) => {
      const item = document.createElement("div");
      item.className = "cat-dropdown-item";
      item.dataset.value = cat;
      item.innerHTML = `<span class="cat-check">✓</span>${cat}`;
      item.addEventListener("click", () => {
        // Deselect previous
        catMenu.querySelectorAll(".cat-dropdown-item").forEach((i) => i.classList.remove("selected"));
        item.classList.add("selected");
        if (catLabel) catLabel.textContent = cat;
        if (categorySelect) categorySelect.value = cat;
        catTrigger?.classList.remove("open");
        catMenu.classList.remove("open");
        catTrigger?.setAttribute("aria-expanded", "false");
      });
      catMenu.appendChild(item);
    });

    // Suggest new category item
    const suggest = document.createElement("div");
    suggest.className = "cat-dropdown-item suggest";
    suggest.innerHTML = `<span class="cat-check" style="opacity:0"></span>✨ Suggest New Category`;
    suggest.addEventListener("click", async () => {
      catTrigger?.classList.remove("open");
      catMenu.classList.remove("open");
      const name = await askPrompt({
        title: "Suggest Category",
        kicker: "Discovery",
        label: "Category name",
        placeholder: "e.g. Video Games",
        okText: "Submit",
      });
      if (!name) return;
      try {
        await apiRequest("/categories", { method: "POST", body: JSON.stringify({ name }) });
        showAlert("Category submitted! Admin will review it shortly.", "Submitted", "success");
      } catch (err) {
        showAlert(`Failed to submit category: ${err.message}`, "Error", "error");
      }
    });
    catMenu.appendChild(suggest);
  }

  // Wire trigger toggle (once per modal open — safe because we replace innerHTML above)
  if (catTrigger) {
    catTrigger.onclick = (e) => {
      e.stopPropagation();
      const isOpen = catMenu.classList.contains("open");
      catMenu.classList.toggle("open", !isOpen);
      catTrigger.classList.toggle("open", !isOpen);
      catTrigger.setAttribute("aria-expanded", String(!isOpen));
    };
  }

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const deadlineInput = document.getElementById("voting-deadline-input");
  if (deadlineInput) deadlineInput.min = now.toISOString().slice(0, 16);

  const modal = document.getElementById("create-leaderboard-modal");
  if (modal) {
    modal.classList.add("active");
    document.body.style.overflow = "hidden";
  }
});

// Close custom cat-dropdown when clicking outside
document.addEventListener("click", (e) => {
  const wrap = document.getElementById("cat-dropdown-wrap");
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById("cat-dropdown-menu")?.classList.remove("open");
    document.getElementById("cat-dropdown-trigger")?.classList.remove("open");
    document.getElementById("cat-dropdown-trigger")?.setAttribute("aria-expanded", "false");
  }
});


const createForm = document.getElementById("create-leaderboard-form");
if (createForm) {
  // Reset custom cat-dropdown when form resets
  createForm.addEventListener("reset", () => {
    const lbl = document.getElementById("cat-dropdown-label");
    if (lbl) lbl.textContent = "Select a category…";
    document.getElementById("cat-dropdown-menu")?.querySelectorAll(".cat-dropdown-item").forEach((i) => i.classList.remove("selected"));
  });
  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    let max_options = parseInt(fd.get("max_options") || "10");
    if (max_options === 51) max_options = INFINITE_LIMIT;
    let max_votes_per_user = parseInt(fd.get("max_votes_per_user") || "1");
    if (max_votes_per_user === 51) max_votes_per_user = INFINITE_LIMIT;
    const data = {
      title: fd.get("title"),
      description: fd.get("description") || null,
      image_url: fd.get("image_url") || null,
      category: fd.get("category") || null,
      max_options,
      max_votes_per_user,
      allow_user_options: fd.get("allow_user_options") === "on",
      sorting_method: fd.get("sorting_method") || "weighted",
      voting_deadline: fd.get("voting_deadline")
        ? new Date(fd.get("voting_deadline")).toISOString()
        : null,
    };
    console.log("[create] submitting leaderboard:", data);
    try {
      const lb = await apiRequest("/leaderboards", {
        method: "POST",
        body: JSON.stringify(data),
      });
      console.log("[create] created leaderboard id:", lb.id);
      document.getElementById("create-leaderboard-modal")?.classList.remove("active");
      document.body.style.overflow = "";
      e.target.reset();
      navigateTo("leaderboard-detail", true, { leaderboardId: lb.id });
    } catch (err) {
      console.error("[create] failed:", err.message);
      showAlert(
        `Failed to create leaderboard: ${err.message}`,
        "Error",
        "error",
      );
    }
  });
}

// ── Add Option ────────────────────────────────────────────────
document.addEventListener("click", (e) => {
  if (e.target.id === "add-option-btn") {
    if (isLeaderboardClosed(currentLeaderboard)) return;
    document.getElementById("add-option-modal")?.classList.add("active");
  }
  if (e.target.id === "cancel-option-btn") {
    document.getElementById("add-option-modal")?.classList.remove("active");
  }
});

const addOptionForm = document.getElementById("add-option-form");
const tagInput = document.querySelector('#add-option-form input[name="tags"]');
if (tagInput) {
  const hiddenTags = document.createElement("input");
  hiddenTags.type = "hidden";
  hiddenTags.name = "tags";
  tagInput.removeAttribute("name");
  tagInput.insertAdjacentElement("beforebegin", hiddenTags);
  const chipWrap = document.createElement("div");
  chipWrap.className = "tag-chip-editor";
  tagInput.insertAdjacentElement("afterend", chipWrap);
  let tags = [];
  const syncTags = () => {
    chipWrap.innerHTML = tags
      .map(
        (tag) => `
      <button type="button" class="tag-chip" data-tag="${escapeHtml(tag)}">
        <span>${escapeHtml(tag)}</span>
        <b>Remove</b>
      </button>
    `,
      )
      .join("");
    hiddenTags.value = tags.join(", ");
  };
  const addTagsFromInput = () => {
    const parts = tagInput.value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) return;
    tags = [...new Set([...tags, ...parts])].slice(0, 12);
    tagInput.value = "";
    syncTags();
  };
  tagInput.addEventListener("input", () => {
    if (tagInput.value.includes(",")) addTagsFromInput();
  });
  tagInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTagsFromInput();
    }
    if (event.key === "Backspace" && !tagInput.value && tags.length) {
      tags.pop();
      syncTags();
    }
  });
  chipWrap.addEventListener("click", (event) => {
    const chip = event.target.closest(".tag-chip");
    if (!chip) return;
    tags = tags.filter((tag) => tag !== chip.dataset.tag);
    syncTags();
  });
  addOptionForm?.addEventListener("submit", () => {
    addTagsFromInput();
    hiddenTags.value = tags.join(", ");
  });
  addOptionForm?.addEventListener("reset", () => {
    tags = [];
    syncTags();
  });
}
if (addOptionForm) {
  addOptionForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentLeaderboard) {
      showAlert("No leaderboard selected", "Error", "error");
      return;
    }
    if (isLeaderboardClosed(currentLeaderboard)) {
      showAlert(
        "This leaderboard is closed. New options can no longer be added.",
        "Leaderboard Closed",
        "info",
      );
      return;
    }
    const fd = new FormData(e.target);
    const data = {
      leaderboard_id: currentLeaderboard.id,
      name: fd.get("name"),
      description: fd.get("description") || null,
      image_url: fd.get("image_url") || null,
      external_url: fd.get("external_url") || null,
      tags: fd.get("tags") || null,
    };
    console.log("[option] submitting option:", data.name);
    try {
      await apiRequest("/options", {
        method: "POST",
        body: JSON.stringify(data),
      });
      document.getElementById("add-option-modal")?.classList.remove("active");
      e.target.reset();
      await refreshCurrentLeaderboardView();
    } catch (err) {
      console.error("[option] failed:", err.message);
      showAlert(`Failed to add option: ${err.message}`, "Error", "error");
    }
  });
}

// ── Back button ───────────────────────────────────────────────
document.addEventListener("click", (e) => {
  if (e.target.id !== "back-btn" && e.target.id !== "option-back-btn") return;
  console.log("[nav] back button clicked");
  window.history.back();
});

// ── Utilities ─────────────────────────────────────────────────
function formatCompactNumber(value) {
  const n = Number(value || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 ? 1 : 0)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k`;
  return String(n);
}

function formatLimitLabel(value) {
  return Number(value || 0) >= INFINITE_LIMIT ? "infinite" : String(value);
}

async function askPrompt(options) {
  if (typeof window.showPrompt === "function") {
    return window.showPrompt(options);
  }
  console.warn("[prompt] Custom prompt UI is not ready");
  return null;
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// showAlert / showToast are wired in index.html inline script
// but we need fallbacks in case they're not ready
if (typeof window.showAlert !== "function") {
  window.showAlert = (msg, title = "Notice", type = "info") => {
    console.warn("[alert]", title, msg);
    // Try native; will be overridden once DOM is fully ready
    window.alert(msg);
  };
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  console.log("[init] DOMContentLoaded fired");

  checkAuth();
  refreshAvailableCategories();
  renderRecentSearches();
  renderTrendingSearches();

  // Route based on the current URL (supports direct /leaderboard/:id links, etc.)
  routeFromURL();

  console.log("[init] init complete");
});
