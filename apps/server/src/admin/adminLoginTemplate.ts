export function renderLoginPage(errorMessage?: string): string {
  const safeError = errorMessage ? errorMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>JaMeet Admin Authentication</title>
  <style>
    :root {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --danger-bg: #fef2f2;
      --danger-text: #b91c1c;
      --danger-border: #fecaca;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
    }
    .login-container {
      width: 100%;
      max-width: 380px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 2rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .logo-header {
      font-size: 0.8125rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--primary);
      margin-bottom: 0.5rem;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      margin-bottom: 0.35rem;
    }
    p.subtitle {
      font-size: 0.8125rem;
      color: var(--text-muted);
      margin-bottom: 1.5rem;
      line-height: 1.4;
    }
    .error-alert {
      background: var(--danger-bg);
      color: var(--danger-text);
      border: 1px solid var(--danger-border);
      padding: 0.625rem 0.875rem;
      border-radius: 4px;
      font-size: 0.8125rem;
      margin-bottom: 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .form-group {
      margin-bottom: 1.25rem;
    }
    label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--text);
      margin-bottom: 0.35rem;
    }
    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    input[type="password"],
    input[type="text"] {
      width: 100%;
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font-size: 0.875rem;
      padding: 0.5rem 0.75rem;
      padding-right: 3.5rem;
      outline: none;
    }
    input[type="password"]:focus,
    input[type="text"]:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 1px var(--primary);
    }
    .toggle-visibility {
      position: absolute;
      right: 0.5rem;
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.75rem;
      cursor: pointer;
      padding: 0.2rem 0.4rem;
    }
    button[type="submit"] {
      width: 100%;
      background: var(--primary);
      color: #ffffff;
      border: none;
      border-radius: 4px;
      padding: 0.55rem 0.75rem;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
    }
    button[type="submit"]:hover {
      background: var(--primary-hover);
    }
    .footer-note {
      text-align: center;
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 1.25rem;
    }
  </style>
</head>
<body>
  <div class="login-container" id="admin-login-card">
    <div class="logo-header">JaMeet Server Admin</div>
    <h1>Authentication Required</h1>
    <p class="subtitle">Enter administrator secret to access user management.</p>

    ${safeError ? `<div class="error-alert" id="admin-login-error" role="alert"><span>⚠️</span><span>${safeError}</span></div>` : ''}

    <form method="POST" action="/admin/login" id="admin-login-form">
      <div class="form-group">
        <label for="admin-secret-input">Admin Secret (JAMEET_ADMIN_SECRET)</label>
        <div class="input-wrapper">
          <input type="password" id="admin-secret-input" name="secret" required placeholder="••••••••••••" autofocus autocomplete="current-password">
          <button type="button" class="toggle-visibility" id="toggle-secret-btn" aria-label="Toggle secret visibility">Show</button>
        </div>
      </div>
      <button type="submit" id="admin-login-submit">Authenticate</button>
    </form>

    <div class="footer-note">Server authenticated session • 12-hour expiration</div>
  </div>

  <script>
    const toggleBtn = document.getElementById('toggle-secret-btn');
    const secretInput = document.getElementById('admin-secret-input');
    if (toggleBtn && secretInput) {
      toggleBtn.addEventListener('click', () => {
        const isPassword = secretInput.type === 'password';
        secretInput.type = isPassword ? 'text' : 'password';
        toggleBtn.textContent = isPassword ? 'Hide' : 'Show';
      });
    }
  </script>
</body>
</html>`;
}

