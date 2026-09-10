# ADev Marketplace

Static multi-page indie game marketplace. Dark theme, plain HTML/CSS/JS, Firebase Auth + Firestore, Cloudflare R2 for game files, Electron launcher deep links.

**Stack:** HTML pages (no SPA hash router) · GitHub Pages · Firebase · R2 · Electron (launcher separate)

---

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Home — featured, trending, recently added, "because you viewed" |
| `store.html` | Full catalog + search + filters |
| `game.html?id=` | Game detail, screenshots, install / deeplink |
| `profile.html` | Your profile & uploaded games |
| `user.html?id=` | Public developer page + Follow |
| `settings.html` | Profile, password, delete account |
| `upload.html` | Publish a game (`?edit=` to edit) |

---

## Quick start (local)

```bash
npx serve .
# or: python -m http.server 8080
```

Open the site. Without a real Firebase config the app runs in **offline mode** using `data/games.json` and `data/users.json`.

---

## Project structure

```
├── index.html, store.html, game.html, profile.html,
│   user.html, settings.html, upload.html
├── css/style.css
├── js/
│   ├── shared.js       # Auth UI, toasts, initShared()
│   ├── auth.js         # Firebase Auth (email + Google)
│   ├── data.js         # Firestore CRUD + local fallback
│   ├── algorithms.js   # Search, recommendations, trending, BYV
│   ├── render.js       # Page views
│   └── upload.js       # Submit / edit form
├── data/
│   ├── games.json
│   └── users.json
└── README.md
```

---

## 1. Firebase setup

1. Create a project at Firebase Console.
2. Enable Authentication → Email/Password + Google.
3. Create a Firestore database.
4. Register a Web app and copy the config.

### Plug in the config

Open `js/auth.js` and replace the `FIREBASE_CONFIG` object with your real keys.

### Firestore collections

- `users/{uid}` — displayName, avatarUrl, bio, joinedAt, followerCount
- `games/{id}` — title, description, genre, tags, price, coverUrl, screenshots, fileUrl, version, executables, authorUid, authorName, downloads, rating, createdAt
- `follows/{uid}` — uids array of followed users

Anyone can read games. Only the author can update/delete their game. Users can create games.

---

## 2. Cloudflare R2

Set `R2_BUCKET_URL` in `js/data.js` to your public bucket URL (e.g. `https://pub-xxx.r2.dev`). Upload game zips there and paste the full URL when publishing.

---

## 3. GitHub Pages

Push this repo, enable Pages from the `main` branch root. No build step required.

---

## 4. Electron launcher deep links

Protocol: `mylauncher`

```
mylauncher://install/{gameId}?url={fileUrl}&v={version}
```

Browser: **Copy Launcher URL** on the game page.  
Electron: **Install with Launcher** via IPC / `electronAPI.installGame`.

Register with `app.setAsDefaultProtocolClient("mylauncher")`.

---

## Algorithms

- **Search:** fuzzy; title weighted highest
- **Recommendations:** Jaccard tag similarity, top 6
- **Trending:** downloads_7d*2 + downloads_30d*0.5 + rating*10, top 10
- **Because you viewed:** last 10 viewed IDs in localStorage

---

## Design

Background `#0f0f0f` · Cards `#1a1a2e` · Accent `#00d4ff` · Responsive grid · Hover glow · Skeletons

## License

MIT
