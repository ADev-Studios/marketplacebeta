/**
 * Game submission & edit form
 */
import { createGame, updateGame, getGameById, R2_BUCKET_URL } from "./data.js";
import { GENRES } from "./algorithms.js";
import { getCurrentUser } from "./auth.js";
import { toast } from "./shared.js";

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function renderUpload(editId = null) {
  const user = getCurrentUser();
  const app = document.getElementById("app");

  if (!user) {
    app.innerHTML = `
      <div class="empty-state">
        <div class="icon">🔒</div>
        <h2>Sign in to upload</h2>
        <p>Create an account or sign in to publish games.</p>
      </div>`;
    return;
  }

  let existing = null;
  if (editId) {
    app.innerHTML = `<div class="loading-screen"><div class="spinner"></div></div>`;
    try {
      existing = await getGameById(editId);
      if (!existing) throw new Error("Game not found");
      if (existing.authorUid !== user.uid) throw new Error("You can only edit your own games");
    } catch (err) {
      app.innerHTML = `<div class="empty-state"><p class="form-error">${escapeHtml(err.message)}</p></div>`;
      return;
    }
  }

  const isEdit = !!existing;
  const shots = existing?.screenshots?.length
    ? existing.screenshots
    : [""];
  const execs = existing?.executables?.length
    ? existing.executables
    : [{ name: "", url: "" }];

  app.innerHTML = `
    <div class="page-header">
      <h1>${isEdit ? "Edit game" : "Upload a game"}</h1>
      <p>${isEdit ? "Update details, version, or files" : "Share your creation on ADev Marketplace"}</p>
    </div>
    <form class="form-card" id="upload-form" novalidate>
      <div class="form-group">
        <label for="title">Title *</label>
        <input id="title" name="title" maxlength="100" required value="${escapeHtml(existing?.title || "")}" />
        <p class="form-hint">Max 100 characters</p>
      </div>
      <div class="form-group">
        <label for="description">Description *</label>
        <textarea id="description" name="description" maxlength="2000" required>${escapeHtml(existing?.description || "")}</textarea>
        <p class="form-hint">Max 2000 characters</p>
      </div>
      <div class="form-group">
        <label for="genre">Genre *</label>
        <select id="genre" name="genre" required>
          <option value="">Select genre</option>
          ${GENRES.map(
            (g) =>
              `<option value="${g}" ${existing?.genre === g ? "selected" : ""}>${g}</option>`
          ).join("")}
        </select>
      </div>
      <div class="form-group">
        <label for="tags">Tags * (comma-separated)</label>
        <input id="tags" name="tags" required placeholder="pixel-art, multiplayer, roguelike"
          value="${escapeHtml((existing?.tags || []).join(", "))}" />
        <p class="form-hint">At least one tag</p>
      </div>
      <div class="form-group">
        <label for="price">Price (USD)</label>
        <input id="price" name="price" type="number" min="0" step="0.01" value="${existing?.price ?? 0}" />
        <p class="form-hint">0 = Free</p>
      </div>
      <div class="form-group">
        <label for="coverUrl">Cover image URL *</label>
        <input id="coverUrl" name="coverUrl" type="url" required placeholder="https://…"
          value="${escapeHtml(existing?.coverUrl || "")}" />
      </div>
      <div class="form-group">
        <label>Screenshots (up to 5 URLs)</label>
        <div class="screenshot-list" id="shot-list">
          ${shots
            .map(
              (url, i) => `
            <div class="screenshot-row">
              <input type="url" name="screenshot" placeholder="https://…" value="${escapeHtml(url)}" />
              ${i > 0 ? `<button type="button" class="btn btn-ghost btn-sm btn-remove-shot">Remove</button>` : ""}
            </div>`
            )
            .join("")}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-add-shot" style="margin-top:0.5rem">+ Add screenshot</button>
      </div>
      <div class="form-group">
        <label for="fileUrl">Main game file URL * (R2 / zip preferred)</label>
        <input id="fileUrl" name="fileUrl" type="url" required
          placeholder="${R2_BUCKET_URL}/games/your-game.zip"
          value="${escapeHtml(existing?.fileUrl || "")}" />
        <p class="form-hint">Upload the .zip to Cloudflare R2 first, then paste the public URL here.</p>
      </div>
      <div class="form-group">
        <label for="version">Version *</label>
        <input id="version" name="version" required placeholder="1.0.0"
          value="${escapeHtml(existing?.version || "1.0.0")}" />
      </div>
      <div class="form-group">
        <label>Additional executables / platforms (optional)</label>
        <div id="exec-list">
          ${execs
            .map(
              (ex, i) => `
            <div class="screenshot-row exec-row" style="margin-bottom:0.4rem">
              <input type="text" name="execName" placeholder="Label (e.g. Windows)" value="${escapeHtml(ex.name || "")}" style="flex:0.4" />
              <input type="url" name="execUrl" placeholder="https://…/game.zip" value="${escapeHtml(ex.url || "")}" style="flex:1" />
              ${i > 0 ? `<button type="button" class="btn btn-ghost btn-sm btn-remove-exec">Remove</button>` : ""}
            </div>`
            )
            .join("")}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-add-exec" style="margin-top:0.5rem">+ Add executable</button>
      </div>
      <p id="upload-error" class="form-error hidden"></p>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" id="btn-submit">${isEdit ? "Save changes" : "Publish game"}</button>
        <a href="${isEdit ? "game.html?id=" + editId : "profile.html"}" class="btn btn-ghost">Cancel</a>
      </div>
    </form>`;

  // Dynamic screenshot rows
  const shotList = document.getElementById("shot-list");
  document.getElementById("btn-add-shot").addEventListener("click", () => {
    if (shotList.querySelectorAll(".screenshot-row").length >= 5) {
      toast("Maximum 5 screenshots", "error");
      return;
    }
    const row = document.createElement("div");
    row.className = "screenshot-row";
    row.innerHTML = `<input type="url" name="screenshot" placeholder="https://…" />
      <button type="button" class="btn btn-ghost btn-sm btn-remove-shot">Remove</button>`;
    shotList.appendChild(row);
  });
  shotList.addEventListener("click", (e) => {
    if (e.target.classList.contains("btn-remove-shot")) {
      e.target.closest(".screenshot-row").remove();
    }
  });

  // Dynamic executable rows
  const execList = document.getElementById("exec-list");
  document.getElementById("btn-add-exec").addEventListener("click", () => {
    const row = document.createElement("div");
    row.className = "screenshot-row exec-row";
    row.style.marginBottom = "0.4rem";
    row.innerHTML = `<input type="text" name="execName" placeholder="Label" style="flex:0.4" />
      <input type="url" name="execUrl" placeholder="https://…/file.zip" style="flex:1" />
      <button type="button" class="btn btn-ghost btn-sm btn-remove-exec">Remove</button>`;
    execList.appendChild(row);
  });
  execList.addEventListener("click", (e) => {
    if (e.target.classList.contains("btn-remove-exec")) {
      e.target.closest(".exec-row").remove();
    }
  });

  document.getElementById("upload-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("upload-error");
    errEl.classList.add("hidden");
    const btn = document.getElementById("btn-submit");
    btn.disabled = true;

    const fd = new FormData(e.target);
    const title = fd.get("title").toString().trim();
    const description = fd.get("description").toString().trim();
    const genre = fd.get("genre").toString();
    const tagsRaw = fd.get("tags").toString();
    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const price = parseFloat(fd.get("price")) || 0;
    const coverUrl = fd.get("coverUrl").toString().trim();
    const fileUrl = fd.get("fileUrl").toString().trim();
    const version = fd.get("version").toString().trim();

    const screenshots = [...e.target.querySelectorAll('input[name="screenshot"]')]
      .map((i) => i.value.trim())
      .filter(Boolean)
      .slice(0, 5);

    const execNames = [...e.target.querySelectorAll('input[name="execName"]')];
    const execUrls = [...e.target.querySelectorAll('input[name="execUrl"]')];
    const executables = execNames
      .map((n, i) => ({
        name: n.value.trim(),
        url: execUrls[i]?.value.trim() || "",
      }))
      .filter((x) => x.name && x.url);

    // Validation
    const errors = [];
    if (!title || title.length > 100) errors.push("Title is required (max 100 chars)");
    if (!description || description.length > 2000) errors.push("Description is required (max 2000 chars)");
    if (!genre) errors.push("Select a genre");
    if (!tags.length) errors.push("At least one tag is required");
    if (!coverUrl) errors.push("Cover image URL is required");
    if (!fileUrl) errors.push("Game file URL is required");
    if (!version) errors.push("Version is required");

    if (errors.length) {
      errEl.textContent = errors.join(". ");
      errEl.classList.remove("hidden");
      btn.disabled = false;
      return;
    }

    const payload = {
      title,
      description,
      genre,
      tags,
      price,
      coverUrl,
      screenshots,
      fileUrl,
      version,
      executables,
    };

    try {
      if (isEdit) {
        await updateGame(editId, payload);
        toast("Game updated", "success");
        window.location.href = `game.html?id=${editId}`;
      } else {
        const created = await createGame(payload);
        toast("Game published!", "success");
        window.location.href = `game.html?id=${created.id}`;
      }
    } catch (err) {
      errEl.textContent = err.message || "Upload failed";
      errEl.classList.remove("hidden");
      btn.disabled = false;
    }
  });
}
