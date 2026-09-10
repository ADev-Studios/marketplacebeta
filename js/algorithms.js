/**
 * Search, recommendations, trending, and "because you viewed"
 *
 * Drop-in compatible with the previous version:
 *   - Same exports, same signatures, same return shapes.
 *   - Same localStorage key (existing view history is preserved).
 *   - No Firebase / network / React dependencies.
 *
 * Behavior changes vs. before (all intentional):
 *   - getFeatured rotates daily and diversifies by genre.
 *   - getTrending weights momentum (7d vs 30d baseline), not just raw counts.
 *   - getRecentlyAdded restricts to a recent window with a graceful fallback.
 *   - All feed-style outputs cap same-genre repeats.
 *   - Optional 3rd arg { maxPerGenre, seed, windowDays } on feed functions.
 */

// ---------- Config ----------

const SEARCH_WEIGHTS = { title: 3, description: 0.5, tags: 1.5, genre: 2 };
const VIEW_KEY = "nexus_viewed_games"; // unchanged on purpose
const MAX_VIEWED = 10;

const BAYES_PRIOR_RATING = 4;
const BAYES_PRIOR_WEIGHT = 10;

const DEFAULT_RECENT_WINDOW_DAYS = 30;
const DEFAULT_MAX_PER_GENRE = 2;

