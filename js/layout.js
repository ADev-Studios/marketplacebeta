/**
 * Shared page chrome HTML fragments for ADev Marketplace
 */
export function headerHtml() {
  return `
  <header class="site-header">
    <div class="header-inner">
      <a href="index.html" class="logo">
        <span class="logo-icon">◈</span>
        <span class="logo-text">ADev</span>
      </a>
      <nav class="main-nav">
        <a href="index.html">Home</a>
        <a href="store.html">Store</a>
        <a href="upload.html" id="nav-upload" class="hidden">Upload</a>
      </nav>
      <div class="header-actions">
        <div id="auth-area" class="auth-area">
          <button id="btn-login" class="btn btn-ghost">Sign In</button>
          <button id="btn-signup" class="btn btn-primary">Sign Up</button>
        </div>
        <div id="user-menu" class="user-menu hidden">
          <button id="user-avatar-btn" class="avatar-btn" title="Account">
            <img id="header-avatar" src="" alt="" class="avatar-img" />
            <span id="header-name" class="user-name"></span>
          </button>
          <div id="user-dropdown" class="dropdown hidden">
            <a href="profile.html">My Profile</a>
            <a href="settings.html">Settings</a>
            <button id="btn-logout" class="dropdown-item">Sign Out</button>
          </div>
        </div>
      </div>
      <button id="mobile-toggle" class="mobile-toggle" aria-label="Menu">
        <span></span><span></span><span></span>
      </button>
    </div>
  </header>`;
}

export function footerHtml() {
  return `
  <footer class="site-footer">
    <div class="footer-inner">
      <p>© 2026 ADev Marketplace. Built for indie creators.</p>
      <p class="footer-note">Static site · Firebase · Cloudflare R2 · Electron launcher</p>
    </div>
  </footer>`;
}

export function authModalHtml() {
  return `
  <div id="auth-modal" class="modal hidden" role="dialog" aria-modal="true">
    <div class="modal-backdrop" data-close-modal></div>
    <div class="modal-content">
      <button class="modal-close" data-close-modal aria-label="Close">×</button>
      <div class="modal-tabs">
        <button class="tab active" data-tab="login">Sign In</button>
        <button class="tab" data-tab="signup">Sign Up</button>
      </div>
      <form id="form-login" class="auth-form">
        <h2>Welcome back</h2>
        <label>Email <input type="email" name="email" required autocomplete="email" /></label>
        <label>Password <input type="password" name="password" required autocomplete="current-password" minlength="6" /></label>
        <p id="login-error" class="form-error hidden"></p>
        <button type="submit" class="btn btn-primary btn-block">Sign In</button>
        <div class="divider"><span>or</span></div>
        <button type="button" id="btn-google-login" class="btn btn-google btn-block">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continue with Google
        </button>
      </form>
      <form id="form-signup" class="auth-form hidden">
        <h2>Create account</h2>
        <label>Display name <input type="text" name="displayName" required maxlength="40" autocomplete="nickname" /></label>
        <label>Email <input type="email" name="email" required autocomplete="email" /></label>
        <label>Password <input type="password" name="password" required autocomplete="new-password" minlength="6" /></label>
        <p id="signup-error" class="form-error hidden"></p>
        <button type="submit" class="btn btn-primary btn-block">Sign Up</button>
        <div class="divider"><span>or</span></div>
        <button type="button" id="btn-google-signup" class="btn btn-google btn-block">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continue with Google
        </button>
      </form>
    </div>
  </div>
  <div id="toast-container" class="toast-container"></div>`;
}
