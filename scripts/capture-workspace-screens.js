/**
 * Capture workspace UX screenshots (requires server on :3005).
 * node scripts/capture-workspace-screens.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "docs", "screenshots", "workspace-ux");
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.APP_URL || "http://127.0.0.1:3005";

async function api(page, method, urlPath, body) {
  return page.evaluate(
    async (method, urlPath, body) => {
      const res = await fetch(urlPath, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      return res.json();
    },
    method,
    urlPath,
    body || null
  );
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--window-size=1280,800"],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();

  await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 60000 });

  // Hide login gate if present (local_only)
  await page.evaluate(() => {
    document.getElementById("loginGate")?.classList.add("hidden");
    document.getElementById("appRoot")?.classList.remove("hidden");
  });
  await page.waitForSelector("#sidebarProjects", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1500));

  // Seed data
  const project = await api(page, "POST", "/projects", {
    name: "SENSU CRM",
    description: "Работа с лидами, сделками, отчётами и регламентами SENSU.",
    instruction: "Учитывай регламенты SENSU.",
    colorKey: "violet",
  });
  const projectId = project.project?.id;
  if (projectId) {
    await api(page, "POST", `/chats`, {
      title: "Анализ просроченных сделок",
      projectId,
    });
    await api(page, "POST", `/chats`, {
      title: "Обязательные поля лида",
      projectId,
    });
  }
  await api(page, "POST", "/chats", { title: "Настройка Wazzup" });

  await page.reload({ waitUntil: "networkidle2" });
  await page.evaluate(() => {
    document.getElementById("loginGate")?.classList.add("hidden");
    document.getElementById("appRoot")?.classList.remove("hidden");
  });
  await page.waitForSelector("#sidebarProjects", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1200));

  await page.screenshot({ path: path.join(outDir, "01-sidebar-projects-chats.png"), fullPage: false });

  // Open project overview
  const projectBtn = await page.$('[data-project-id]');
  if (projectBtn) {
    await projectBtn.click();
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({ path: path.join(outDir, "02-project-overview.png"), fullPage: false });
  }

  // Open a chat
  const chatBtn = await page.$('#sidebarChats [data-chat-id]');
  if (chatBtn) {
    await chatBtn.click();
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: path.join(outDir, "03-open-chat.png"), fullPage: false });
  }

  // Chats list / filters visible
  await page.screenshot({ path: path.join(outDir, "04-chats-list.png"), fullPage: false });

  // Empty project state - create empty project
  const empty = await api(page, "POST", "/projects", {
    name: "Пустой проект",
    description: "Для empty state",
    colorKey: "slate",
  });
  await page.reload({ waitUntil: "networkidle2" });
  await page.evaluate(() => {
    document.getElementById("loginGate")?.classList.add("hidden");
    document.getElementById("appRoot")?.classList.remove("hidden");
  });
  await new Promise((r) => setTimeout(r, 1200));
  const emptyBtn = await page.$(`[data-project-id="${empty.project?.id}"]`);
  if (emptyBtn) {
    await emptyBtn.click();
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: path.join(outDir, "05-empty-project.png"), fullPage: false });
  }

  // Mobile
  await page.setViewport({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle2" });
  await page.evaluate(() => {
    document.getElementById("loginGate")?.classList.add("hidden");
    document.getElementById("appRoot")?.classList.remove("hidden");
  });
  await new Promise((r) => setTimeout(r, 1000));
  await page.click("#mobileSidebarToggle").catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(outDir, "06-mobile.png"), fullPage: false });

  await browser.close();
  console.log("Screenshots saved to", outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
