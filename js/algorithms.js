/**
 * Search, recommendations, trending, and "because you viewed"
 *
 * Drop-in compatible with the previous version:
 *   - Same exports, same signatures, same return shapes.
 *   - Same localStorage keys.
 *   - No Firebase SDK imports; feed functions never hit the network.
 *
 * Data shape assumptions (from the live Firebase schema):
 *   game = {
 *     id, title, description, genre, tags[], price, downloads,
 *     downloadsLast7d, downloadsLast30d, coverUrl, screenshots[],
 *     createdAt, updatedAt, authorUid, authorName, version,
 *     rating, ratingCount, ratingSum, ratingBreakdown: {1..5},
 *     executables: [{ name, url }]
 *   }
 *
 *   review (separate collection) = {
 *     id, gameId, uid, displayName, stars, review,
 *     createdAt, updatedAt
 *   }
 *
 * Since reviews live in their own collection, functions that want
 * recency-weighted ratings accept an optional `reviewsByGameId` map:
 *   { [gameId]: review[] }
 * If you don't pass it (feed endpoints usually don't), we fall back to
 * the aggregate fields already denormalized on the game doc.
 *
 * Follower counts: pass `{ followerCounts: { [uid]: number } }` to any
 * of the feed functions. Only Featured / Personalized / Rising use them.
 * Trending and Recently Added intentionally ignore followers.
 */

// ---------- Config ----------

const SEARCH_WEIGHTS = { title: 3, description: 0.5, tags: 1.5, genre: 2 };

const VIEW_KEY = "nexus_viewed_games";          // unchanged
const VIEW_TIME_KEY = "nexus_view_time:v1";
const COVIEW_KEY = "nexus_coviews:v1";
const SESSION_KEY = "nexus_session_signals:v1";

const MAX_VIEWED = 10;
const MAX_COVIEW_PAIRS = 500;
const MAX_SESSION_SIGNALS = 30;
const COVIEW_WINDOW_MS = 30 * 60 * 1000;

const BAYES_PRIOR_RATING = 4;
const BAYES_PRIOR_WEIGHT = 10;

const RATING_HALF_LIFE_DAYS = 180;

const DEFAULT_RECENT_WINDOW_DAYS = 30;
const DEFAULT_MAX_FOLLOWERS_RISING = 50;

