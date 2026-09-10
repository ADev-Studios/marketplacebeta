/**
 * Search, recommendations, trending, and "because you viewed"
 */

/** Normalize string for comparison */
function norm(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Fuzzy score: how well query matches text.
 * Exact word matches score higher; substring matches score lower.
 */
function fuzzyScore(text, query) {
  const t = norm(text);
  const q = norm(query);
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 50;

  const tWords = t.split(" ");
  const qWords = q.split(" ");
  let score = 0;
  for (const qw of qWords) {
    if (!qw) continue;
    let best = 0;
    for (const tw of tWords) {
      if (tw === qw) best = Math.max(best, 30);
      else if (tw.startsWith(qw)) best = Math.max(best, 20);
      else if (tw.includes(qw)) best = Math.max(best, 10);
      else if (qw.length > 2 && tw.includes(qw.slice(0, Math.ceil(qw.length * 0.7)))) {
        best = Math.max(best, 5);
      }
    }
    score += best;
  }
  return score;
}

/**
 * Search games: fuzzy across title, description, tags.
 * Title matches weighted higher than tags.
 * Returns sorted array of { game, score }.
 */
export function searchGames(games, query, options = {}) {
  const q = (query || "").trim();
  if (!q) return games.map((g) => ({ game: g, score: 0 }));

  const results = [];
  for (const game of games) {
    const titleScore = fuzzyScore(game.title, q) * 3; // title weight ×3
    const descScore = fuzzyScore(game.description, q) * 0.5;
    const tagScore = (game.tags || []).reduce((sum, tag) => sum + fuzzyScore(tag, q), 0) * 1.5;
    const genreScore = fuzzyScore(game.genre, q) * 2;
    const total = titleScore + descScore + tagScore + genreScore;
    if (total > 0) results.push({ game, score: total });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Jaccard similarity between two tag arrays
 */
export function jaccard(tagsA = [], tagsB = []) {
  const a = new Set(tagsA.map((t) => norm(t)));
  const b = new Set(tagsB.map((t) => norm(t)));
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Recommendations: for a given game, score others by tag overlap (Jaccard).
 * Return top N (default 6).
 */
export function getRecommendations(games, targetGame, topN = 6) {
  if (!targetGame) return [];
  const scored = games
    .filter((g) => g.id !== targetGame.id)
    .map((g) => ({
      game: g,
      score: jaccard(targetGame.tags, g.tags) + (g.genre === targetGame.genre ? 0.15 : 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((x) => x.game);
}

/**
 * Trending score = (downloads_last_7d * 2) + (downloads_last_30d * 0.5) + (rating * 10)
 * Return top 10.
 */
export function getTrending(games, topN = 10) {
  const scored = games.map((g) => {
    const d7 = g.downloadsLast7d ?? 0;
    const d30 = g.downloadsLast30d ?? 0;
    const rating = g.rating ?? 0;
    const score = d7 * 2 + d30 * 0.5 + rating * 10;
    return { game: g, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((x) => x.game);
}

/**
 * Recently added (by createdAt desc)
 */
export function getRecentlyAdded(games, topN = 8) {
  return [...games]
    .sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    })
    .slice(0, topN);
}

/**
 * Featured: high rating + some downloads (simple heuristic)
 */
export function getFeatured(games, topN = 4) {
  return [...games]
    .sort((a, b) => {
      const sa = (a.rating || 0) * 10 + Math.log10((a.downloads || 0) + 1) * 5;
      const sb = (b.rating || 0) * 10 + Math.log10((b.downloads || 0) + 1) * 5;
      return sb - sa;
    })
    .slice(0, topN);
}

// ---------- View history (localStorage) ----------

const VIEW_KEY = "nexus_viewed_games";
const MAX_VIEWED = 10;

export function trackView(gameId) {
  try {
    let list = JSON.parse(localStorage.getItem(VIEW_KEY) || "[]");
    list = list.filter((id) => id !== gameId);
    list.unshift(gameId);
    list = list.slice(0, MAX_VIEWED);
    localStorage.setItem(VIEW_KEY, JSON.stringify(list));
  } catch {}
}

export function getViewedIds() {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) || "[]");
  } catch {
    return [];
  }
}

/**
 * "Because you viewed": recommend based on tag overlap with last viewed games.
 */
export function getBecauseYouViewed(games, topN = 6) {
  const viewedIds = getViewedIds();
  if (!viewedIds.length) return [];

  const viewed = viewedIds
    .map((id) => games.find((g) => g.id === id))
    .filter(Boolean);
  if (!viewed.length) return [];

  // Aggregate tag scores from viewed games
  const tagWeights = {};
  for (const g of viewed) {
    for (const tag of g.tags || []) {
      const k = norm(tag);
      tagWeights[k] = (tagWeights[k] || 0) + 1;
    }
  }

  const exclude = new Set(viewedIds);
  const scored = games
    .filter((g) => !exclude.has(g.id))
    .map((g) => {
      let score = 0;
      for (const tag of g.tags || []) {
        score += tagWeights[norm(tag)] || 0;
      }
      // slight boost for matching genre of most recent view
      if (viewed[0] && g.genre === viewed[0].genre) score += 0.5;
      return { game: g, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topN).map((x) => x.game);
}

/**
 * Apply store filters (genre, price range, min rating)
 */
export function filterGames(games, { genre, maxPrice, minRating, sort } = {}) {
  let list = [...games];
  if (genre && genre !== "all") {
    list = list.filter((g) => norm(g.genre) === norm(genre));
  }
  if (maxPrice !== undefined && maxPrice !== "" && maxPrice !== "any") {
    const mp = Number(maxPrice);
    if (!Number.isNaN(mp)) list = list.filter((g) => (g.price || 0) <= mp);
  }
  if (minRating !== undefined && minRating !== "" && minRating !== "any") {
    const mr = Number(minRating);
    if (!Number.isNaN(mr)) list = list.filter((g) => (g.rating || 0) >= mr);
  }
  if (sort === "price-asc") list.sort((a, b) => (a.price || 0) - (b.price || 0));
  else if (sort === "price-desc") list.sort((a, b) => (b.price || 0) - (a.price || 0));
  else if (sort === "rating") list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else if (sort === "newest") list = getRecentlyAdded(list, list.length);
  else if (sort === "downloads") list.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
  else if (sort === "title") list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  return list;
}

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
  "Indie",
  "Other",
];
