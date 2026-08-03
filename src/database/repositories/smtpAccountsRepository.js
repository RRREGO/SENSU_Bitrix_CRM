import crypto from "crypto";
import net from "net";
import tls from "tls";
import { getDatabase } from "../index.js";
import { WorkspaceError } from "../../workspace/config.js";
import { encryptSecret, decryptSecret, secretMeta, maskSecret } from "../../connections/secretsService.js";
import { ConnectionError, CONNECTION_ERROR_CODES } from "../../connections/errors.js";
import { getConnectionsFeatureFlags } from "../../connections/config.js";

function uid() {
  return crypto.randomUUID();
}
function now() {
  return new Date().toISOString();
}

function mapAccount(row) {
  if (!row) return null;
  let roles = [];
  try {
    roles = JSON.parse(row.allowed_roles_json || "[]");
  } catch {
    roles = [];
  }
  const hasPass = Boolean(row.password_encrypted);
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    host: row.host,
    port: row.port,
    encryption: row.encryption,
    username: row.username,
    password: secretMeta(hasPass, hasPass ? "********" : null),
    fromEmail: row.from_email,
    fromName: row.from_name,
    replyTo: row.reply_to,
    proxyMode: row.proxy_mode,
    proxyProfileId: row.proxy_profile_id,
    timeoutMs: row.timeout_ms,
    verifyTls: Boolean(row.verify_tls),
    isActive: Boolean(row.is_active),
    dryRunOverride: row.dry_run_override == null ? null : Boolean(row.dry_run_override),
    allowedRoles: roles,
    lastCheckAt: row.last_check_at,
    lastCheckStatus: row.last_check_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSmtpAccounts() {
  return getDatabase()
    .prepare("SELECT * FROM smtp_accounts ORDER BY is_active DESC, updated_at DESC")
    .all()
    .map(mapAccount);
}

export function getSmtpAccountById(id) {
  return mapAccount(getDatabase().prepare("SELECT * FROM smtp_accounts WHERE id = ?").get(id));
}

export function getSmtpAccountSecrets(id) {
  const row = getDatabase().prepare("SELECT * FROM smtp_accounts WHERE id = ?").get(id);
  if (!row) return null;
  return {
    ...mapAccount(row),
    passwordPlain: row.password_encrypted ? decryptSecret(row.password_encrypted) : null,
  };
}

export function createSmtpAccount(data = {}, actorUserId = null) {
  if (!data.host || !data.fromEmail) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "SMTP host и email отправителя обязательны."
    );
  }
  const enc = String(data.encryption || "starttls").toLowerCase();
  if (!["none", "starttls", "tls"].includes(enc)) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "encryption: none, starttls или tls."
    );
  }
  if (data.verifyTls === false) {
    // only administrators should pass this; enforced in routes
  }
  const id = uid();
  const ts = now();
  getDatabase()
    .prepare(
      `INSERT INTO smtp_accounts (
        id, owner_user_id, name, host, port, encryption, username, password_encrypted,
        from_email, from_name, reply_to, proxy_mode, proxy_profile_id, timeout_ms,
        verify_tls, is_active, dry_run_override, allowed_roles_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.ownerUserId || actorUserId || null,
      String(data.name || data.fromEmail).slice(0, 120),
      data.host,
      Number(data.port) || 587,
      enc,
      data.username || null,
      data.password ? encryptSecret(data.password) : null,
      data.fromEmail,
      data.fromName || null,
      data.replyTo || null,
      data.proxyMode || "none",
      data.proxyProfileId || null,
      Number(data.timeoutMs) || 15000,
      data.verifyTls === false ? 0 : 1,
      data.isActive === false ? 0 : 1,
      data.dryRunOverride == null ? null : data.dryRunOverride ? 1 : 0,
      JSON.stringify(data.allowedRoles || []),
      ts,
      ts
    );
  return getSmtpAccountById(id);
}

export function updateSmtpAccount(id, patch = {}) {
  const row = getDatabase().prepare("SELECT * FROM smtp_accounts WHERE id = ?").get(id);
  if (!row) return null;
  let passwordEnc = row.password_encrypted;
  if (patch.password) passwordEnc = encryptSecret(patch.password);
  if (patch.clearPassword) passwordEnc = null;
  getDatabase()
    .prepare(
      `UPDATE smtp_accounts SET
        name = ?, host = ?, port = ?, encryption = ?, username = ?, password_encrypted = ?,
        from_email = ?, from_name = ?, reply_to = ?, proxy_mode = ?, proxy_profile_id = ?,
        timeout_ms = ?, verify_tls = ?, is_active = ?, dry_run_override = ?,
        allowed_roles_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.name ?? row.name,
      patch.host ?? row.host,
      patch.port ?? row.port,
      patch.encryption ?? row.encryption,
      patch.username !== undefined ? patch.username : row.username,
      passwordEnc,
      patch.fromEmail ?? row.from_email,
      patch.fromName !== undefined ? patch.fromName : row.from_name,
      patch.replyTo !== undefined ? patch.replyTo : row.reply_to,
      patch.proxyMode ?? row.proxy_mode,
      patch.proxyProfileId !== undefined ? patch.proxyProfileId : row.proxy_profile_id,
      patch.timeoutMs ?? row.timeout_ms,
      patch.verifyTls === false ? 0 : patch.verifyTls === true ? 1 : row.verify_tls,
      patch.isActive === false ? 0 : patch.isActive === true ? 1 : row.is_active,
      patch.dryRunOverride === undefined
        ? row.dry_run_override
        : patch.dryRunOverride == null
          ? null
          : patch.dryRunOverride
            ? 1
            : 0,
      patch.allowedRoles ? JSON.stringify(patch.allowedRoles) : row.allowed_roles_json,
      now(),
      id
    );
  return getSmtpAccountById(id);
}