// ---------- Small helpers ----------

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function time(v) {
  if (!v) return 0;
  // Firestore Timestamp has .toDate(); plain objects/strings fall through
  if (typeof v.toDate === "function") {
    const t = v.toDate().getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof v.seconds === "number") {
    return v.seconds * 1000 + num(v.nanoseconds) / 1e6;
  }
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

function norm(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Ratings ----------

/**
 * Normalize a review doc into { stars, atMs }.
 * Handles both your live schema (stars / createdAt) and variations.
 */
function readReview(r) {
  if (!r || typeof r !== "object") return null;
  const stars = num(r.stars ?? r.rating);
  if (stars <= 0) return null;
  const atMs = time(r.updatedAt ?? r.createdAt);
  return { stars, atMs };
}

/**
 * Build the reviewsByGameId map from a flat list of review docs.
 * Exported so the app can populate it in one place:
 *
 *   const reviews = await fetchAllReviews(); // flat array
 *   const reviewsByGameId = buildReviewsMap(reviews);
 *   getTrending(games, 10, { reviewsByGameId });
 */
export function buildReviewsMap(reviews) {
  const map = {};
  for (const r of reviews || []) {
    const gid = r && r.gameId;
    if (!gid) continue;
    const key = String(gid);
    (map[key] ||= []).push(r);
  }
  return map;
}

/**
 * Effective rating for a game.
 *   1. If recency-weighted reviews are available (either game.reviews or
 *      options.reviewsByGameId[game.id]), use time-decayed average.
 *   2. Else fall back to aggregate fields on the game doc:
 *      rating (mean), ratingCount, ratingSum, ratingBreakdown.
 */
function effectiveRating(g, reviewsByGameId) {
  // Path 1: embedded reviews array
  let reviews = Array.isArray(g.reviews) ? g.reviews : null;

  // Path 2: externally supplied map
  if (!reviews && reviewsByGameId && g.id != null) {
    const key = String(g.id);
    if (Array.isArray(reviewsByGameId[key])) {
      reviews = reviewsByGameId[key];
    }
  }

  if (reviews && reviews.length) {
    const now = Date.now();
    let weightedSum = 0;
    let weightSum = 0;
    let n = 0;

    for (const raw of reviews) {
      const r = readReview(raw);
      if (!r) continue;
      n++;
      const ageDays = r.atMs
        ? Math.max(0, (now - r.atMs) / 86400000)
        : 0;
      const w = Math.pow(0.5, ageDays / RATING_HALF_LIFE_DAYS);
      weightedSum += r.stars * w;
      weightSum += w;
    }

    if (weightSum > 0) {
      return {
        rating: weightedSum / weightSum,
        count: Math.max(num(g.ratingCount), n),
      };
    }
  }

  // Path 3: aggregate fields on the doc.
  // ratingSum / ratingCount is the exact mean and matches `rating`, but we
  // prefer ratingSum when present because it's the raw source of truth.
  const sum = num(g.ratingSum);
  const cnt = num(g.ratingCount);
  if (cnt > 0 && sum > 0) {
    return { rating: sum / cnt, count: cnt };
  }
  return { rating: num(g.rating), count: cnt };
}

function bayesRating(g, reviewsByGameId) {
  const { rating, count } = effectiveRating(g, reviewsByGameId);
  if (count <= 0) return rating;
  return (
    (rating * count + BAYES_PRIOR_RATING * BAYES_PRIOR_WEIGHT) /
    (count + BAYES_PRIOR_WEIGHT)
  );
}

// ---------- Ranking boosts ----------

function newGameBoost(g) {
  const at = time(g.createdAt);
  if (!at) return 1;
  const ageDays = (Date.now() - at) / 86400000;
  if (ageDays < 0) return 1;
  if (ageDays < 3) return 1.6;
  if (ageDays < 7) return 1.3;
  if (ageDays < 14) return 1.15;
  return 1;
}

/**
 * Bounded log-scaled boost from a creator's follower count.
 * Returns 1.0 for unknown/zero-follower creators, maxes at 1.5.
 *
 *   followers:   0  -> 1.00
 *               10  -> 1.18
 *              100  -> 1.34
 *             1000  -> 1.50
 *           10000+  -> 1.50 (capped)
 *
 * The cap is intentional: keeps new creators visible and avoids a
 * rich-get-richer feedback loop where early popular creators dominate
 * every featured slot forever.
 */
function creatorBoost(game, followerCounts) {
  if (!followerCounts) return 1;
  const f = num(followerCounts[game.authorUid]);
  if (f <= 0) return 1;
  return 1 + Math.min(0.5, Math.log10(f + 1) * 0.17);
}

// ---------- Storage helpers ----------

function hasLocal() {
  try {
    return (
      typeof window !== "undefined" &&
      !!window.localStorage &&
      typeof window.localStorage.getItem === "function"
    );
  } catch {
    return false;
  }
}

function hasSession() {
  try {
    return (
      typeof window !== "undefined" &&
      !!window.sessionStorage &&
      typeof window.sessionStorage.getItem === "function"
    );
  } catch {
    return false;
  }
}

// ---------- Session signals ----------

function readSession() {
  if (!hasSession()) return [];
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(SESSION_KEY) || "[]"
    );
    return Array.isArray(parsed) ? parsed.slice(0, MAX_SESSION_SIGNALS) : [];
  } catch {
    return [];
  }
}

function pushSignal(kind, value) {
  if (value === null || value === undefined || value === "") return;
  const list = readSession().filter(
    (s) => !(s.kind === kind && s.value === String(value))
  );
  list.unshift({ kind, value: String(value), at: Date.now() });

  if (!hasSession()) return;
  try {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify(list.slice(0, MAX_SESSION_SIGNALS))
    );
  } catch {}
}

