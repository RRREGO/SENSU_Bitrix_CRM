/**
 * Small HTML pages for the OAuth consent screen. No inline scripts or styles:
 * the application CSP allows only same-origin stylesheets.
 */

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/oauth.css">
</head>
<body>
  <main class="card">
    <h1>${escapeHtml(title)}</h1>
    ${body}
  </main>
</body>
</html>`;
}

export function renderMessagePage({ title, message, status = "Ошибка" }) {
  return page(title, `<p>${escapeHtml(message)}</p><p class="hint">${escapeHtml(status)}</p>`);
}

export function renderLoginPage({ username = "", error = "" }) {
  return page(
    "Вход для подключения MCP",
    `${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <p class="hint">Чат запрашивает доступ к CRM от вашего имени. Запись в Bitrix24 всё равно потребует отдельного подтверждения.</p>
    <form method="post" action="/oauth/login">
      <label class="field">Логин
        <input name="username" autocomplete="username" required maxlength="80" value="${escapeHtml(username)}">
      </label>
      <label class="field">Пароль
        <input name="password" type="password" autocomplete="current-password" required maxlength="200">
      </label>
      <button class="primary" type="submit">Войти</button>
    </form>`
  );
}

export function renderConsentPage({ clientName, displayName, redirectHost }) {
  return page(
    "Разрешить доступ",
    `<p><strong>${escapeHtml(clientName)}</strong> хочет работать с CRM от имени ${escapeHtml(displayName)}.</p>
    <ul>
      <li>Читать данные, которые вам и так доступны в этом приложении.</li>
      <li>Готовить изменения. Они не попадут в Bitrix24, пока вы явно не подтвердите их в чате.</li>
      <li>Сохранять подключение, чтобы не входить заново каждый час.</li>
    </ul>
    <p class="hint">Код авторизации вернётся на ${escapeHtml(redirectHost)}.</p>
    <form method="post" action="/oauth/consent">
      <div class="actions">
        <button class="primary" type="submit" name="decision" value="approve">Разрешить</button>
        <button class="secondary" type="submit" name="decision" value="deny">Отклонить</button>
      </div>
    </form>`
  );
}