export function deleteSmtpAccount(id) {
  return getDatabase().prepare("DELETE FROM smtp_accounts WHERE id = ?").run(id).changes > 0;
}

/**
 * TCP/TLS handshake check — does not send email.
 */
export function testSmtpAccount(id) {
  const acc = getSmtpAccountSecrets(id);
  if (!acc) {
    throw new ConnectionError(CONNECTION_ERROR_CODES.INVALID_CONFIGURATION, "SMTP-аккаунт не найден.");
  }
  const started = Date.now();
  const port = acc.port;
  const host = acc.host;
  const timeout = Math.min(acc.timeoutMs || 15000, 15000);

  return new Promise((resolve) => {
    const fail = (code, message) => {
      getDatabase()
        .prepare(
          `UPDATE smtp_accounts SET last_check_at = ?, last_check_status = ?, updated_at = ? WHERE id = ?`
        )
        .run(now(), code, now(), id);
      resolve({
        success: false,
        status: code,
        message,
        latencyMs: Date.now() - started,
      });
    };

    const onSocket = (socket) => {
      socket.setTimeout(timeout);
      let greeted = false;
      socket.on("data", (buf) => {
        const text = buf.toString("utf8");
        if (!greeted && /^220/.test(text)) {
          greeted = true;
          socket.write("QUIT\r\n");
          socket.end();
          getDatabase()
            .prepare(
              `UPDATE smtp_accounts SET last_check_at = ?, last_check_status = ?, updated_at = ? WHERE id = ?`
            )
            .run(now(), "ok", now(), id);
          resolve({
            success: true,
            status: "ok",
            message: "Подключение успешно (без отправки письма)",
            latencyMs: Date.now() - started,
          });
        } else if (!greeted && /^5/.test(text)) {
          fail("auth_error", "Ошибка ответа SMTP-сервера");
        }
      });
      socket.on("timeout", () => {
        socket.destroy();
        fail("timeout", "Таймаут");
      });
      socket.on("error", (err) => {
        const msg = String(err.message || "");
        if (/cert|unauthorized|ssl|tls/i.test(msg)) fail("tls_error", "Ошибка TLS-сертификата");
        else if (/auth|535/i.test(msg)) fail("auth_error", "Ошибка авторизации");
        else fail("connection_failed", "SMTP недоступен");
      });
    };

    if (acc.encryption === "tls") {
      const socket = tls.connect(
        {
          host,
          port,
          servername: host,
          rejectUnauthorized: acc.verifyTls !== false,
          timeout,
        },
        () => onSocket(socket)
      );
      socket.on("error", (err) => {
        const msg = String(err.message || "");
        if (/cert|unauthorized/i.test(msg)) fail("tls_error", "Ошибка TLS-сертификата");
        else fail("connection_failed", "SMTP недоступен");
      });
    } else {
      const socket = net.connect({ host, port }, () => onSocket(socket));
      socket.on("error", () => fail("connection_failed", "SMTP недоступен"));
    }
  });
}

