/**
 * ADev Marketplace — DOM rendering for each page
 */
import {
  getAllGames,
  getGameById,
  getGamesByAuthor,
  getUserProfile,
  isFollowing,
  followUser,
  unfollowUser,
  incrementDownloads,
  deleteGame,
  getRatingsForGame,
  getAllRatings,
  submitRating,
  deleteMyRating,
} from "./data.js";
import {
  searchGames,
  getRecommendations,
  getTrending,
  getRecentlyAdded,
  getFeatured,
  getBecauseYouViewed,
  getPersonalizedFeed,
  buildReviewsMap,
  trackView,
  trackSearch,
  trackGenreFilter,
  filterGames,
  GENRES,
} from "./algorithms.js";
import { getCurrentUser, isElectron } from "./auth.js";
import { toast } from "./shared.js";

const app = () => document.getElementById("app");

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stars(rating) {
  const r = Math.round((rating || 0) * 2) / 2;
  let s = "";
  for (let i = 1; i <= 5; i++) {
    if (r >= i) s += "★";
    else if (r >= i - 0.5) s += "☆";
    else s += "☆";
  }
  return s;
}

function formatPrice(price) {
  if (!price || price <= 0) return '<span class="price free">Free</span>';
  return `<span class="price">$${Number(price).toFixed(2)}</span>`;
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    const d = iso.toDate ? iso.toDate() : new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function defaultAvatar(name) {
  const letter = (name || "?").charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect fill="#1a1a2e" width="96" height="96"/><text x="48" y="58" text-anchor="middle" fill="#00d4ff" font-size="40" font-family="sans-serif">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function skeletonCards(n = 4) {
  return Array.from({ length: n })
    .map(
      () => `
    <div class="skeleton-card">
      <div class="sk-cover"></div>
      <div class="sk-body">
        <div class="skeleton sk-line"></div>
        <div class="skeleton sk-line w60"></div>
        <div class="skeleton sk-line w40"></div>
      </div>
    </div>`
    )
    .join("");
}

export function gameCardHtml(game) {
  const cover = game.coverUrl
    ? `<img src="${escapeHtml(game.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'cover-placeholder\\'>🎮</div>'" />`
    : `<div class="cover-placeholder">🎮</div>`;
  return `
    <article class="game-card" data-id="${escapeHtml(game.id)}" role="link" tabindex="0">
      <div class="cover">${cover}</div>
      <div class="body">
        <div class="title">${escapeHtml(game.title)}</div>
        <div class="meta">
          <span class="genre-tag">${escapeHtml(game.genre || "Indie")}</span>
          <span class="rating" title="${(game.rating || 0).toFixed(1)}"><span class="stars">${stars(game.rating)}</span></span>
          ${formatPrice(game.price)}
        </div>
      </div>
    </article>`;
}

function bindCardClicks(container) {
  container?.querySelectorAll(".game-card").forEach((el) => {
    const go = () => {
      window.location.href = `game.html?id=${encodeURIComponent(el.dataset.id)}`;
    };
    el.addEventListener("click", go);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
  });
}

function zipFilename(game, url) {
  const fromUrl = (url || "").split("?")[0].split("/").pop();
  if (fromUrl && /\.(zip|7z|rar|exe|dmg|appimage)$/i.test(fromUrl)) return fromUrl;
  const slug = (game.title || "game")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug}-${game.version || "1.0"}.zip`;
}

function launcherOpenHref(game) {
  const pageUrl = new URL(`game.html?id=${encodeURIComponent(game.id)}`, window.location.href).href;
  return `mylauncher://open?url=${encodeURIComponent(pageUrl)}&id=${encodeURIComponent(game.id)}`;
}

function launcherInstallHref(game) {
  return `mylauncher://install/${encodeURIComponent(game.id)}?url=${encodeURIComponent(game.fileUrl || "")}&v=${encodeURIComponent(game.version || "1.0")}`;
}

function execDownloadHtml(game) {
  const extras = (game.executables || []).filter((x) => x && x.url);
  if (!extras.length) return "";
  return extras
    .map(
      (ex, i) =>
        `<button type="button" class="btn btn-ghost btn-block btn-exec-dl" data-url="${escapeHtml(ex.url)}" data-name="${escapeHtml(ex.name || "build")}">${escapeHtml(ex.name || "Build")} .zip</button>`
    )
    .join("");
}

async function downloadZip(url, filename) {
  if (!url) throw new Error("No file URL");
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename || "game.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  } catch {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "game.zip";
    a.rel = "noopener";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

const STAR_WORDS = ["", "Poor", "Fair", "Good", "Great", "Exceptional"];

function breakdownFromRatings(ratings) {
  const b = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of ratings) {
    const s = Number(r.stars);
    if (s >= 1 && s <= 5) b[s] += 1;
  }
  return b;
}

function renderBars(breakdown, total) {
  const el = document.getElementById("rating-bars");
  if (!el) return;
  el.innerHTML = [5, 4, 3, 2, 1]
    .map((n) => {
      const c = breakdown[n] || 0;
      const pct = total ? Math.round((c / total) * 100) : 0;
      return `<div class="rating-bar-row">
        <span>${n}★</span>
        <div class="rating-bar-track"><div class="rating-bar-fill" style="width:${pct}%"></div></div>
        <span>${c}</span>
      </div>`;
    })
    .join("");
}

function renderReviews(ratings, myUid) {
  const el = document.getElementById("reviews-list");
  if (!el) return;
  const ordered = [...ratings].sort((a, b) => {
    if (myUid && a.uid === myUid) return -1;
    if (myUid && b.uid === myUid) return 1;
    return 0;
  });
  if (!ordered.length) {
    el.innerHTML = `<div class="empty-state" style="padding:1.25rem"><p>No ratings yet. Be the first.</p></div>`;
    return;
  }
  el.innerHTML = ordered
    .map((r) => {
      const mine = myUid && r.uid === myUid;
      const body = (r.review || "").trim();
      return `<article class="review-card">
        <div class="review-head">
          <img src="${defaultAvatar(r.displayName)}" alt="" />
          <div>
            <div class="review-name">${escapeHtml(r.displayName || "Player")} ${mine ? '<span class="you-badge">You</span>' : ""}</div>
            <div class="review-meta"><span class="review-stars">${stars(r.stars)}</span> · ${formatDate(r.updatedAt || r.createdAt)}</div>
          </div>
        </div>
        ${body ? `<p class="review-body">${escapeHtml(body)}</p>` : `<p class="review-body" style="opacity:.7">Rated ${r.stars}/5 — no written review</p>`}
      </article>`;
    })
    .join("");
}

function updateSummary(ratings) {
  const count = ratings.length;
  const sum = ratings.reduce((s, r) => s + (Number(r.stars) || 0), 0);
  const avg = count ? sum / count : 0;
  const avgEl = document.getElementById("rating-avg");
  const starsEl = document.getElementById("rating-avg-stars");
  const countEl = document.getElementById("rating-count-label");
  const meta = document.querySelector(".game-meta-row .rating");
  if (avgEl) avgEl.textContent = avg.toFixed(1);
  if (starsEl) starsEl.textContent = stars(avg);
  if (countEl) countEl.textContent = `${count} rating${count === 1 ? "" : "s"}`;
  if (meta) meta.innerHTML = `${stars(avg)} ${avg.toFixed(1)}`;
  renderBars(breakdownFromRatings(ratings), count);
}

function starPickerHtml(selected) {
  let html = `<div class="star-picker" id="star-picker" role="radiogroup" aria-label="Your rating">`;
  for (let i = 1; i <= 5; i++) {
    html += `<button type="button" data-stars="${i}" class="${i <= selected ? "on" : ""}" aria-label="${i} star${i > 1 ? "s" : ""}">★</button>`;
  }
  html += `</div>`;
  return html;
}

async function bindRatingPanel(game) {
  const box = document.getElementById("rate-box");
  if (!box) return;
  const user = getCurrentUser();
  let ratings = [];
  try {
    ratings = await getRatingsForGame(game.id);
  } catch (err) {
    console.warn(err);
  }
  updateSummary(ratings);
  renderReviews(ratings, user?.uid);

  let mine = ratings.find((r) => user && r.uid === user.uid) || null;
  let selected = mine ? Number(mine.stars) : 0;

  if (!user) {
    box.innerHTML = `
      <h3>Rate this game</h3>
      <p class="form-hint">Sign in to leave a star rating and optional review.</p>
      <button type="button" class="btn btn-primary btn-sm" id="btn-rate-signin">Sign in to rate</button>`;
    document.getElementById("btn-rate-signin")?.addEventListener("click", () => {
      document.getElementById("btn-login")?.click();
    });
    return;
  }

  const paintBox = () => {
    box.innerHTML = `
      <h3>${mine ? "Update your rating" : "Rate this game"}</h3>
      ${starPickerHtml(selected)}
      <div class="star-label" id="star-label">${selected ? STAR_WORDS[selected] : "Tap a star"}</div>
      <textarea id="review-text" maxlength="500" placeholder="Optional review (max 500 characters)">${escapeHtml(mine?.review || "")}</textarea>
      <div class="rate-actions">
        <button type="button" class="btn btn-primary btn-sm" id="btn-submit-rating">${mine ? "Save rating" : "Submit rating"}</button>
        ${mine ? `<button type="button" class="btn btn-ghost btn-sm" id="btn-remove-rating">Remove</button>` : ""}
      </div>`;

    const picker = document.getElementById("star-picker");
    const label = document.getElementById("star-label");
    const buttons = [...picker.querySelectorAll("button")];

    const paintStars = (n, cls = "on") => {
      buttons.forEach((b) => {
        b.classList.remove("on", "preview");
        if (Number(b.dataset.stars) <= n) b.classList.add(cls);
      });
    };

    picker.addEventListener("mouseover", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const n = Number(btn.dataset.stars);
      paintStars(n, "preview");
      label.textContent = STAR_WORDS[n];
    });
    picker.addEventListener("mouseleave", () => {
      paintStars(selected, "on");
      label.textContent = selected ? STAR_WORDS[selected] : "Tap a star";
    });
    picker.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      selected = Number(btn.dataset.stars);
      paintStars(selected, "on");
      label.textContent = STAR_WORDS[selected];
    });

    document.getElementById("btn-submit-rating")?.addEventListener("click", async () => {
      if (!selected) {
        toast("Pick a star rating first", "error");
        return;
      }
      const review = document.getElementById("review-text")?.value || "";
      const btn = document.getElementById("btn-submit-rating");
      btn.disabled = true;
      try {
        await submitRating(game.id, selected, review);
        toast(mine ? "Rating updated" : "Thanks for rating", "success");
        ratings = await getRatingsForGame(game.id);
        mine = ratings.find((r) => r.uid === user.uid) || null;
        selected = mine ? Number(mine.stars) : selected;
        updateSummary(ratings);
        renderReviews(ratings, user.uid);
        paintBox();
      } catch (err) {
        toast(err.message || "Could not save rating", "error");
        btn.disabled = false;
      }
    });

    document.getElementById("btn-remove-rating")?.addEventListener("click", async () => {
      if (!confirm("Remove your rating?")) return;
      try {
        await deleteMyRating(game.id);
        toast("Rating removed", "success");
        mine = null;
        selected = 0;
        ratings = await getRatingsForGame(game.id);
        updateSummary(ratings);
        renderReviews(ratings, user.uid);
        paintBox();
      } catch (err) {
        toast(err.message || "Could not remove rating", "error");
      }
    });
  };

  paintBox();
}

