/**
 * Firestore CRUD for games & users + local JSON fallback for development.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  increment,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getDb, getCurrentUser } from "./auth.js";

const R2_BUCKET_URL = "R2_BUCKET_URL"; // placeholder — e.g. https://pub-xxx.r2.dev

let localGames = null;
let localUsers = null;
let useLocal = false;

/** Load local fallback data (for GitHub Pages / offline dev) */
async function loadLocalData() {
  if (localGames) return;
  try {
    const stored = sessionStorage.getItem("nexus_local_games");
    if (stored) {
      localGames = JSON.parse(stored);
    } else {
      const gRes = await fetch("data/games.json");
      localGames = await gRes.json();
    }
    const uRes = await fetch("data/users.json");
    localUsers = await uRes.json();
    useLocal = true;
  } catch {
    localGames = localGames || [];
    localUsers = localUsers || {};
    useLocal = true;
  }
}

function generateId() {
  return "g_" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

// ---------- Games ----------

export async function getAllGames() {
  const db = getDb();
  if (!db) {
    await loadLocalData();
    return [...localGames];
  }
  try {
    const snap = await getDocs(collection(db, "games"));
    const games = [];
    snap.forEach((d) => games.push({ id: d.id, ...d.data() }));
    return games;
  } catch (err) {
    console.warn("[data] Firestore read failed, using local:", err.message);
    await loadLocalData();
    return [...localGames];
  }
}

export async function getGameById(id) {
  const db = getDb();
  if (!db) {
    await loadLocalData();
    return localGames.find((g) => g.id === id) || null;
  }
  try {
    const snap = await getDoc(doc(db, "games", id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch {
    await loadLocalData();
    return localGames.find((g) => g.id === id) || null;
  }
}

export async function getGamesByAuthor(uid) {
  const db = getDb();
  if (!db) {
    await loadLocalData();
    return localGames.filter((g) => g.authorUid === uid);
  }
  try {
    const q = query(collection(db, "games"), where("authorUid", "==", uid));
    const snap = await getDocs(q);
    const games = [];
    snap.forEach((d) => games.push({ id: d.id, ...d.data() }));
    return games;
  } catch {
    await loadLocalData();
    return localGames.filter((g) => g.authorUid === uid);
  }
}

export async function createGame(gameData) {
  const user = getCurrentUser();
  if (!user) throw new Error("You must be signed in to upload a game.");

  const id = generateId();
  const payload = {
    title: gameData.title.trim().slice(0, 100),
    description: gameData.description.trim().slice(0, 2000),
    genre: gameData.genre,
    tags: gameData.tags,
    price: Number(gameData.price) || 0,
    coverUrl: gameData.coverUrl || "",
    screenshots: gameData.screenshots || [],
    fileUrl: gameData.fileUrl,
    version: gameData.version || "1.0.0",
    executables: gameData.executables || [],
    authorUid: user.uid,
    authorName: user.displayName || user.email?.split("@")[0] || "Unknown",
    downloads: 0,
    downloadsLast7d: 0,
    downloadsLast30d: 0,
    rating: 0,
    ratingCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const db = getDb();
  if (!db) {
    await loadLocalData();
    localGames.unshift({ id, ...payload });
    // Persist to session so refresh keeps it in this tab
    try {
      sessionStorage.setItem("nexus_local_games", JSON.stringify(localGames));
    } catch {}
    return { id, ...payload };
  }

  await setDoc(doc(db, "games", id), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id, ...payload };
}

export async function updateGame(id, updates) {
  const user = getCurrentUser();
  if (!user) throw new Error("Not signed in");

  const existing = await getGameById(id);
  if (!existing) throw new Error("Game not found");
  if (existing.authorUid !== user.uid) throw new Error("Only the author can edit this game");

  const allowed = [
    "title", "description", "genre", "tags", "price", "coverUrl",
    "screenshots", "fileUrl", "version", "executables",
  ];
  const clean = {};
  for (const k of allowed) {
    if (updates[k] !== undefined) clean[k] = updates[k];
  }
  clean.updatedAt = new Date().toISOString();

  const db = getDb();
  if (!db) {
    await loadLocalData();
    const idx = localGames.findIndex((g) => g.id === id);
    if (idx >= 0) localGames[idx] = { ...localGames[idx], ...clean };
    try {
      sessionStorage.setItem("nexus_local_games", JSON.stringify(localGames));
    } catch {}
    return { ...existing, ...clean };
  }

  await updateDoc(doc(db, "games", id), {
    ...clean,
    updatedAt: serverTimestamp(),
  });
  return { ...existing, ...clean };
}

export async function deleteGame(id) {
  const user = getCurrentUser();
  if (!user) throw new Error("Not signed in");
  const existing = await getGameById(id);
  if (!existing) throw new Error("Game not found");
  if (existing.authorUid !== user.uid) throw new Error("Only the author can delete this game");

  const db = getDb();
  if (!db) {
    await loadLocalData();
    localGames = localGames.filter((g) => g.id !== id);
    try {
      sessionStorage.setItem("nexus_local_games", JSON.stringify(localGames));
    } catch {}
    return;
  }
  await deleteDoc(doc(db, "games", id));
}

export async function incrementDownloads(id) {
  const db = getDb();
  if (!db) {
    await loadLocalData();
    const g = localGames.find((x) => x.id === id);
    if (g) {
      g.downloads = (g.downloads || 0) + 1;
      g.downloadsLast7d = (g.downloadsLast7d || 0) + 1;
      g.downloadsLast30d = (g.downloadsLast30d || 0) + 1;
    }
    return;
  }
  try {
    await updateDoc(doc(db, "games", id), {
      downloads: increment(1),
      downloadsLast7d: increment(1),
      downloadsLast30d: increment(1),
    });
  } catch (err) {
    console.warn("Could not increment downloads:", err.message);
  }
}

// ---------- Ratings ----------

function ratingDocId(gameId, uid) {
  return `${gameId}__${uid}`;
}

function emptyBreakdown() {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

function loadLocalRatings() {
  try {
    return JSON.parse(sessionStorage.getItem("adev_ratings") || "[]");
  } catch {
    return [];
  }
}

function saveLocalRatings(list) {
  try {
    sessionStorage.setItem("adev_ratings", JSON.stringify(list));
  } catch {}
}

function applyAggregates(game, ratings) {
  const breakdown = emptyBreakdown();
  let sum = 0;
  for (const r of ratings) {
    const s = Number(r.stars) || 0;
    if (s >= 1 && s <= 5) {
      breakdown[s] = (breakdown[s] || 0) + 1;
      sum += s;
    }
  }
  const count = ratings.length;
  game.ratingBreakdown = breakdown;
  game.ratingSum = sum;
  game.ratingCount = count;
  game.rating = count ? Math.round((sum / count) * 10) / 10 : 0;
}

export async function getRatingsForGame(gameId) {
  const db = getDb();
  if (!db) {
    return loadLocalRatings()
      .filter((r) => r.gameId === gameId)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }
  try {
    const q = query(collection(db, "ratings"), where("gameId", "==", gameId));
    const snap = await getDocs(q);
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => {
      const ta = a.updatedAt?.toDate ? a.updatedAt.toDate().getTime() : new Date(a.updatedAt || 0).getTime();
      const tb = b.updatedAt?.toDate ? b.updatedAt.toDate().getTime() : new Date(b.updatedAt || 0).getTime();
      return tb - ta;
    });
    return list;
  } catch (err) {
    console.warn("[data] ratings read failed:", err.message);
    return loadLocalRatings().filter((r) => r.gameId === gameId);
  }
}

// ---------- All ratings (for feed ranking) ----------

const RATINGS_CACHE_TTL_MS = 5 * 60 * 1000;
let _allRatingsCache = { at: 0, data: null };

/**
 * Fetch all ratings once, cached for 5 minutes.
 * Use this to feed `reviewsByGameId` into algorithms.js so feed ranking can
 * do recency-weighted ratings. Falls back to local storage in dev.
 *
 * By default only fetches reviews from the last 90 days to keep payloads
 * small. Pass { windowDays: 0 } for the entire collection, or
 * { windowDays: 30 } for tighter recency.
 */
export async function getAllRatings({ force = false, windowDays = 90 } = {}) {
  const now = Date.now();
  if (
    !force &&
    _allRatingsCache.data &&
    now - _allRatingsCache.at < RATINGS_CACHE_TTL_MS
  ) {
    return _allRatingsCache.data;
  }

  const db = getDb();
  if (!db) {
    const data = loadLocalRatings();
    _allRatingsCache = { at: now, data };
    return data;
  }

  try {
    let q;
    if (windowDays && windowDays > 0) {
      const cutoff = new Date(now - windowDays * 86400000);
      q = query(
        collection(db, "ratings"),
        where("updatedAt", ">=", cutoff)
      );
    } else {
      q = collection(db, "ratings");
    }

    const snap = await getDocs(q);
    const data = [];
    snap.forEach((d) => data.push({ id: d.id, ...d.data() }));
    _allRatingsCache = { at: now, data };
    return data;
  } catch (err) {
    console.warn("[data] getAllRatings failed, using local:", err.message);
    const data = loadLocalRatings();
    _allRatingsCache = { at: now, data };
    return data;
  }
}

/** Manually invalidate the ratings cache (call after submitRating / deleteMyRating). */
export function invalidateRatingsCache() {
  _allRatingsCache = { at: 0, data: null };
}

export async function getMyRating(gameId) {
  const user = getCurrentUser();
  if (!user) return null;
  const db = getDb();
  if (!db) {
    return loadLocalRatings().find((r) => r.gameId === gameId && r.uid === user.uid) || null;
  }
  try {
    const snap = await getDoc(doc(db, "ratings", ratingDocId(gameId, user.uid)));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch {
    return null;
  }
}

export async function submitRating(gameId, stars, review = "") {
  const user = getCurrentUser();
  if (!user) throw new Error("Sign in to rate this game");
  const n = Math.round(Number(stars));
  if (n < 1 || n > 5) throw new Error("Pick a rating from 1 to 5 stars");
  const text = String(review || "").trim().slice(0, 500);
  const displayName = user.displayName || user.email?.split("@")[0] || "Player";
  const now = new Date().toISOString();

  const db = getDb();
  if (!db) {
    await loadLocalData();
    const list = loadLocalRatings();
    const idx = list.findIndex((r) => r.gameId === gameId && r.uid === user.uid);
    const row = {
      id: ratingDocId(gameId, user.uid),
      gameId,
      uid: user.uid,
      displayName,
      stars: n,
      review: text,
      createdAt: idx >= 0 ? list[idx].createdAt : now,
      updatedAt: now,
    };
    if (idx >= 0) list[idx] = row;
    else list.unshift(row);
    saveLocalRatings(list);
    const g = localGames.find((x) => x.id === gameId);
    if (g) {
      applyAggregates(g, list.filter((r) => r.gameId === gameId));
      try {
        sessionStorage.setItem("nexus_local_games", JSON.stringify(localGames));
      } catch {}
    }
    invalidateRatingsCache();
    return row;
  }

  const rateRef = doc(db, "ratings", ratingDocId(gameId, user.uid));
  const gameRef = doc(db, "games", gameId);

  await runTransaction(db, async (tx) => {
    const [gameSnap, prevSnap] = await Promise.all([tx.get(gameRef), tx.get(rateRef)]);
    if (!gameSnap.exists()) throw new Error("Game not found");

    const data = gameSnap.data();
    let sum = Number(data.ratingSum) || 0;
    let count = Number(data.ratingCount) || 0;
    const breakdown = { ...emptyBreakdown(), ...(data.ratingBreakdown || {}) };
    for (const k of [1, 2, 3, 4, 5]) breakdown[k] = Number(breakdown[k]) || 0;

    const payload = {
      gameId,
      uid: user.uid,
      displayName,
      stars: n,
      review: text,
      updatedAt: serverTimestamp(),
    };

    if (prevSnap.exists()) {
      const old = Number(prevSnap.data().stars) || 0;
      if (old >= 1 && old <= 5) {
        breakdown[old] = Math.max(0, breakdown[old] - 1);
        sum -= old;
      }
      breakdown[n] += 1;
      sum += n;
      tx.update(rateRef, payload);
    } else {
      breakdown[n] += 1;
      sum += n;
      count += 1;
      tx.set(rateRef, { ...payload, createdAt: serverTimestamp() });
    }

    const avg = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
    tx.update(gameRef, {
      rating: avg,
      ratingCount: count,
      ratingSum: sum,
      ratingBreakdown: breakdown,
      updatedAt: serverTimestamp(),
    });
  });

  invalidateRatingsCache();

  return {
    gameId,
    uid: user.uid,
    displayName,
    stars: n,
    review: text,
    updatedAt: now,
  };
}

export async function deleteMyRating(gameId) {
  const user = getCurrentUser();
  if (!user) throw new Error("Sign in");

  const db = getDb();
  if (!db) {
    await loadLocalData();
    const list = loadLocalRatings().filter((r) => !(r.gameId === gameId && r.uid === user.uid));
    saveLocalRatings(list);
    const g = localGames.find((x) => x.id === gameId);
    if (g) applyAggregates(g, list.filter((r) => r.gameId === gameId));
    invalidateRatingsCache();
    return;
  }

  const rateRef = doc(db, "ratings", ratingDocId(gameId, user.uid));
  const gameRef = doc(db, "games", gameId);

  await runTransaction(db, async (tx) => {
    const [gameSnap, prevSnap] = await Promise.all([tx.get(gameRef), tx.get(rateRef)]);
    if (!prevSnap.exists()) return;
    const old = Number(prevSnap.data().stars) || 0;
    const data = gameSnap.exists() ? gameSnap.data() : {};
    let sum = Number(data.ratingSum) || 0;
    let count = Number(data.ratingCount) || 0;
    const breakdown = { ...emptyBreakdown(), ...(data.ratingBreakdown || {}) };
    if (old >= 1 && old <= 5) {
      breakdown[old] = Math.max(0, (Number(breakdown[old]) || 0) - 1);
      sum = Math.max(0, sum - old);
    }
    count = Math.max(0, count - 1);
    const avg = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
    tx.delete(rateRef);
    if (gameSnap.exists()) {
      tx.update(gameRef, {
        rating: avg,
        ratingCount: count,
        ratingSum: sum,
        ratingBreakdown: breakdown,
        updatedAt: serverTimestamp(),
      });
    }
  });

  invalidateRatingsCache();
}

// ---------- Users ----------

export async function getUserProfile(uid) {
  const db = getDb();
  if (!db) {
    await loadLocalData();
    return localUsers[uid] || {
      displayName: "Demo User",
      avatarUrl: "",
      bio: "",
      joinedAt: new Date().toISOString(),
      followerCount: 0,
    };
  }
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return null;
    return { uid, ...snap.data() };
  } catch {
    await loadLocalData();
    return localUsers[uid] || null;
  }
}

export async function ensureUserProfile(user) {
  if (!user) return;
  const db = getDb();
  if (!db) return;

  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: user.displayName || user.email?.split("@")[0] || "Player",
      avatarUrl: user.photoURL || "",
      bio: "",
      joinedAt: serverTimestamp(),
      followerCount: 0,
    });
  }
}

export async function updateUserDoc(uid, data) {
  const db = getDb();
  if (!db) return;
  await updateDoc(doc(db, "users", uid), data);
}

// ---------- Follows ----------

export async function getFollowing(uid) {
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await getDoc(doc(db, "follows", uid));
    if (!snap.exists()) return [];
    return snap.data().uids || [];
  } catch {
    return [];
  }
}

export async function followUser(targetUid) {
  const user = getCurrentUser();
  if (!user) throw new Error("Sign in to follow");
  if (user.uid === targetUid) throw new Error("Cannot follow yourself");

  const db = getDb();
  if (!db) throw new Error("Firebase not configured");

  const followRef = doc(db, "follows", user.uid);
  const snap = await getDoc(followRef);
  if (snap.exists()) {
    await updateDoc(followRef, { uids: arrayUnion(targetUid) });
  } else {
    await setDoc(followRef, { uids: [targetUid] });
  }
  // bump follower count
  try {
    await updateDoc(doc(db, "users", targetUid), { followerCount: increment(1) });
  } catch {}
}

export async function unfollowUser(targetUid) {
  const user = getCurrentUser();
  if (!user) throw new Error("Sign in");
  const db = getDb();
  if (!db) throw new Error("Firebase not configured");

  await updateDoc(doc(db, "follows", user.uid), { uids: arrayRemove(targetUid) });
  try {
    await updateDoc(doc(db, "users", targetUid), { followerCount: increment(-1) });
  } catch {}
}

export async function isFollowing(targetUid) {
  const user = getCurrentUser();
  if (!user) return false;
  const list = await getFollowing(user.uid);
  return list.includes(targetUid);
}

export { R2_BUCKET_URL };