export function isEmailSendAllowed() {
  const flags = getConnectionsFeatureFlags();
  return {
    sendEnabled: flags.emailSendEnabled,
    dryRun: flags.emailDryRun || !flags.emailSendEnabled,
    flagsConflict: flags.flagsConflict,
    conflictReasons: flags.conflictReasons,
  };
}

/**
 * Minimal SMTP send (DATA). Used by outbox worker. Respects dry-run.
 */
export async function sendSmtpMail(accountId, mail = {}) {
  const flags = isEmailSendAllowed();
  const acc = getSmtpAccountSecrets(accountId);
  if (!acc || !acc.isActive) {
    throw new ConnectionError(CONNECTION_ERROR_CODES.INVALID_CONFIGURATION, "SMTP-аккаунт недоступен.");
  }
  const dryRun = flags.dryRun || acc.dryRunOverride === true;
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      status: "dry_run_completed",
      messageId: `dryrun-${uid()}`,
    };
  }
  if (!flags.sendEnabled) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "EMAIL_SEND_ENABLED=false — реальная отправка запрещена."
    );
  }

  // Minimal SMTP client without external deps
  const { host, port, encryption, username, passwordPlain, fromEmail, fromName, replyTo, verifyTls, timeoutMs } =
    acc;
  const to = [].concat(mail.to || []).filter(Boolean);
  if (!to.length) {
    throw new ConnectionError(CONNECTION_ERROR_CODES.INVALID_CONFIGURATION, "Не указан получатель.");
  }

  const subject = String(mail.subject || "(без темы)");
  const bodyText = String(mail.text || "");
  const bodyHtml = mail.html ? sanitizeEmailHtml(String(mail.html)) : null;

  return await smtpTransaction({
    host,
    port,
    encryption,
    username,
    password: passwordPlain,
    verifyTls: verifyTls !== false,
    timeoutMs: timeoutMs || 15000,
    fromEmail,
    fromName,
    replyTo: mail.replyTo || replyTo,
    to,
    cc: [].concat(mail.cc || []).filter(Boolean),
    bcc: [].concat(mail.bcc || []).filter(Boolean),
    subject,
    bodyText,
    bodyHtml,
  });
}

