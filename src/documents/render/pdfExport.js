import fs from "fs/promises";

let puppeteerModule = null;

async function loadPuppeteer() {
  if (puppeteerModule !== null) return puppeteerModule;
  try {
    puppeteerModule = await import("puppeteer");
    return puppeteerModule;
  } catch {
    puppeteerModule = false;
    return false;
  }
}

/**
 * Экспорт HTML в PDF через Puppeteer.
 */
export async function exportHtmlToPdf(html, outputPath) {
  const puppeteer = await loadPuppeteer();
  if (!puppeteer) {
    throw new Error("Puppeteer is not installed");
  }

  const browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
    });
  } finally {
    await browser.close();
  }

  await fs.access(outputPath);
}