export async function renderHome() {
  const el = app();
  el.innerHTML = `
    <div class="page-header">
      <h1>Discover Games</h1>
      <p>Indie titles on ADev Marketplace</p>
    </div>
    <section class="section" id="foryou-section">
      <h2 class="section-title">For You</h2>
      <div class="card-grid" id="foryou-grid">${skeletonCards(8)}</div>
    </section>
    <section class="section">
      <h2 class="section-title">Featured</h2>
      <div class="card-grid" id="featured-grid">${skeletonCards(4)}</div>
    </section>
    <section class="section">
      <h2 class="section-title">Trending</h2>
      <div class="card-grid" id="trending-grid">${skeletonCards(4)}</div>
    </section>
    <section class="section">
      <h2 class="section-title">Recently Added</h2>
      <div class="card-grid" id="recent-grid">${skeletonCards(4)}</div>
    </section>
    <section class="section" id="byv-section" hidden>
      <h2 class="section-title">Because You Viewed</h2>
      <div class="card-grid" id="byv-grid"></div>
    </section>`;

  try {
    // Fetch games and all ratings in parallel so feed ranking gets the
    // recency-weighted review data. windowDays: 0 skips the Firestore index
    // requirement by reading the whole collection (fine for small catalogs).
    const [games, ratings] = await Promise.all([
      getAllGames(),
      getAllRatings({ windowDays: 0 }).catch(() => []),
    ]);
    const reviewsByGameId = buildReviewsMap(ratings);

    const forYou = getPersonalizedFeed(games, 12, { reviewsByGameId });
    const featured = getFeatured(games, 4, { reviewsByGameId });
    const trending = getTrending(games, 8, { reviewsByGameId });
    const recent = getRecentlyAdded(games, 8);
    const byv = getBecauseYouViewed(games, 6);

    const setGrid = (id, list) => {
      const grid = document.getElementById(id);
      if (!grid) return;
      if (!list.length) {
        grid.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>No games yet</p></div>`;
        return;
      }
      grid.innerHTML = list.map(gameCardHtml).join("");
      bindCardClicks(grid);
    };

    setGrid("foryou-grid", forYou);
    setGrid("featured-grid", featured);
    setGrid("trending-grid", trending);
    setGrid("recent-grid", recent);

    if (byv.length) {
      document.getElementById("byv-section").hidden = false;
      setGrid("byv-grid", byv);
    }
  } catch (err) {
    el.innerHTML += `<p class="form-error">Failed to load games: ${escapeHtml(err.message)}</p>`;
  }
}

export async function renderStore() {
  const el = app();
  el.innerHTML = `
    <div class="page-header">
      <h1>Store</h1>
      <p>Browse the full catalog</p>
    </div>
    <div class="store-toolbar">
      <div class="search-box">
        <input type="search" id="store-search" placeholder="Search titles, tags, genres…" autocomplete="off" />
      </div>
      <select id="filter-genre" class="filter-select">
        <option value="all">All genres</option>
        ${GENRES.map((g) => `<option value="${g}">${g}</option>`).join("")}
      </select>
      <select id="filter-price" class="filter-select">
        <option value="any">Any price</option>
        <option value="0">Free only</option>
        <option value="5">Under $5</option>
        <option value="15">Under $15</option>
        <option value="30">Under $30</option>
      </select>
      <select id="filter-rating" class="filter-select">
        <option value="any">Any rating</option>
        <option value="3">3+ stars</option>
        <option value="4">4+ stars</option>
      </select>
      <select id="filter-sort" class="filter-select">
        <option value="relevance">Relevance</option>
        <option value="newest">Newest</option>
        <option value="rating">Top rated</option>
        <option value="downloads">Most downloaded</option>
        <option value="price-asc">Price: low → high</option>
        <option value="price-desc">Price: high → low</option>
        <option value="title">Title A–Z</option>
      </select>
      <p class="results-count" id="results-count"></p>
    </div>
    <div class="card-grid" id="store-grid">${skeletonCards(8)}</div>`;

  let allGames = [];
  try {
    allGames = await getAllGames();
  } catch (err) {
    document.getElementById("store-grid").innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
    return;
  }

  const apply = () => {
    const q = document.getElementById("store-search").value;
    const genre = document.getElementById("filter-genre").value;
    const maxPrice = document.getElementById("filter-price").value;
    const minRating = document.getElementById("filter-rating").value;
    const sort = document.getElementById("filter-sort").value;

    let list;
    if (q.trim()) {
      const results = searchGames(allGames, q);
      list = results.map((r) => r.game);
      list = filterGames(list, { genre, maxPrice, minRating, sort: sort === "relevance" ? null : sort });
    } else {
      list = filterGames(allGames, { genre, maxPrice, minRating, sort: sort === "relevance" ? "newest" : sort });
    }

    const grid = document.getElementById("store-grid");
    document.getElementById("results-count").textContent = `${list.length} game${list.length !== 1 ? "s" : ""}`;
    if (!list.length) {
      grid.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><p>No matches. Try different filters.</p></div>`;
      return;
    }
    grid.innerHTML = list.map(gameCardHtml).join("");
    bindCardClicks(grid);
  };

  ["store-search", "filter-genre", "filter-price", "filter-rating", "filter-sort"].forEach((id) => {
    const node = document.getElementById(id);
    node.addEventListener(id === "store-search" ? "input" : "change", apply);
  });

  // Session signals: track committed searches and genre filter changes so
  // getBecauseYouViewed() / getPersonalizedFeed() can use them in-session.
  // 'change' fires on blur/Enter, so we don't spam a signal per keystroke.
  document.getElementById("store-search").addEventListener("change", (e) => {
    const v = e.target.value.trim();
    if (v) trackSearch(v);
  });
  document.getElementById("filter-genre").addEventListener("change", (e) => {
    trackGenreFilter(e.target.value);
  });

  apply();
}

export async function renderGameDetail(id) {
  const el = app();
  if (!id) {
    el.innerHTML = `<div class="empty-state"><div class="icon">❓</div><h2>Missing game id</h2><a href="store.html" class="btn btn-primary" style="margin-top:1rem">Browse store</a></div>`;
    return;
  }

  el.innerHTML = `<div class="loading-screen"><div class="spinner"></div><p>Loading game…</p></div>`;

  let game;
  try {
    game = await getGameById(id);
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p class="form-error">${escapeHtml(err.message)}</p></div>`;
    return;
  }
  if (!game) {
    el.innerHTML = `<div class="empty-state"><div class="icon">❓</div><h2>Game not found</h2><a href="store.html" class="btn btn-primary" style="margin-top:1rem">Browse store</a></div>`;
    return;
  }

  trackView(game.id);
  const user = getCurrentUser();
  const isAuthor = user && user.uid === game.authorUid;
  const electron = isElectron();

  const screenshots = (game.screenshots || []).filter(Boolean);
  const cover = game.coverUrl || (screenshots[0] || "");

  el.innerHTML = `
    <div class="game-detail">
      <div class="game-main">
        <div class="game-hero" id="hero">
          ${cover ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(game.title)}" id="hero-img" />` : `<div class="cover-placeholder" style="height:100%;min-height:240px">🎮</div>`}
        </div>
        ${
          screenshots.length
            ? `<div class="screenshots" id="shots">
                ${screenshots.map((url, i) => `<img src="${escapeHtml(url)}" alt="Screenshot ${i + 1}" data-url="${escapeHtml(url)}" class="${i === 0 ? "active" : ""}" />`).join("")}
              </div>`
            : ""
        }
        <div class="game-info">
          <h1>${escapeHtml(game.title)}</h1>
          <div class="game-meta-row">
            <span class="genre-tag">${escapeHtml(game.genre || "Indie")}</span>
            <span class="rating">${stars(game.rating)} ${(game.rating || 0).toFixed(1)}</span>
            <span>${(game.downloads || 0).toLocaleString()} downloads</span>
            <span>v${escapeHtml(game.version || "1.0")}</span>
            <span>Added ${formatDate(game.createdAt)}</span>
          </div>
          <div class="tags">${(game.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
          <p class="game-desc">${escapeHtml(game.description)}</p>
        </div>
        <section class="rating-panel" id="rating-panel">
          <h2 class="section-title">Ratings & reviews</h2>
          <div class="rating-grid">
            <div class="rating-summary">
              <div class="rating-avg" id="rating-avg">${(game.rating || 0).toFixed(1)}</div>
              <div class="rating-avg-stars" id="rating-avg-stars">${stars(game.rating)}</div>
              <div class="rating-count-label" id="rating-count-label">${game.ratingCount || 0} rating${(game.ratingCount || 0) === 1 ? "" : "s"}</div>
            </div>
            <div class="rating-bars" id="rating-bars"></div>
            <div class="rate-box" id="rate-box"></div>
          </div>
          <div class="reviews-list" id="reviews-list"></div>
        </section>
        <section class="section" id="rec-section">
          <h2 class="section-title">You may also like</h2>
          <div class="card-grid" id="rec-grid">${skeletonCards(4)}</div>
        </section>
      </div>
      <aside class="sidebar-card">
        <div class="price-lg ${!game.price ? "free" : ""}">${!game.price ? "Free" : "$" + Number(game.price).toFixed(2)}</div>
        <div class="install-actions" id="install-actions">
          ${
            game.fileUrl
              ? `<button type="button" class="btn btn-primary btn-block" id="btn-download-zip">Download .zip</button>`
              : `<p class="form-hint">No game file uploaded yet.</p>`
          }
          ${
            electron
              ? `<button type="button" class="btn btn-ghost btn-block" id="btn-install">Install with Launcher</button>`
              : `<a class="btn btn-ghost btn-block" id="btn-open-launcher" href="${escapeHtml(launcherOpenHref(game))}">Open in ADev Launcher</a>
                 <p class="form-hint">Opens this game page inside the launcher (no address bar needed). If nothing happens, install the ADev Launcher and try again.</p>`
          }
          ${execDownloadHtml(game)}
        </div>
        ${
          isAuthor
            ? `<div style="display:flex;gap:0.5rem;margin-bottom:0.75rem">
                <a href="upload.html?edit=${escapeHtml(game.id)}" class="btn btn-ghost btn-sm">Edit</a>
                <button class="btn btn-danger btn-sm" id="btn-delete-game">Delete</button>
              </div>`
            : ""
        }
        <a class="author-link" href="user.html?id=${escapeHtml(game.authorUid)}">
          <img src="${defaultAvatar(game.authorName)}" alt="" width="36" height="36" />
          <div>
            <div style="font-weight:600">${escapeHtml(game.authorName || "Unknown")}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Developer</div>
          </div>
        </a>
      </aside>
    </div>`;

  document.querySelectorAll("#shots img").forEach((img) => {
    img.addEventListener("click", () => {
      const hero = document.getElementById("hero-img");
      if (hero) hero.src = img.dataset.url;
      document.querySelectorAll("#shots img").forEach((i) => i.classList.remove("active"));
      img.classList.add("active");
    });
  });

  bindRatingPanel(game);

  const deepLink = launcherInstallHref(game);

  document.getElementById("btn-download-zip")?.addEventListener("click", async () => {
    const btn = document.getElementById("btn-download-zip");
    btn.disabled = true;
    try {
      await downloadZip(game.fileUrl, zipFilename(game, game.fileUrl));
      await incrementDownloads(game.id);
      toast("Download started", "success");
    } catch (err) {
      toast(err.message || "Download failed", "error");
    }
    btn.disabled = false;
  });

  document.querySelectorAll(".btn-exec-dl").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await downloadZip(btn.dataset.url, zipFilename(game, btn.dataset.url));
        toast("Download started", "success");
      } catch (err) {
        toast(err.message || "Download failed", "error");
      }
    });
  });

  if (electron) {
    document.getElementById("btn-install")?.addEventListener("click", async () => {
      try {
        if (window.electronAPI?.installGame) {
          window.electronAPI.installGame({
            gameId: game.id,
            fileUrl: game.fileUrl,
            version: game.version,
            pageUrl: new URL(`game.html?id=${encodeURIComponent(game.id)}`, window.location.href).href,
          });
        } else if (window.require) {
          const { ipcRenderer } = window.require("electron");
          ipcRenderer.send("install-game", {
            gameId: game.id,
            fileUrl: game.fileUrl,
            version: game.version,
          });
        } else {
          window.location.href = deepLink;
        }
        await incrementDownloads(game.id);
        toast("Install started in launcher", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    });
  } else {
    document.getElementById("btn-open-launcher")?.addEventListener("click", async () => {
      try {
        await incrementDownloads(game.id);
        toast("Opening ADev Launcher…", "success");
      } catch {}
    });
  }

  document.getElementById("btn-delete-game")?.addEventListener("click", async () => {
    if (!confirm("Delete this game permanently?")) return;
    try {
      await deleteGame(game.id);
      toast("Game deleted", "success");
      window.location.href = "index.html";
    } catch (err) {
      toast(err.message, "error");
    }
  });

  try {
    const all = await getAllGames();
    const recs = getRecommendations(all, game, 6);
    const grid = document.getElementById("rec-grid");
    if (!recs.length) {
      document.getElementById("rec-section").hidden = true;
    } else {
      grid.innerHTML = recs.map(gameCardHtml).join("");
      bindCardClicks(grid);
    }
  } catch {
    document.getElementById("rec-section").hidden = true;
  }
}

export async function renderProfile() {
  const user = getCurrentUser();
  if (!user) {
    app().innerHTML = `<div class="empty-state"><div class="icon">🔒</div><h2>Sign in required</h2><p>Sign in to view your profile.</p></div>`;
    return;
  }
  await renderUserPage(user.uid, true);
}

export async function renderUserPage(uid, isOwn = false) {
  const el = app();
  if (!uid) {
    el.innerHTML = `<div class="empty-state"><div class="icon">❓</div><h2>Missing user id</h2></div>`;
    return;
  }

  el.innerHTML = `<div class="loading-screen"><div class="spinner"></div></div>`;

  let profile, games;
  try {
    [profile, games] = await Promise.all([getUserProfile(uid), getGamesByAuthor(uid)]);
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p class="form-error">${escapeHtml(err.message)}</p></div>`;
    return;
  }

  const current = getCurrentUser();
  if (!isOwn) isOwn = !!(current && current.uid === uid);

  const name = profile?.displayName || current?.displayName || "Player";
  const avatar = profile?.avatarUrl || current?.photoURL || defaultAvatar(name);
  const bio = profile?.bio || "";
  const joined = formatDate(profile?.joinedAt);
  const followers = profile?.followerCount ?? 0;

  let followBtn = "";
  if (!isOwn && current) {
    followBtn = `<button class="btn btn-ghost" id="btn-follow">Follow</button>`;
  }

  el.innerHTML = `
    <div class="profile-header">
      <img class="profile-avatar" src="${escapeHtml(avatar)}" alt="" onerror="this.src='${defaultAvatar(name)}'" />
      <div class="profile-info">
        <h1>${escapeHtml(name)}</h1>
        ${bio ? `<p class="profile-bio">${escapeHtml(bio)}</p>` : ""}
        <div class="profile-stats">
          <span><strong id="follower-count">${followers}</strong> followers</span>
          <span><strong>${games.length}</strong> games</span>
          <span>Joined ${joined}</span>
        </div>
        <div style="margin-top:1rem;display:flex;gap:0.5rem">
          ${followBtn}
          ${isOwn ? `<a href="settings.html" class="btn btn-ghost btn-sm">Edit profile</a>
                     <a href="upload.html" class="btn btn-primary btn-sm">Upload game</a>` : ""}
        </div>
      </div>
    </div>
    <section class="section">
      <h2 class="section-title">${isOwn ? "Your games" : "Games"}</h2>
      <div class="card-grid" id="user-games">
        ${games.length ? games.map(gameCardHtml).join("") : `<div class="empty-state"><div class="icon">🎮</div><p>No games uploaded yet</p></div>`}
      </div>
    </section>`;

  bindCardClicks(document.getElementById("user-games"));

  if (!isOwn && current) {
    const btn = document.getElementById("btn-follow");
    let following = false;
    try {
      following = await isFollowing(uid);
    } catch {}
    const updateBtn = () => {
      btn.textContent = following ? "Unfollow" : "Follow";
      btn.classList.toggle("btn-primary", !following);
      btn.classList.toggle("btn-ghost", following);
    };
    updateBtn();
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        if (following) {
          await unfollowUser(uid);
          following = false;
          const c = document.getElementById("follower-count");
          c.textContent = Math.max(0, parseInt(c.textContent, 10) - 1);
        } else {
          await followUser(uid);
          following = true;
          const c = document.getElementById("follower-count");
          c.textContent = parseInt(c.textContent, 10) + 1;
        }
        updateBtn();
        toast(following ? "Following" : "Unfollowed", "success");
      } catch (err) {
        toast(err.message, "error");
      }
      btn.disabled = false;
    });
  }
}