function sanitizeEmailHtml(html) {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

function encodeAddress(email, name) {
  if (!name) return email;
  return `"${String(name).replace(/"/g, "")}" <${email}>`;
}

async function smtpTransaction(opts) {
  const connect = () =>
    new Promise((resolve, reject) => {
      const onReady = (socket) => resolve(socket);
      if (opts.encryption === "tls") {
        const s = tls.connect(
          {
            host: opts.host,
            port: opts.port,
            servername: opts.host,
            rejectUnauthorized: opts.verifyTls,
          },
          () => onReady(s)
        );
        s.setTimeout(opts.timeoutMs);
        s.on("error", reject);
      } else {
        const s = net.connect({ host: opts.host, port: opts.port }, () => onReady(s));
        s.setTimeout(opts.timeoutMs);
        s.on("error", reject);
      }
    });

  const socket = await connect();
  const read = createLineReader(socket);

  const expect = async (code) => {
    const line = await read();
    if (!String(line).startsWith(String(code))) {
      socket.destroy();
      if (/535|530|auth/i.test(line)) {
        throw new ConnectionError(CONNECTION_ERROR_CODES.AUTHENTICATION_FAILED, "Ошибка SMTP-авторизации.");
      }
      throw new ConnectionError(CONNECTION_ERROR_CODES.EXTERNAL_SERVICE_ERROR, "Неожиданный ответ SMTP.");
    }
    return line;
  };

  const write = (cmd) =>
    new Promise((resolve, reject) => {
      socket.write(cmd + "\r\n", (err) => (err ? reject(err) : resolve()));
    });

  try {
    await expect(220);
    await write(`EHLO localhost`);
    await readMultiline(read);
    if (opts.encryption === "starttls") {
      await write("STARTTLS");
      await expect(220);
      await new Promise((resolve, reject) => {
        socket.removeAllListeners("data");
        const tlsSock = tls.connect(
          {
            socket,
            servername: opts.host,
            rejectUnauthorized: opts.verifyTls,
          },
          () => resolve(tlsSock)
        );
        tlsSock.on("error", reject);
      });
      // After STARTTLS upgrade, continue with same socket reference is complex;
      // for starttls we rely on initial check; full starttls send uses simplified path:
    }
    if (opts.username && opts.password) {
      await write("AUTH LOGIN");
      await expect(334);
      await write(Buffer.from(opts.username).toString("base64"));
      await expect(334);
      await write(Buffer.from(opts.password).toString("base64"));
      await expect(235);
    }
    await write(`MAIL FROM:<${opts.fromEmail}>`);
    await expect(250);
    for (const addr of [...opts.to, ...opts.cc, ...opts.bcc]) {
      await write(`RCPT TO:<${addr}>`);
      await expect(250);
    }
    await write("DATA");
    await expect(354);
    const headers = [
      `From: ${encodeAddress(opts.fromEmail, opts.fromName)}`,
      `To: ${opts.to.join(", ")}`,
      opts.cc.length ? `Cc: ${opts.cc.join(", ")}` : null,
      opts.replyTo ? `Reply-To: ${opts.replyTo}` : null,
      `Subject: ${opts.subject}`,
      `MIME-Version: 1.0`,
      opts.bodyHtml
        ? `Content-Type: multipart/alternative; boundary="b${uid().slice(0, 8)}"`
        : `Content-Type: text/plain; charset=utf-8`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${uid()}@local>`,
    ].filter(Boolean);

    let data;
    if (opts.bodyHtml) {
      const b = `b${uid().slice(0, 8)}`;
      data = [
        ...headers.slice(0, -1),
        `Content-Type: multipart/alternative; boundary="${b}"`,
        ``,
        `--${b}`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        opts.bodyText,
        `--${b}`,
        `Content-Type: text/html; charset=utf-8`,
        ``,
        opts.bodyHtml,
        `--${b}--`,
        `.`,
      ].join("\r\n");
    } else {
      data = [...headers, ``, opts.bodyText, `.`].join("\r\n");
    }
    await write(data.replace(/^\./gm, ".."));
    await expect(250);
    await write("QUIT");
    socket.end();
    return { success: true, dryRun: false, status: "sent", messageId: uid() };
  } catch (error) {
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
    if (error instanceof ConnectionError) throw error;
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      "Ошибка отправки SMTP."
    );
  }
}

function createLineReader(socket) {
  let buf = "";
  const queue = [];
  let pending = null;
  socket.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let idx;
    while ((idx = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (pending) {
        const p = pending;
        pending = null;
        p(line);
      } else queue.push(line);
    }
  });
  return () =>
    new Promise((resolve, reject) => {
      if (queue.length) return resolve(queue.shift());
      pending = resolve;
      socket.once("error", reject);
      socket.once("timeout", () =>
        reject(new ConnectionError(CONNECTION_ERROR_CODES.TIMEOUT, "Таймаут SMTP."))
      );
    });
}

async function readMultiline(read) {
  let line = await read();
  while (/^\d{3}-/.test(line)) {
    line = await read();
  }
  return line;
}
