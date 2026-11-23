/**
 * Shared API client & role-aware session helper for MedTrack frontend pages.
 */
(function (global) {
  const TOKEN_KEY = "medtrackToken";
  const USER_KEY = "medtrackSessionUser";

  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function parseUtcDate(ts) {
    if (!ts) return null;
    const str = String(ts).trim();
    if (!str) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(str)) {
      return new Date(str.replace(" ", "T") + "Z");
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(str)) {
      return new Date(`${str}Z`);
    }
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatLocalTime(ts) {
    const d = parseUtcDate(ts);
    if (!d) return ts ? String(ts) : "—";
    return d.toLocaleString();
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setSession(token, user) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function getDashboardPath(role) {
    if (role === "admin") return "admin-dashboard.html";
    if (role === "blood_bank") return "blood-bank-dashboard.html";
    if (role === "hospital") return "hospital-dashboard.html";
    return "hospitals.html";
  }

  async function request(path, options = {}) {
    const token = getToken();
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`/api/v1${path}`, {
      ...options,
      headers
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = data?.error?.code;
      if (
        res.status === 401 &&
        token &&
        ["INVALID_TOKEN", "USER_INACTIVE", "AUTH_REQUIRED"].includes(code)
      ) {
        clearSession();
      }
      const msg = data?.error?.message || `Request failed (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      err.code = code;
      err.details = data?.error?.details;
      throw err;
    }
    return data;
  }

  function initResponsiveNavbar() {
    const header = document.querySelector("header.navbar");
    const nav = header?.querySelector("nav");
    if (!header || !nav) return;

    if (!header.querySelector(".nav-toggle")) {
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "nav-toggle";
      toggleBtn.setAttribute("aria-label", "Toggle navigation menu");
      toggleBtn.setAttribute("aria-expanded", "false");
      toggleBtn.textContent = "☰";
      header.appendChild(toggleBtn);

      const closeMenu = () => {
        header.classList.remove("nav-open");
        toggleBtn.setAttribute("aria-expanded", "false");
        toggleBtn.textContent = "☰";
      };

      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = header.classList.toggle("nav-open");
        toggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
        toggleBtn.textContent = isOpen ? "✕" : "☰";
      });

      nav.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", closeMenu);
      });

      document.addEventListener("click", (e) => {
        if (header.classList.contains("nav-open") && !header.contains(e.target)) {
          closeMenu();
        }
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && header.classList.contains("nav-open")) {
          closeMenu();
        }
      });
    }
  }

  function syncNavbarAuth() {
    const user = getUser();
    const navButtons = document.querySelector(".nav-buttons");
    const nav = document.querySelector("header.navbar nav");

    if (nav && user) {
      const dashHref = getDashboardPath(user.role);
      const existingDash = nav.querySelector('a[data-role-nav="true"], a[href="' + dashHref + '"]');
      if (!existingDash && ["hospital", "blood_bank", "admin"].includes(user.role)) {
        const a = document.createElement("a");
        a.href = dashHref;
        a.dataset.roleNav = "true";
        a.textContent =
          user.role === "admin"
            ? "Admin"
            : user.role === "blood_bank"
              ? "Blood Bank"
              : "Dashboard";
        if (window.location.pathname.endsWith(dashHref)) {
          a.classList.add("active");
        }
        nav.appendChild(a);
      }
    }

    initResponsiveNavbar();

    if (!navButtons) return;
    if (user) {
      const dashHref = getDashboardPath(user.role);
      const label = escapeHtml(user.firstName || user.email);
      const roleLabel = escapeHtml(String(user.role || "").replace("_", " "));
      navButtons.innerHTML = `
        <a href="${dashHref}" class="login-btn nav-user-link" title="${label} (${roleLabel})">${label} (${roleLabel})</a>
        <button type="button" id="medtrackLogoutBtn" class="small-btn">Logout</button>
      `;
      const btn = document.getElementById("medtrackLogoutBtn");
      if (btn) {
        btn.addEventListener("click", async () => {
          try {
            await request("/auth/logout", { method: "POST" });
          } catch {
            // ignore network error on logout
          }
          clearSession();
          window.location.href = "login.html";
        });
      }
    }
  }

  document.addEventListener("DOMContentLoaded", syncNavbarAuth);

  global.medtrackApi = {
    escapeHtml,
    parseUtcDate,
    formatLocalTime,
    getToken,
    getUser,
    setSession,
    clearSession,
    getDashboardPath,
    request,
    syncNavbarAuth
  };
})(window);