export async function renderSettings() {
  const user = getCurrentUser();
  if (!user) {
    app().innerHTML = `<div class="empty-state"><div class="icon">🔒</div><h2>Sign in required</h2></div>`;
    return;
  }

  const profile = await getUserProfile(user.uid).catch(() => null);

  app().innerHTML = `
    <div class="page-header">
      <h1>Settings</h1>
      <p>Manage your account</p>
    </div>
    <div class="form-card">
      <h2 style="margin-bottom:1rem;font-size:1.1rem">Profile</h2>
      <form id="form-profile">
        <div class="form-group">
          <label>Display name</label>
          <input name="displayName" value="${escapeHtml(user.displayName || profile?.displayName || "")}" maxlength="40" required />
        </div>
        <div class="form-group">
          <label>Avatar URL</label>
          <input name="avatarUrl" type="url" value="${escapeHtml(profile?.avatarUrl || user.photoURL || "")}" placeholder="https://…" />
        </div>
        <div class="form-group">
          <label>Bio</label>
          <textarea name="bio" maxlength="300" rows="3">${escapeHtml(profile?.bio || "")}</textarea>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save profile</button>
        </div>
      </form>
    </div>

    <div class="form-card" style="margin-top:1.5rem">
      <h2 style="margin-bottom:1rem;font-size:1.1rem">Change password</h2>
      <form id="form-password">
        <div class="form-group">
          <label>Current password</label>
          <input name="current" type="password" required minlength="6" autocomplete="current-password" />
        </div>
        <div class="form-group">
          <label>New password</label>
          <input name="next" type="password" required minlength="6" autocomplete="new-password" />
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Update password</button>
        </div>
      </form>
      <p class="form-hint" style="margin-top:0.75rem">Password change only works for email/password accounts.</p>
    </div>

    <div class="form-card" style="margin-top:1.5rem;border-color:rgba(255,77,109,0.3)">
      <h2 style="margin-bottom:0.5rem;font-size:1.1rem;color:var(--danger)">Danger zone</h2>
      <p class="form-hint" style="margin-bottom:1rem">Permanently delete your account. This cannot be undone.</p>
      <form id="form-delete">
        <div class="form-group">
          <label>Confirm password</label>
          <input name="password" type="password" required autocomplete="current-password" />
        </div>
        <button type="submit" class="btn btn-danger">Delete account</button>
      </form>
    </div>`;

  const { updateUserProfile, changePassword, deleteAccount } = await import("./auth.js");
  const { updateUserDoc } = await import("./data.js");
  const { updateHeaderAuth } = await import("./shared.js");

  document.getElementById("form-profile").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const displayName = fd.get("displayName").toString().trim();
    const avatarUrl = fd.get("avatarUrl").toString().trim();
    const bio = fd.get("bio").toString().trim();
    try {
      await updateUserProfile({ displayName, photoURL: avatarUrl || null });
      await updateUserDoc(user.uid, { displayName, avatarUrl, bio });
      toast("Profile saved", "success");
      updateHeaderAuth(getCurrentUser());
    } catch (err) {
      toast(err.message, "error");
    }
  });

  document.getElementById("form-password").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await changePassword(fd.get("current"), fd.get("next"));
      toast("Password updated", "success");
      e.target.reset();
    } catch (err) {
      toast(err.message || "Could not change password", "error");
    }
  });

  document.getElementById("form-delete").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!confirm("Really delete your account forever?")) return;
    const fd = new FormData(e.target);
    try {
      await deleteAccount(fd.get("password"));
      toast("Account deleted", "success");
      window.location.href = "index.html";
    } catch (err) {
      toast(err.message || "Could not delete account", "error");
    }
  });
}