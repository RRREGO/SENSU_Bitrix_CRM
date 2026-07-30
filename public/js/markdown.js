import { escapeHtml } from "./utils.js";

const SAFE_LINK_PROTOCOL = /^(https?:|mailto:)/i;

function sanitizeUrl(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed || !SAFE_LINK_PROTOCOL.test(trimmed)) return null;
  return escapeHtml(trimmed);
}

function renderInline(text) {
  let out = escapeHtml(text);

  out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  out = out.replace(/(?<!_)_([^_\n]+)_(?!_)/g, "<em>$1</em>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return `${label} (${escapeHtml(url)})`;
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  return out;
}

function flushList(listType, listItems, html) {
  if (!listItems.length) return;
  const tag = listType === "ol" ? "ol" : "ul";
  html.push(
    `<${tag}>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`
  );
  listItems.length = 0;
}

function flushParagraph(para, html) {
  if (!para.length) return;
  const content = para
    .map((line, index) => {
      const inline = renderInline(line);
      return index < para.length - 1 ? `${inline}<br>` : inline;
    })
    .join("");
  html.push(`<p>${content}</p>`);
  para.length = 0;
}

/**
 * Безопасный subset Markdown для сообщений чата.
 */
export function renderMarkdown(source) {
  if (source == null) return "";
  const text = String(source).replace(/\r\n/g, "\n");
  if (!text.trim()) return "";

  const html = [];
  const lines = text.split("\n");
  let inCode = false;
  const codeLines = [];
  let listType = null;
  const listItems = [];
  const para = [];

  for (const line of lines) {
    if (line.startsWith("```")) {
      flushList(listType, listItems, html);
      listType = null;
      flushParagraph(para, html);
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines.length = 0;
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headerMatch) {
      flushList(listType, listItems, html);
      listType = null;
      flushParagraph(para, html);
      const level = headerMatch[1].length;
      html.push(`<h${level}>${renderInline(headerMatch[2])}</h${level}>`);
      continue;
    }

    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (ulMatch || olMatch) {
      flushParagraph(para, html);
      const type = olMatch ? "ol" : "ul";
      const content = (ulMatch || olMatch)[1];
      if (listType && listType !== type) {
        flushList(listType, listItems, html);
      }
      listType = type;
      listItems.push(content);
      continue;
    }

    if (line.trim() === "") {
      flushList(listType, listItems, html);
      listType = null;
      flushParagraph(para, html);
      continue;
    }

    flushList(listType, listItems, html);
    listType = null;
    para.push(line);
  }

  flushList(listType, listItems, html);
  if (inCode && codeLines.length) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushParagraph(para, html);

  return html.join("");
}