// ---------- Small helpers ----------

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function time(v) {
  if (!v) return 0;
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

function bayesRating(g) {
  const rating = num(g.rating);
  const count = num(g.ratingCount ?? g.reviews ?? g.reviewCount ?? 0);
  if (count <= 0) return rating;
  return (
    (rating * count + BAYES_PRIOR_RATING * BAYES_PRIOR_WEIGHT) /
    (count + BAYES_PRIOR_WEIGHT)
  );
}

// ---------- Deterministic RNG (for daily rotation) ----------

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

// ---------- Diversity ----------

/**
 * Pick up to topN games, preferring at most `maxPerGenre` from each genre.
 * If diversity would leave fewer than topN, fill remaining slots from the
 * overflow (so we never return fewer items than the catalog allows).
 */
function diversifyGames(games, topN, maxPerGenre = DEFAULT_MAX_PER_GENRE) {
  if (!Array.isArray(games) || games.length === 0) return [];
  if (maxPerGenre <= 0 || topN <= 0) return games.slice(0, topN);

  const counts = new Map();
  const picked = [];
  const overflow = [];

  for (const g of games) {
    if (picked.length >= topN) break;
    const genre = norm(g.genre) || "__none__";
    const c = counts.get(genre) || 0;
    if (c < maxPerGenre) {
      counts.set(genre, c + 1);
      picked.push(g);
    } else {
      overflow.push(g);
    }
  }

  // If we hit the genre cap before topN, top up from overflow.
  if (picked.length < topN) {
    for (const g of games) {
      if (picked.length >= topN) break;
      if (picked.includes(g)) continue;
      picked.push(g);
    }
  }

  return picked.slice(0, topN);
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

/**
 * Precompute a normalized search index. Optional - if you don't pass it,
 * searchGames() will build one on the fly.
 *
 * Usage (recommended in React):
 *   const index = useMemo(() => buildSearchIndex(games), [games]);
 *   const results = searchGames(games, query, { index });
 */
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
    const descScore = fuzzyScore(item.description, q) * SEARCH_WEIGHTS.description;
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

function jaccardSets(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function jaccard(tagsA = [], tagsB = []) {
  return jaccardSets(new Set(tagsA.map(norm)), new Set(tagsB.map(norm)));
}

export function getRecommendations(games, targetGame, topN = 6) {
  if (!targetGame) return [];
  const list = games || [];

  const targetId = targetGame.id;
  const targetTags = new Set((targetGame.tags || []).map(norm));
  const targetGenre = norm(targetGame.genre);

  return list
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
      if (base <= 0) return null;

      const quality =
        num(g.rating) * 0.02 + Math.log10(num(g.downloads) + 1) * 0.02;

      return { game: g, score: base + quality };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((x) => x.game);
}

// ---------- Feed-style curation ----------

/**
 * Trending: momentum-weighted hotness.
 *
 *   baseline_7d = (downloads_30d / 30) * 7   // expected 7d rate at steady state
 *   momentum    = max(0, downloads_7d - baseline_7d)
 *   score       = d7*2 + d30*0.5 + momentum*3 + bayesRating*10
 *
 * Games with no recent activity fall back in as filler only if there aren't
 * enough "actually trending" games to fill the section.
 */
export function getTrending(games, topN = 10, options = {}) {
  const list = games || [];
  const maxPerGenre = options.maxPerGenre ?? DEFAULT_MAX_PER_GENRE;

  const scored = list
    .map((g) => {
      const d7 = num(g.downloadsLast7d);
      const d30 = num(g.downloadsLast30d);
      const rating = bayesRating(g);
      const baseline7d = (d30 / 30) * 7;
      const momentum = Math.max(0, d7 - baseline7d);
      const score = d7 * 2 + d30 * 0.5 + momentum * 3 + rating * 10;
      return { game: g, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        num(b.game.downloads) - num(a.game.downloads)
    );

  const hasActivity = (x) =>
    num(x.game.downloadsLast7d) > 0 || num(x.game.downloadsLast30d) > 0;

  let pool = scored.filter(hasActivity);
  if (pool.length < topN) pool = scored; // graceful fallback

  return diversifyGames(
    pool.map((x) => x.game),
    topN,
    maxPerGenre
  );
}

/**
 * Recently added: only games from the last `windowDays` (default 30).
 * Falls back to the newest games if the recent window is too small to fill
 * the section, so a small/quiet catalog never shows an empty row.
 */
export function getRecentlyAdded(games, topN = 8, options = {}) {
  const list = games || [];
  const windowDays = options.windowDays ?? DEFAULT_RECENT_WINDOW_DAYS;
  const maxPerGenre = options.maxPerGenre ?? DEFAULT_MAX_PER_GENRE;

  const sorted = [...list].sort(
    (a, b) => time(b.createdAt) - time(a.createdAt)
  );

  const cutoff = Date.now() - windowDays * 86400000;
  const recent = sorted.filter((g) => time(g.createdAt) >= cutoff);

  const pool = recent.length >= Math.min(topN, list.length) ? recent : sorted;

  return diversifyGames(pool, topN, maxPerGenre);
}

/**
 * Featured: quality-pooled, day-rotated, genre-diversified.
 *
 *   1. Score everything by quality (bayes rating + log downloads).
 *   2. Take a quality pool of the top `topN * 3`.
 *   3. Apply a bounded per-game jitter seeded by the day, so the same top
 *      games don't show every day but low-quality games can't jump in.
 *   4. Diversify by genre.
 */
function featuredScore(g) {
  const rating = bayesRating(g);
  return rating * 10 + Math.log10(num(g.downloads) + 1) * 5;
}

export function getFeatured(games, topN = 4, options = {}) {
  const list = games || [];
  const maxPerGenre = options.maxPerGenre ?? DEFAULT_MAX_PER_GENRE;
  const seed = options.seed ?? daySeed();

  if (list.length === 0) return [];

  const scored = list
    .map((g) => ({ game: g, score: featuredScore(g) }))
    .sort((a, b) => b.score - a.score);

  const poolSize = Math.min(scored.length, Math.max(topN * 3, topN));
  const pool = scored.slice(0, poolSize);

  const rand = mulberry32(seed);
  const jittered = pool
    .map((x) => ({
      game: x.game,
      score: x.score * (0.8 + rand() * 0.4), // ±20%
    }))
    .sort((a, b) => b.score - a.score);

  return diversifyGames(
    jittered.map((x) => x.game),
    topN,
    maxPerGenre
  );
}

// ---------- View history (localStorage) ----------

function hasStorage() {
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

function readViewedIds() {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    const parsed = JSON.parse(raw || "[]");
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

  const list = readViewedIds().filter((id) => id !== gameId);
  list.unshift(gameId);

  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(
      VIEW_KEY,
      JSON.stringify(list.slice(0, MAX_VIEWED))
    );
  } catch {
    // storage full / private mode - ignore
  }
}

export function getViewedIds() {
  return readViewedIds();
}

/**
 * "Because you viewed": tag-overlap recommendation with recency weighting
 * and IDF (rare tags matter more). Diversified by genre.
 */
export function getBecauseYouViewed(games, topN = 6, options = {}) {
  const list = games || [];
  const maxPerGenre = options.maxPerGenre ?? DEFAULT_MAX_PER_GENRE;
  const viewedIds = getViewedIds();
  if (!viewedIds.length) return [];

  const byId = new Map(list.map((g) => [String(g.id), g]));
  const viewed = viewedIds
    .map((id) => byId.get(String(id)))
    .filter(Boolean);
  if (!viewed.length) return [];

  const N = list.length || 1;
  const tagDocCount = new Map();
  for (const g of list) {
    for (const tag of new Set((g.tags || []).map(norm))) {
      tagDocCount.set(tag, (tagDocCount.get(tag) || 0) + 1);
    }
  }

  const tagWeights = new Map();
  viewed.forEach((g, i) => {
    const recency = 1 / (i + 1);
    for (const tag of new Set((g.tags || []).map(norm))) {
      const df = tagDocCount.get(tag) || 0;
      const idf = Math.log((N + 1) / (df + 1)) + 1;
      tagWeights.set(tag, (tagWeights.get(tag) || 0) + recency * idf);
    }
  });

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

      score +=
        num(g.rating) * 0.02 + Math.log10(num(g.downloads) + 1) * 0.02;

      return { game: g, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return diversifyGames(
    scored.map((x) => x.game),
    topN,
    maxPerGenre
  );
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
      num(b.rating) - num(a.rating) ||
      num(b.downloads) - num(a.downloads),
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
  "Indie",
  "Other",
];   