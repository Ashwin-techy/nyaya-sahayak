/* =========================================================================
   NYAYA SAHAYAK — Frontend application logic
   Vanilla JS, no build step. Talks to the Flask API at API_BASE.
   ========================================================================= */

const API_BASE = "http://localhost:5000/api";

// ---------------------------------------------------------------------
// Auth state — JWT stored in localStorage, decoded user kept in memory
// ---------------------------------------------------------------------
const Auth = {
    TOKEN_KEY: "nyaya_token",
    USER_KEY: "nyaya_user",

    getToken() { return localStorage.getItem(this.TOKEN_KEY); },
    getUser() {
        const raw = localStorage.getItem(this.USER_KEY);
        return raw ? JSON.parse(raw) : null;
    },
    isLoggedIn() { return !!this.getToken(); },
    isAdmin() { return this.getUser()?.role === "admin"; },
    isTourist() { return this.getUser()?.role === "tourist"; },

    setSession(token, user) {
        localStorage.setItem(this.TOKEN_KEY, token);
        localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    },
    clearSession() {
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
    },
};

// ---------------------------------------------------------------------
// API helper — attaches JWT automatically, handles 401 by logging out
// ---------------------------------------------------------------------
async function api(path, { method = "GET", body = null, auth = false } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth) {
        const token = Auth.getToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    let res;
    try {
        res = await fetch(`${API_BASE}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : null,
        });
    } catch (err) {
        throw new Error("Can't reach the server. Make sure the Flask backend is running on port 5000.");
    }

    let data = {};
    try { data = await res.json(); } catch (_) { /* empty body, e.g. some 204s */ }

    if (res.status === 401 && auth) {
        Auth.clearSession();
        render();
        throw new Error(data.error || "Session expired — please sign in again.");
    }

    if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
    }

    return data;
}

// ---------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------
let toastTimer = null;
function showToast(message, type = "default") {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "toast show" + (type === "error" ? " toast-error" : type === "success" ? " toast-success" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.classList.remove("show"); }, 3200);
}

// ---------------------------------------------------------------------
// Simple hash-based router
// ---------------------------------------------------------------------
const Router = {
    current: "landing",
    params: {},

    go(route, params = {}) {
        this.current = route;
        this.params = params;
        window.location.hash = route;
        render();
    },

    init() {
        window.addEventListener("hashchange", () => {
            this.current = (window.location.hash || "#landing").slice(1) || "landing";
            render();
        });
        this.current = (window.location.hash || "#landing").slice(1) || "landing";
    },
};

// Category display labels
const CATEGORY_LABELS = {
    police: "Police interactions",
    tenant: "Tenant rights",
    consumer: "Consumer rights",
    tourist: "Tourist situations",
    cybercrime: "Cybercrime & fraud",
    property: "Property & employment",
};

function categoryLabel(cat) {
    return CATEGORY_LABELS[cat] || (cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : cat);
}

function verdictClass(verdict) {
    return { legal: "legal", illegal: "illegal", conditional: "conditional" }[verdict] || "conditional";
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

function snippet(text, len = 110) {
    if (!text) return "";
    return text.length > len ? text.slice(0, len).trim() + "…" : text;
}

// =========================================================================
// NAVIGATION
// =========================================================================
function renderNav() {
    const nav = document.getElementById("topnav");
    const user = Auth.getUser();

    if (!user) {
        nav.innerHTML = `
      <button class="nav-link" data-route="login">Sign in</button>
      <button class="nav-link" data-route="register">Create account</button>
    `;
    } else if (user.role === "admin") {
        nav.innerHTML = `
      <button class="nav-link" data-route="admin">Admin console</button>
      <span class="nav-link" style="opacity:0.7; cursor:default;">${escapeHtml(user.full_name)}</span>
      <button class="nav-link" id="logoutBtn">Sign out</button>
    `;
    } else {
        nav.innerHTML = `
      <button class="nav-link" data-route="dashboard">My dashboard
        ${user.role === "tourist" ? '<span class="nav-badge">Tourist</span>' : ""}
      </button>
      <span class="nav-link" style="opacity:0.7; cursor:default;">${escapeHtml(user.full_name)}</span>
      <button class="nav-link" id="logoutBtn">Sign out</button>
    `;
    }

    nav.querySelectorAll("[data-route]").forEach(btn => {
        btn.addEventListener("click", () => {
            document.getElementById("topnav").classList.remove("open");
            Router.go(btn.dataset.route);
        });
    });

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            Auth.clearSession();
            showToast("Signed out");
            Router.go("landing");
        });
    }
}

document.getElementById("hamburgerBtn").addEventListener("click", () => {
    const nav = document.getElementById("topnav");
    const expanded = nav.classList.toggle("open");
    document.getElementById("hamburgerBtn").setAttribute("aria-expanded", expanded);
});

document.querySelector(".brand").addEventListener("click", () => {
    Router.go(Auth.isLoggedIn() ? (Auth.isAdmin() ? "admin" : "dashboard") : "landing");
});

// =========================================================================
// LANDING PAGE
// =========================================================================
function renderLanding(root) {
    const tpl = document.getElementById("tpl-landing");
    root.appendChild(tpl.content.cloneNode(true));

    root.querySelectorAll("[data-route]").forEach(btn => {
        btn.addEventListener("click", () => Router.go(btn.dataset.route));
    });

    // Populate category chips from the API (public endpoint, no auth needed)
    api("/categories").then(({ categories }) => {
        const wrap = document.getElementById("landingCategories");
        wrap.innerHTML = categories.map(c =>
            `<button class="chip" data-cat="${c}">${escapeHtml(categoryLabel(c))}</button>`
        ).join("");
        wrap.querySelectorAll(".chip").forEach(chip => {
            chip.addEventListener("click", () => {
                Router.go(Auth.isLoggedIn() ? "dashboard" : "register", { category: chip.dataset.cat });
            });
        });
    }).catch(() => { /* non-critical, fail silently on landing */ });
}

// =========================================================================
// AUTH SCREEN (login / register, with citizen/tourist role toggle)
// =========================================================================
function renderAuth(root, mode) {
    const tpl = document.getElementById("tpl-auth");
    root.appendChild(tpl.content.cloneNode(true));

    let selectedRole = "citizen";
    const isRegister = mode === "register";

    function applyMode() {
        document.getElementById("authTitle").textContent = isRegister ? "Create your account" : "Sign in";
        document.getElementById("authSubtitle").textContent = isRegister
            ? "Free, and takes under a minute."
            : "Welcome back. Your saved rights are right where you left them.";
        document.getElementById("authSubmitBtn").textContent = isRegister ? "Create account" : "Sign in";
        document.getElementById("authSwitchText").textContent = isRegister ? "Already have an account?" : "New here?";
        document.getElementById("authSwitchBtn").textContent = isRegister ? "Sign in instead" : "Create an account";

        document.getElementById("fieldFullName").classList.toggle("hidden", !isRegister);
        document.getElementById("fieldNationality").classList.toggle("hidden", !isRegister);
        document.getElementById("roleToggle").classList.toggle("hidden", !isRegister);
        document.getElementById("fullName").required = isRegister;
    }
    applyMode();

    document.getElementById("roleToggle").querySelectorAll(".role-opt").forEach(opt => {
        opt.addEventListener("click", () => {
            selectedRole = opt.dataset.role;
            document.querySelectorAll(".role-opt").forEach(o => o.classList.toggle("active", o === opt));
            document.getElementById("nationality").placeholder =
                selectedRole === "tourist" ? "e.g. German, Japanese, American" : "e.g. Indian";
        });
    });

    document.getElementById("authSwitchBtn").addEventListener("click", () => {
        Router.go(isRegister ? "login" : "register");
    });

    document.getElementById("authForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById("authError");
        errorEl.textContent = "";

        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const submitBtn = document.getElementById("authSubmitBtn");

        submitBtn.disabled = true;
        const originalText = submitBtn.textContent;
        submitBtn.textContent = isRegister ? "Creating account…" : "Signing in…";

        try {
            let data;
            if (isRegister) {
                const full_name = document.getElementById("fullName").value.trim();
                const nationality = document.getElementById("nationality").value.trim();
                if (!full_name) throw new Error("Please enter your full name.");
                if (password.length < 6) throw new Error("Password must be at least 6 characters.");

                data = await api("/auth/register", {
                    method: "POST",
                    body: { full_name, email, password, role: selectedRole, nationality },
                });
            } else {
                data = await api("/auth/login", { method: "POST", body: { email, password } });
            }

            Auth.setSession(data.token, data.user);
            showToast(`Welcome, ${data.user.full_name.split(" ")[0]}!`, "success");
            Router.go(data.user.role === "admin" ? "admin" : "dashboard");
        } catch (err) {
            errorEl.textContent = err.message;
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
}

// =========================================================================
// DASHBOARD (citizen / tourist)
// =========================================================================
let dashState = { activeCategory: null, lastResults: [] };

async function renderDashboard(root, params = {}) {
    const tpl = document.getElementById("tpl-dashboard");
    root.appendChild(tpl.content.cloneNode(true));

    const user = Auth.getUser();
    const isTourist = user.role === "tourist";

    document.getElementById("dashEyebrow").textContent = isTourist ? "Tourist workspace" : "Citizen workspace";
    document.getElementById("dashGreeting").textContent = `Welcome, ${user.full_name.split(" ")[0]}`;
    document.getElementById("touristPanel").classList.toggle("hidden", !isTourist);

    // ---- Search ----
    document.getElementById("searchForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const query = document.getElementById("searchInput").value.trim();
        if (!query) return;
        await runSearch(query);
    });

    document.getElementById("clearSearchBtn").addEventListener("click", () => {
        document.getElementById("searchResultsWrap").classList.add("hidden");
        document.getElementById("searchInput").value = "";
    });

    // ---- Categories ----
    await loadDashCategories(params.category || null);

    // ---- Saved queries ----
    await loadSavedQueries();

    // If we arrived here wanting a specific category (from landing page chip click)
    if (params.category) {
        await loadCategoryEntries(params.category);
    }
}

async function runSearch(query) {
    const wrap = document.getElementById("searchResultsWrap");
    const grid = document.getElementById("searchResults");
    document.getElementById("searchedQueryText").textContent = `"${query}"`;
    wrap.classList.remove("hidden");
    grid.innerHTML = `<p class="empty-state">Searching the knowledge base…</p>`;

    try {
        const data = await api("/search", { method: "POST", auth: true, body: { query } });
        dashState.lastResults = data.results;

        if (!data.results.length) {
            grid.innerHTML = `<p class="empty-state">${escapeHtml(data.message || "No matches found. Try rephrasing your question.")}</p>`;
            return;
        }

        grid.innerHTML = data.results.map(entry => entryCardHtml(entry, { showScore: true, queryText: query })).join("");
        attachEntryCardHandlers(grid, data.results, query);
    } catch (err) {
        grid.innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
    }
}

async function loadDashCategories(activeCategory) {
    const wrap = document.getElementById("dashCategories");
    try {
        const { categories } = await api("/categories");
        wrap.innerHTML = categories.map(c =>
            `<button class="chip${c === activeCategory ? " active" : ""}" data-cat="${c}">${escapeHtml(categoryLabel(c))}</button>`
        ).join("");
        wrap.querySelectorAll(".chip").forEach(chip => {
            chip.addEventListener("click", () => {
                wrap.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c === chip));
                loadCategoryEntries(chip.dataset.cat);
            });
        });
        if (activeCategory) await loadCategoryEntries(activeCategory);
    } catch (err) {
        wrap.innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
    }
}

async function loadCategoryEntries(category) {
    const grid = document.getElementById("categoryEntries");
    grid.innerHTML = `<p class="empty-state">Loading…</p>`;
    try {
        const { entries } = await api(`/entries?category=${encodeURIComponent(category)}`);
        if (!entries.length) {
            grid.innerHTML = `<p class="empty-state">No entries in this category yet.</p>`;
            return;
        }
        grid.innerHTML = entries.map(entry => entryCardHtml(entry, {})).join("");
        attachEntryCardHandlers(grid, entries, null);
    } catch (err) {
        grid.innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
    }
}

async function loadSavedQueries() {
    const grid = document.getElementById("savedQueries");
    const emptyState = document.getElementById("savedEmptyState");
    const countPill = document.getElementById("savedCount");

    try {
        const { saved_queries } = await api("/saved-queries", { auth: true });
        countPill.textContent = saved_queries.length;

        if (!saved_queries.length) {
            grid.innerHTML = "";
            emptyState.classList.remove("hidden");
            return;
        }
        emptyState.classList.add("hidden");

        grid.innerHTML = saved_queries.map(sq => `<div class="entry-card" data-saved-id="${sq.id}" data-entry-id="${sq.entry.id}">
        <div class="entry-card-top">
          <span class="verdict-seal verdict-${verdictClass(sq.entry.verdict)}-seal">${escapeHtml(sq.entry.verdict)}</span>
        </div>
        <h3 class="entry-card-situation">${escapeHtml(sq.entry.situation)}</h3>
        <p class="saved-card-meta">You searched: "${escapeHtml(sq.query_text)}"</p>
        <p class="entry-card-snippet">${escapeHtml(snippet(sq.entry.simple_explanation))}</p>
        <button class="btn btn-danger btn-sm saved-card-remove" data-remove-saved="${sq.id}">Remove</button>
      </div>
    `).join("");

        grid.querySelectorAll("[data-remove-saved]").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const id = btn.dataset.removeSaved;
                try {
                    await api(`/saved-queries/${id}`, { method: "DELETE", auth: true });
                    showToast("Removed from saved", "success");
                    await loadSavedQueries();
                } catch (err) {
                    showToast(err.message, "error");
                }
            });
        });

        grid.querySelectorAll(".entry-card").forEach(card => {
            card.addEventListener("click", (e) => {
                if (e.target.closest("[data-remove-saved]")) return;
                const sq = saved_queries.find(s => String(s.id) === card.dataset.savedId);
                if (sq) openEntryModal(sq.entry, null);
            });
        });
    } catch (err) {
        grid.innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
    }
}

// ---- Shared entry card renderer ----
function entryCardHtml(entry, { showScore = false } = {}) {
    return `
    <div class="entry-card" data-entry-id="${entry.id}">
      <div class="entry-card-top">
        <span class="verdict-seal verdict-${verdictClass(entry.verdict)}-seal">${escapeHtml(entry.verdict)}</span>
      </div>
      <h3 class="entry-card-situation">${escapeHtml(entry.situation)}</h3>
      <p class="entry-card-snippet">${escapeHtml(snippet(entry.simple_explanation))}</p>
      <div class="entry-card-foot">
        <span class="category-tag">${escapeHtml(categoryLabel(entry.category))}</span>
        ${showScore ? `<span class="match-score">${Math.round(entry.match_score * 100)}% match</span>` : ""}
      </div>
    </div>
  `;
}

function attachEntryCardHandlers(container, entries, queryText) {
    container.querySelectorAll(".entry-card").forEach(card => {
        card.addEventListener("click", () => {
            const entry = entries.find(e => String(e.id) === card.dataset.entryId);
            if (entry) openEntryModal(entry, queryText, entry.match_score);
        });
    });
}

// =========================================================================
// ENTRY DETAIL MODAL
// =========================================================================
function openEntryModal(entry, queryText = null, matchScore = null) {
    const tpl = document.getElementById("tpl-entry-detail-modal");
    const node = tpl.content.cloneNode(true);
    document.body.appendChild(node);

    const backdrop = document.getElementById("entryModalBackdrop");
    const vClass = verdictClass(entry.verdict);

    document.getElementById("entryModalBody").innerHTML = `
    <div class="entry-detail-header">
      <h2 class="entry-detail-title">${escapeHtml(entry.situation)}</h2>
      <span class="verdict-seal verdict-${vClass}-seal" style="margin-top:0.2rem;">${escapeHtml(entry.verdict)}</span>
    </div>

    <div class="entry-detail-section">
      <span class="entry-detail-label">In plain language</span>
      <p>${escapeHtml(entry.simple_explanation)}</p>
    </div>

    <div class="entry-detail-section">
      <span class="entry-detail-label">The legal explanation</span>
      <p>${escapeHtml(entry.legal_explanation)}</p>
    </div>

    <div class="entry-detail-section">
      <span class="entry-detail-label">Law &amp; section</span>
      <div class="law-ref-box">${escapeHtml(entry.law_reference)}</div>
    </div>

    <div class="entry-detail-section">
      <span class="entry-detail-label">Your rights</span>
      <p>${escapeHtml(entry.your_rights)}</p>
    </div>

    ${entry.exceptions ? `
    <div class="entry-detail-section">
      <span class="entry-detail-label">Exceptions to be aware of</span>
      <p>${escapeHtml(entry.exceptions)}</p>
    </div>` : ""}

    <div class="entry-detail-section">
      <span class="entry-detail-label">What to do next</span>
      <div class="next-steps-box">${escapeHtml(entry.what_to_do_next)}</div>
    </div>

    <div class="entry-detail-actions">
      ${Auth.isLoggedIn() && !Auth.isAdmin() ? `<button class="btn btn-secondary" id="saveEntryBtn">Save to my rights</button>` : ""}
      <button class="btn btn-ghost" id="closeEntryDetailBtn">Close</button>
    </div>
  `;

    function close() {
        backdrop.remove();
    }

    document.getElementById("entryModalClose").addEventListener("click", close);
    document.getElementById("closeEntryDetailBtn").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", function escHandler(e) {
        if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
    });

    const saveBtn = document.getElementById("saveEntryBtn");
    if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
            saveBtn.disabled = true;
            saveBtn.textContent = "Saving…";
            try {
                await api("/saved-queries", {
                    method: "POST",
                    auth: true,
                    body: {
                        legal_entry_id: entry.id,
                        query_text: queryText || entry.situation,
                        match_score: matchScore,
                    },
                });
                showToast("Saved to your rights", "success");
                saveBtn.textContent = "Saved ✓";
                await loadSavedQueries();
            } catch (err) {
                showToast(err.message, "error");
                saveBtn.disabled = false;
                saveBtn.textContent = "Save to my rights";
            }
        });
    }
}

// =========================================================================
// ADMIN CONSOLE
// =========================================================================
let adminEntriesCache = [];

async function renderAdmin(root) {
    const tpl = document.getElementById("tpl-admin");
    root.appendChild(tpl.content.cloneNode(true));

    document.getElementById("newEntryBtn").addEventListener("click", () => openEntryForm(null));

    document.querySelectorAll(".admin-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".admin-tab").forEach(t => t.classList.toggle("active", t === tab));
            document.getElementById("adminEntriesPanel").classList.toggle("hidden", tab.dataset.tab !== "entries");
            document.getElementById("adminUsersPanel").classList.toggle("hidden", tab.dataset.tab !== "users");
            if (tab.dataset.tab === "users") loadAdminUsers();
        });
    });

    await Promise.all([loadAdminStats(), loadAdminEntries()]);
}

async function loadAdminStats() {
    const row = document.getElementById("statsRow");
    try {
        const stats = await api("/admin/stats", { auth: true });
        const cards = [
            ["Total users", stats.total_users],
            ["Citizens", stats.total_citizens],
            ["Tourists", stats.total_tourists],
            ["Legal entries", stats.total_entries],
            ["Saved queries", stats.total_saved_queries],
        ];
        row.innerHTML = cards.map(([label, num]) => `
      <div class="stat-card">
        <div class="stat-num">${num}</div>
        <div class="stat-label">${escapeHtml(label)}</div>
      </div>
    `).join("");
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function loadAdminEntries() {
    const tbody = document.getElementById("entriesTableBody");
    tbody.innerHTML = `<tr><td colspan="5">Loading…</td></tr>`;
    try {
        const { entries } = await api("/entries");
        adminEntriesCache = entries;

        if (!entries.length) {
            tbody.innerHTML = `<tr><td colspan="5">No entries yet. Click "New legal entry" to add one.</td></tr>`;
            return;
        }

        tbody.innerHTML = entries.map(entry => `
      <tr>
        <td class="admin-table-situation">${escapeHtml(entry.situation)}</td>
        <td>${escapeHtml(categoryLabel(entry.category))}</td>
        <td><span class="verdict-pill verdict-${verdictClass(entry.verdict)}-seal">${escapeHtml(entry.verdict)}</span></td>
        <td>${entry.tourist_relevant ? "Yes" : "—"}</td>
        <td>
          <div class="admin-row-actions">
            <button class="btn btn-ghost btn-sm" data-edit="${entry.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-delete="${entry.id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join("");

        tbody.querySelectorAll("[data-edit]").forEach(btn => {
            btn.addEventListener("click", () => {
                const entry = adminEntriesCache.find(e => String(e.id) === btn.dataset.edit);
                if (entry) openEntryForm(entry);
            });
        });

        tbody.querySelectorAll("[data-delete]").forEach(btn => {
            btn.addEventListener("click", async () => {
                const entry = adminEntriesCache.find(e => String(e.id) === btn.dataset.delete);
                if (!entry) return;
                if (!confirm(`Delete "${entry.situation}"? This can't be undone.`)) return;

                try {
                    await api(`/admin/entries/${entry.id}`, { method: "DELETE", auth: true });
                    showToast("Entry deleted", "success");
                    await Promise.all([loadAdminEntries(), loadAdminStats()]);
                } catch (err) {
                    showToast(err.message, "error");
                }
            });
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(err.message)}</td></tr>`;
    }
}

async function loadAdminUsers() {
    const tbody = document.getElementById("usersTableBody");
    tbody.innerHTML = `<tr><td colspan="4">Loading…</td></tr>`;
    try {
        const { users } = await api("/admin/users", { auth: true });
        tbody.innerHTML = users.map(u => `
      <tr>
        <td>${escapeHtml(u.full_name)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td style="text-transform:capitalize;">${escapeHtml(u.role)}</td>
        <td>${u.created_at ? new Date(u.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
      </tr>
    `).join("");
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4">${escapeHtml(err.message)}</td></tr>`;
    }
}

// ---- Entry create/edit form modal ----
function openEntryForm(entry) {
    const tpl = document.getElementById("tpl-entry-form-modal");
    document.body.appendChild(tpl.content.cloneNode(true));

    const backdrop = document.getElementById("entryFormBackdrop");
    const isEdit = !!entry;

    document.getElementById("entryFormTitle").textContent = isEdit ? "Edit legal entry" : "New legal entry";
    document.getElementById("entryFormSubmit").textContent = isEdit ? "Update entry" : "Save entry";

    if (isEdit) {
        document.getElementById("entryId").value = entry.id;
        document.getElementById("entrySituation").value = entry.situation;
        document.getElementById("entryCategory").value = entry.category;
        document.getElementById("entryVerdict").value = entry.verdict;
        document.getElementById("entrySimple").value = entry.simple_explanation;
        document.getElementById("entryLegal").value = entry.legal_explanation;
        document.getElementById("entryLawRef").value = entry.law_reference;
        document.getElementById("entryRights").value = entry.your_rights;
        document.getElementById("entryExceptions").value = entry.exceptions || "";
        document.getElementById("entryNextSteps").value = entry.what_to_do_next;
        document.getElementById("entryKeywords").value = entry.keywords || "";
        document.getElementById("entryTouristRelevant").checked = !!entry.tourist_relevant;
    }

    function close() { backdrop.remove(); }
    document.getElementById("entryFormClose").addEventListener("click", close);
    document.getElementById("entryFormCancel").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

    document.getElementById("entryForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById("entryFormError");
        errorEl.textContent = "";

        const payload = {
            situation: document.getElementById("entrySituation").value.trim(),
            category: document.getElementById("entryCategory").value,
            verdict: document.getElementById("entryVerdict").value,
            simple_explanation: document.getElementById("entrySimple").value.trim(),
            legal_explanation: document.getElementById("entryLegal").value.trim(),
            law_reference: document.getElementById("entryLawRef").value.trim(),
            your_rights: document.getElementById("entryRights").value.trim(),
            exceptions: document.getElementById("entryExceptions").value.trim(),
            what_to_do_next: document.getElementById("entryNextSteps").value.trim(),
            keywords: document.getElementById("entryKeywords").value.trim(),
            tourist_relevant: document.getElementById("entryTouristRelevant").checked,
        };

        const submitBtn = document.getElementById("entryFormSubmit");
        submitBtn.disabled = true;

        try {
            if (isEdit) {
                await api(`/admin/entries/${entry.id}`, { method: "PUT", auth: true, body: payload });
                showToast("Entry updated", "success");
            } else {
                await api("/admin/entries", { method: "POST", auth: true, body: payload });
                showToast("Entry created", "success");
            }
            close();
            await Promise.all([loadAdminEntries(), loadAdminStats()]);
        } catch (err) {
            errorEl.textContent = err.message;
            submitBtn.disabled = false;
        }
    });
}

// =========================================================================
// MAIN RENDER DISPATCH
// =========================================================================
function render() {
    const root = document.getElementById("app");
    root.innerHTML = "";
    renderNav();

    const route = Router.current;
    const user = Auth.getUser();

    // Route guards
    if ((route === "dashboard" || route === "admin") && !Auth.isLoggedIn()) {
        Router.current = "login";
        return render();
    }
    if (route === "admin" && user && user.role !== "admin") {
        showToast("Admin access required", "error");
        Router.current = "dashboard";
        return render();
    }
    if (route === "dashboard" && user && user.role === "admin") {
        Router.current = "admin";
        return render();
    }
    if ((route === "login" || route === "register") && Auth.isLoggedIn()) {
        Router.current = user.role === "admin" ? "admin" : "dashboard";
        return render();
    }

    switch (route) {
        case "login":
            renderAuth(root, "login");
            break;
        case "register":
            renderAuth(root, "register");
            break;
        case "dashboard":
            renderDashboard(root, Router.params);
            break;
        case "admin":
            renderAdmin(root);
            break;
        case "landing":
        default:
            renderLanding(root);
            break;
    }

    // Highlight active nav link
    document.querySelectorAll(".nav-link[data-route]").forEach(link => {
        link.classList.toggle("active", link.dataset.route === route);
    });

    window.scrollTo({ top: 0, behavior: "instant" });
}

// =========================================================================
// INIT
// =========================================================================
Router.init();
render();