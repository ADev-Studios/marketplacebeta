/**
 * ADev Marketplace — shared utilities (auth UI, toasts, nav)
 */
import {
  initFirebase,
  onAuthChange,
  loginEmail,
  signupEmail,
  loginGoogle,
  logout,
  getCurrentUser,
} from "./auth.js";
import { ensureUserProfile } from "./data.js";

export function toast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : type === "success" ? "success" : ""}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.3s";
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

export function updateHeaderAuth(user) {
  const authArea = document.getElementById("auth-area");
  const userMenu = document.getElementById("user-menu");
  const navUpload = document.getElementById("nav-upload");

  if (user) {
    authArea?.classList.add("hidden");
    userMenu?.classList.remove("hidden");
    navUpload?.classList.remove("hidden");
    const name = user.displayName || user.email?.split("@")[0] || "Player";
    const avatarEl = document.getElementById("header-avatar");
    const nameEl = document.getElementById("header-name");
    if (nameEl) nameEl.textContent = name;
    if (avatarEl) {
      avatarEl.src =
        user.photoURL ||
        `data:image/svg+xml,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect fill="#1a1a2e" width="32" height="32"/><text x="16" y="22" text-anchor="middle" fill="#00d4ff" font-size="14" font-family="sans-serif">${name.charAt(0).toUpperCase()}</text></svg>`
        )}`;
      avatarEl.alt = name;
    }
  } else {
    authArea?.classList.remove("hidden");
    userMenu?.classList.add("hidden");
    navUpload?.classList.add("hidden");
  }
}

function setupAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (!modal) return;
  const open = () => modal.classList.remove("hidden");
  const close = () => modal.classList.add("hidden");

  document.getElementById("btn-login")?.addEventListener("click", () => {
    showTab("login");
    open();
  });
  document.getElementById("btn-signup")?.addEventListener("click", () => {
    showTab("signup");
    open();
  });
  modal.querySelectorAll("[data-close-modal]").forEach((el) => el.addEventListener("click", close));

  function showTab(name) {
    modal.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    document.getElementById("form-login")?.classList.toggle("hidden", name !== "login");
    document.getElementById("form-signup")?.classList.toggle("hidden", name !== "signup");
  }
  modal.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => showTab(t.dataset.tab))
  );

  document.getElementById("form-login")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("login-error");
    err?.classList.add("hidden");
    const fd = new FormData(e.target);
    try {
      await loginEmail(fd.get("email"), fd.get("password"));
      close();
      toast("Signed in", "success");
    } catch (ex) {
      if (err) {
        err.textContent = ex.message || "Sign in failed";
        err.classList.remove("hidden");
      }
    }
  });

  document.getElementById("form-signup")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("signup-error");
    err?.classList.add("hidden");
    const fd = new FormData(e.target);
    try {
      const user = await signupEmail(fd.get("email"), fd.get("password"), fd.get("displayName"));
      await ensureUserProfile(user);
      close();
      toast("Account created", "success");
    } catch (ex) {
      if (err) {
        err.textContent = ex.message || "Sign up failed";
        err.classList.remove("hidden");
      }
    }
  });

  const googleHandler = async () => {
    try {
      const user = await loginGoogle();
      await ensureUserProfile(user);
      close();
      toast("Signed in with Google", "success");
    } catch (ex) {
      toast(ex.message || "Google sign-in failed", "error");
    }
  };
  document.getElementById("btn-google-login")?.addEventListener("click", googleHandler);
  document.getElementById("btn-google-signup")?.addEventListener("click", googleHandler);

  document.getElementById("btn-logout")?.addEventListener("click", async () => {
    await logout();
    document.getElementById("user-dropdown")?.classList.add("hidden");
    toast("Signed out");
    window.location.href = "index.html";
  });

  document.getElementById("user-avatar-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("user-dropdown")?.classList.toggle("hidden");
  });
  document.addEventListener("click", () => {
    document.getElementById("user-dropdown")?.classList.add("hidden");
  });
}

function setupMobileNav() {
  document.getElementById("mobile-toggle")?.addEventListener("click", () => {
    document.querySelector(".main-nav")?.classList.toggle("open");
  });
}

/** Highlight active nav link based on current page filename */
export function setActiveNav() {
  const path = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".main-nav a").forEach((a) => {
    const href = a.getAttribute("href") || "";
    const file = href.split("/").pop() || "";
    a.classList.toggle(
      "active",
      file === path ||
        (path === "" && file === "index.html") ||
        (path === "index.html" && file === "index.html") ||
        (path === "store.html" && file === "store.html")
    );
  });
}

/**
 * Initialize shared chrome: Firebase, auth UI, mobile nav, active link.
 * Call once from each page.
 */
export async function initShared() {
  setupAuthModal();
  setupMobileNav();
  setActiveNav();

  onAuthChange(async (user) => {
    updateHeaderAuth(user);
    if (user) {
      try {
        await ensureUserProfile(user);
      } catch (err) {
        console.warn("ensureUserProfile:", err.message);
      }
    }
  });

  await initFirebase();
}

export function getQueryParam(name) {
  return new URLSearchParams(location.search).get(name);
}