export function trackSearch(query) {
  pushSignal("search", query);
}

export function trackTagClick(tag) {
  pushSignal("tag", tag);
}

export function trackGenreFilter(genre) {
  if (genre && genre !== "all") pushSignal("genre", genre);
}

export function getSessionSignals() {
  return readSession();
}

function sessionTagWeights() {
  const weights = new Map();
  readSession().forEach((s, i) => {
    const recency = 1 / (i + 1);
    if (s.kind === "genre" || s.kind === "tag") {
      const k = norm(s.value);
      weights.set(k, (weights.get(k) || 0) + recency * 1.5);
    }
    if (s.kind === "search") {
      for (const w of norm(s.value).split(" ")) {
        if (w.length >= 3) {
          weights.set(w, (weights.get(w) || 0) + recency * 0.5);
        }
      }
    }
  });
  return weights;
}

// ---------- Co-views (local, per user) ----------

function pairKey(a, b) {
  const s = [String(a), String(b)].sort();
  return s[0] + "||" + s[1];
}

function readCoviews() {
  if (!hasLocal()) return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COVIEW_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function bumpCoview(a, b) {
  if (a == null || b == null) return;
  if (String(a) === String(b)) return;

  const map = readCoviews();
  const k = pairKey(a, b);
  map[k] = (map[k] || 0) + 1;

  const entries = Object.entries(map);
  if (entries.length > MAX_COVIEW_PAIRS) {
    entries.sort((x, y) => y[1] - x[1]);
    try {
      window.localStorage.setItem(
        COVIEW_KEY,
        JSON.stringify(Object.fromEntries(entries.slice(0, MAX_COVIEW_PAIRS)))
      );
    } catch {}
    return;
  }

  try {
    window.localStorage.setItem(COVIEW_KEY, JSON.stringify(map));
  } catch {}
}

function getCoviewCount(a, b) {
  return readCoviews()[pairKey(a, b)] || 0;
}

export function getCoviewStrength(a, b) {
  return getCoviewCount(a, b);
}

// ---------- Deterministic RNG ----------

function daySeed(d = new Date()) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- MMR diversification ----------

function jaccardSets(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function defaultSim(a, b) {
  const ta = new Set((a.tags || []).map(norm));
  const tb = new Set((b.tags || []).map(norm));
  const genreBonus = norm(a.genre) === norm(b.genre) ? 0.3 : 0;
  return Math.min(1, jaccardSets(ta, tb) + genreBonus);
}

function mmrDiversify(scored, topN, lambda = 0.75, simFn = defaultSim) {
  if (!Array.isArray(scored) || scored.length === 0 || topN <= 0) return [];
  if (scored.length <= topN) return scored.map((x) => x.game);

  const maxScore = scored[0].score || 1;
  const pool = scored.map((x) => ({
    game: x.game,
    score: x.score,
    rel: x.score / maxScore,
  }));

  const picked = [];
  const remaining = [...pool];

  while (picked.length < topN && remaining.length) {
    let bestIdx = 0;
    let bestVal = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      let maxSim = 0;
      for (const p of picked) {
        const s = simFn(cand.game, p);
        if (s > maxSim) maxSim = s;
      }
      const val = lambda * cand.rel - (1 - lambda) * maxSim;
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }

    picked.push(remaining[bestIdx].game);
    remaining.splice(bestIdx, 1);
  }

  return picked;
}

// ---------- Fuzzy search ----------

function fuzzyScore(text, query) {
  const t = norm(text);
  const q = norm(query);
  if (!q || !t) return 0;
  if (t === q) return 100;

  let phraseScore = 0;
  if (t.startsWith(q)) phraseScore = 80;
  if (t.includes(q)) phraseScore = Math.max(phraseScore, 50);

  const tWords = t.split(" ");
  const qWords = q.split(" ");
  let wordScore = 0;
  let matchedWords = 0;

  for (const qw of qWords) {
    if (!qw) continue;
    let best = 0;
    for (const tw of tWords) {
      if (tw === qw) best = Math.max(best, 30);
      else if (tw.startsWith(qw)) best = Math.max(best, 20);
      else if (tw.includes(qw)) best = Math.max(best, 10);
      else if (
        qw.length > 2 &&
        tw.includes(qw.slice(0, Math.ceil(qw.length * 0.7)))
      ) {
        best = Math.max(best, 5);
      }
    }
    if (best > 0) matchedWords++;
    wordScore += best;
  }

  if (qWords.length > 1 && matchedWords === qWords.length) wordScore += 20;

  return Math.max(phraseScore, wordScore);
}

export function buildSearchIndex(games) {
  return (games || []).map((game) => ({
    game,
    title: norm(game.title),
    description: norm(game.description),
    genre: norm(game.genre),
    tags: (game.tags || []).map(norm),
  }));
}

export function searchGames(games, query, options = {}) {
  const list = games || [];
  const q = (query || "").trim();
  if (!q) return list.map((game) => ({ game, score: 0 }));

  const index = options.index || buildSearchIndex(list);
  const results = [];

  for (const item of index) {
    const { game } = item;

    const titleScore = fuzzyScore(item.title, q) * SEARCH_WEIGHTS.title;
    const descScore =
      fuzzyScore(item.description, q) * SEARCH_WEIGHTS.description;
    const tagScore =
      item.tags.reduce((sum, tag) => sum + fuzzyScore(tag, q), 0) *
      SEARCH_WEIGHTS.tags;
    const genreScore = fuzzyScore(item.genre, q) * SEARCH_WEIGHTS.genre;

    let total = titleScore + descScore + tagScore + genreScore;
    if (total <= 0) continue;

    total += num(game.rating) * 0.1;
    total += Math.log10(num(game.downloads) + 1) * 0.2;

    results.push({ game, score: total });
  }

  results.sort(
    (a, b) =>
      b.score - a.score ||
      num(b.game.rating) - num(a.game.rating) ||
      num(b.game.downloads) - num(a.game.downloads)
  );

  return results;
}

// ---------- Similarity ----------

export function jaccard(tagsA = [], tagsB = []) {
  return jaccardSets(new Set(tagsA.map(norm)), new Set(tagsB.map(norm)));
}

/**
 * "You may also like".
 *
 * Blends:
 *   - tag Jaccard
 *   - genre bonus
 *   - per-user co-view boost (local CF)
 *   - small quality tie-breaker
 *   - MMR diversification
 */
export function getRecommendations(games, targetGame, topN = 6, options = {}) {
  if (!targetGame) return [];
  const list = games || [];
  const lambda = options.lambda ?? 0.75;

  const targetId = targetGame.id;
  const targetTags = new Set((targetGame.tags || []).map(norm));
  const targetGenre = norm(targetGame.genre);

  const scored = list
    .filter(
      (g) =>
        g !== targetGame &&
        (targetId == null || String(g.id) !== String(targetId))
    )
    .map((g) => {
      const tags = new Set((g.tags || []).map(norm));
      const tagScore = jaccardSets(targetTags, tags);
      const genreScore =
        targetGenre && norm(g.genre) === targetGenre ? 0.15 : 0;
      const base = tagScore + genreScore;

      const co = getCoviewCount(targetId, g.id);
      const coBoost = co > 0 ? Math.min(0.5, 0.15 * Math.log2(co + 1)) : 0;

      const total = base + coBoost;
      if (total <= 0) return null;

      const quality =
        num(g.rating) * 0.02 + Math.log10(num(g.downloads) + 1) * 0.02;

      return { game: g, score: total + quality };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return mmrDiversify(scored, topN, lambda);
}

// ---------- Feed-style curation ----------

/**
 * Trending: pure momentum. Intentionally does NOT use follower counts —
 * trending should reflect "what's hot right now", not creator fame.
 */
export function getTrending(games, topN = 10, options = {}) {
  const list = games || [];
  const lambda = options.lambda ?? 0.75;
  const reviewsByGameId = options.reviewsByGameId;

  const scored = list
    .map((g) => {
      const d7 = num(g.downloadsLast7d);
      const d30 = num(g.downloadsLast30d);
      const rating = bayesRating(g, reviewsByGameId);
      const baseline7d = (d30 / 30) * 7;
      const momentum = Math.max(0, d7 - baseline7d);
      const score =
        (d7 * 2 + d30 * 0.5 + momentum * 3 + rating * 10) * newGameBoost(g);
      return { game: g, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score || num(b.game.downloads) - num(a.game.downloads)
    );

  const hasActivity = (x) =>
    num(x.game.downloadsLast7d) > 0 || num(x.game.downloadsLast30d) > 0;

  let pool = scored.filter(hasActivity);
  if (pool.length < topN) pool = scored;

  return mmrDiversify(pool, topN, lambda);
}

/**
 * Recently added: chronological, restricted to a recent window.
 * Intentionally does NOT use follower counts.
 */
export function getRecentlyAdded(games, topN = 8, options = {}) {
  const list = games || [];
  const windowDays = options.windowDays ?? DEFAULT_RECENT_WINDOW_DAYS;
  const lambda = options.lambda ?? 0.75;

  const sorted = [...list].sort(
    (a, b) => time(b.createdAt) - time(a.createdAt)
  );

  const cutoff = Date.now() - windowDays * 86400000;
  const recent = sorted.filter((g) => time(g.createdAt) >= cutoff);
  const pool = recent.length >= Math.min(topN, list.length) ? recent : sorted;

  const scored = pool.map((g, i) => ({ game: g, score: 1 / (i + 1) }));
  return mmrDiversify(scored, topN, lambda);
}

function featuredScore(g, reviewsByGameId, followerCounts) {
  const rating = bayesRating(g, reviewsByGameId);
  const base = rating * 10 + Math.log10(num(g.downloads) + 1) * 5;
  return base * newGameBoost(g) * creatorBoost(g, followerCounts);
}

/**
 * Featured: quality + new-game boost + bounded creator follower boost.
 * Day-seeded jitter so the row rotates; MMR diversification so it's not
 * all one genre.
 */
export function getFeatured(games, topN = 4, options = {}) {
  const list = games || [];
  const seed = options.seed ?? daySeed();
  const lambda = options.lambda ?? 0.75;
  const reviewsByGameId = options.reviewsByGameId;
  const followerCounts = options.followerCounts;

  if (list.length === 0) return [];

  const scored = list
    .map((g) => ({
      game: g,
      score: featuredScore(g, reviewsByGameId, followerCounts),
    }))
    .sort((a, b) => b.score - a.score);

  const poolSize = Math.min(scored.length, Math.max(topN * 3, topN));
  const pool = scored.slice(0, poolSize);

  const rand = mulberry32(seed);
  const jittered = pool
    .map((x) => ({ game: x.game, score: x.score * (0.8 + rand() * 0.4) }))
    .sort((a, b) => b.score - a.score);

  return mmrDiversify(jittered, topN, lambda);
}

/**
 * Rising Creators: games from low-follower creators with some engagement
 * signal. Gives new/small creators a guaranteed discovery slot without
 * being charity — the game still has to show some quality (rating or
 * downloads). Games with zero of both are excluded.
 *
 *   options.maxFollowers   default 50
 *   options.reviewsByGameId
 *   options.followerCounts
 *   options.lambda         default 0.75
 */
export function getRisingCreators(games, topN = 4, options = {}) {
  const list = games || [];
  const followerCounts = options.followerCounts || {};
  const reviewsByGameId = options.reviewsByGameId;
  const lambda = options.lambda ?? 0.75;
  const maxFollowers = options.maxFollowers ?? DEFAULT_MAX_FOLLOWERS_RISING;

  const eligible = list.filter((g) => {
    const f = num(followerCounts[g.authorUid]);
    return f <= maxFollowers;
  });
  if (!eligible.length) return [];

  const scored = eligible
    .map((g) => {
      const rating = bayesRating(g, reviewsByGameId);
      const downloads = num(g.downloads);
      // Require a real signal: a fresh upload with zero activity isn't "rising"
      if (downloads <= 0 && rating <= 0) return null;
      const score =
        (rating * 10 + Math.log10(downloads + 1) * 5) * newGameBoost(g);
      return { game: g, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return mmrDiversify(scored, topN, lambda);
}

// ---------- View history (localStorage) ----------

function readViewedIds() {
  if (!hasLocal()) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VIEW_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id) => id !== null && id !== undefined)
      .slice(0, MAX_VIEWED);
  } catch {
    return [];
  }
}

export function trackView(gameId) {
  if (gameId === null || gameId === undefined) return;
  if (!hasLocal()) return;

  const prevList = readViewedIds();
  const prevId = prevList[0];
  const now = Date.now();

  let lastAt = 0;
  try {
    lastAt = num(
      JSON.parse(window.localStorage.getItem(VIEW_TIME_KEY) || "0")
    );
  } catch {}

  if (
    prevId != null &&
    String(prevId) !== String(gameId) &&
    now - lastAt < COVIEW_WINDOW_MS
  ) {
    bumpCoview(prevId, gameId);
  }

  const list = prevList.filter((id) => String(id) !== String(gameId));
  list.unshift(gameId);

  try {
    window.localStorage.setItem(
      VIEW_KEY,
      JSON.stringify(list.slice(0, MAX_VIEWED))
    );
    window.localStorage.setItem(VIEW_TIME_KEY, JSON.stringify(now));
  } catch {}
}

export function getViewedIds() {
  return readViewedIds();
}

// ---------- Because you viewed ----------

export function getBecauseYouViewed(games, topN = 6, options = {}) {
  const list = games || [];
  const lambda = options.lambda ?? 0.75;
  const viewedIds = getViewedIds();
  const sessionWeights = sessionTagWeights();

  if (!viewedIds.length && sessionWeights.size === 0) return [];

  const byId = new Map(list.map((g) => [String(g.id), g]));
  const viewed = viewedIds.map((id) => byId.get(String(id))).filter(Boolean);

  const N = list.length || 1;
  const tagDocCount = new Map();
  for (const g of list) {
    for (const tag of new Set((g.tags || []).map(norm))) {
      tagDocCount.set(tag, (tagDocCount.get(tag) || 0) + 1);
    }
  }

  const idfOf = (tag) =>
    Math.log((N + 1) / ((tagDocCount.get(tag) || 0) + 1)) + 1;

  const tagWeights = new Map();

  viewed.forEach((g, i) => {
    const recency = 1 / (i + 1);
    for (const tag of new Set((g.tags || []).map(norm))) {
      tagWeights.set(tag, (tagWeights.get(tag) || 0) + recency * idfOf(tag));
    }
  });

  for (const [tag, w] of sessionWeights) {
    tagWeights.set(tag, (tagWeights.get(tag) || 0) + w * idfOf(tag));
  }

  const exclude = new Set(viewedIds.map(String));
  const recentGenre = viewed[0] ? norm(viewed[0].genre) : "";

  const scored = list
    .filter((g) => !exclude.has(String(g.id)))
    .map((g) => {
      let score = 0;
      for (const tag of new Set((g.tags || []).map(norm))) {
        score += tagWeights.get(tag) || 0;
      }
      if (recentGenre && norm(g.genre) === recentGenre) score += 0.5;
      if (score <= 0) return null;

      score += num(g.rating) * 0.02 + Math.log10(num(g.downloads) + 1) * 0.02;
      return { game: g, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return mmrDiversify(scored, topN, lambda);
}

// ---------- Unified "For You" feed ----------

export function getPersonalizedFeed(games, topN = 12, options = {}) {
  const list = games || [];
  if (!list.length) return [];

  const lambda = options.lambda ?? 0.75;
  const exploration = options.exploration ?? 0.1;
  const seed = options.seed ?? daySeed();
  const reviewsByGameId = options.reviewsByGameId;
  const followerCounts = options.followerCounts;

  const viewed = getViewedIds();
  const hasHistory = viewed.length > 0;
  const sessionHasSignals = getSessionSignals().length > 0;

  const scores = new Map();

  const addAll = (arr, weight) => {
    (arr || []).forEach((g, i) => {
      const id = String(g.id);
      const contribution = weight * (1 / (i + 1));
      const prev = scores.get(id);
      if (prev) prev.score += contribution;
      else scores.set(id, { game: g, score: contribution });
    });
  };

  addAll(getTrending(list, 40, { lambda, reviewsByGameId }), 1.0);
  addAll(
    getFeatured(list, 20, { lambda, seed, reviewsByGameId, followerCounts }),
    0.8
  );
  addAll(getRecentlyAdded(list, 20, { lambda }), 0.6);

  if (hasHistory || sessionHasSignals) {
    addAll(getBecauseYouViewed(list, 30, { lambda }), 2.0);
  }

  if (viewed.length > 0) {
    const byId = new Map(list.map((g) => [String(g.id), g]));
    const recent = byId.get(String(viewed[0]));
    if (recent) {
      addAll(getRecommendations(list, recent, 20, { lambda }), 2.5);
    }
  }

  const ranked = [...scores.values()].sort((a, b) => b.score - a.score);

  const excludeViewed = new Set(viewed.map(String));
  const longTail = list.filter(
    (g) => !scores.has(String(g.id)) && !excludeViewed.has(String(g.id))
  );
  const rand = mulberry32(seed + 991);
  const numExplore = Math.floor(topN * exploration);
  for (let i = 0; i < numExplore && longTail.length; i++) {
    const idx = Math.floor(rand() * longTail.length);
    const g = longTail.splice(idx, 1)[0];
    const insertAt = Math.floor(rand() * (ranked.length + 1));
    ranked.splice(insertAt, 0, { game: g, score: 0.01 });
  }

  return mmrDiversify(ranked, topN, lambda);
}

// ---------- Filtering / sorting ----------

export function filterGames(games, { genre, maxPrice, minRating, sort } = {}) {
  let list = [...(games || [])];

  if (genre && genre !== "all") {
    const target = norm(genre);
    list = list.filter((g) => norm(g.genre) === target);
  }

  if (maxPrice !== undefined && maxPrice !== "" && maxPrice !== "any") {
    const mp = Number(maxPrice);
    if (Number.isFinite(mp)) list = list.filter((g) => num(g.price) <= mp);
  }

  if (minRating !== undefined && minRating !== "" && minRating !== "any") {
    const mr = Number(minRating);
    if (Number.isFinite(mr)) list = list.filter((g) => num(g.rating) >= mr);
  }

  const sorters = {
    "price-asc": (a, b) => num(a.price) - num(b.price),
    "price-desc": (a, b) => num(b.price) - num(a.price),
    rating: (a, b) =>
      num(b.rating) - num(a.rating) || num(b.downloads) - num(a.downloads),
    newest: (a, b) => time(b.createdAt) - time(a.createdAt),
    downloads: (a, b) => num(b.downloads) - num(a.downloads),
    title: (a, b) =>
      String(a.title || "").localeCompare(String(b.title || "")),
  };

  if (sort && sorters[sort]) list.sort(sorters[sort]);
  return list;
}

// ---------- Constants ----------

export const GENRES = [
  "Action",
  "Adventure",
  "RPG",
  "Strategy",
  "Simulation",
  "Puzzle",
  "Horror",
  "Platformer",
  "Shooter",
  "Racing",
  "Sports",
  "Battle Royale",
  "Roguelike",
  "Survival",
  "Open World",
  "Visual Novel",
  "Turn-Based",
  "Fighting",
  "Stealth",
  "Sandbox",
  "Management",
  "Rhythm",
  "Party",
  "Narrative",
  "Calm",
  "Multiplayer",
  "Indie",
  "Other",
];