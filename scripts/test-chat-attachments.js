/**
 * Тесты разбора вложений чата (xlsx / csv / txt).
 * Запуск: npm run test:chat-attachments
 */
import XLSX from "xlsx";
import {
  parseChatAttachments,
  parseChatAttachment,
  buildLlmUserMessage,
  catalogHintForAttachments,
  visibleUserText,
  FILES_ONLY_PREFIX,
} from "../src/chat/attachments.js";

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`);
  }
}

function toBase64(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return buf.toString("base64");
}

function makeXlsx(rows, sheetName = "Лист1") {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function caught(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

async function main() {
  console.log("\n[test:chat-attachments]\n");

  const txt = parseChatAttachment({
    filename: "names.txt",
    mimeType: "text/plain",
    contentBase64: toBase64("Иванов Иван\nПетров Пётр"),
  });
  assert(txt.extractedText.includes("Иванов Иван") && txt.rowCount === 2, "1. TXT читается");

  const csv = parseChatAttachment({
    filename: "companies.csv",
    contentBase64: toBase64("Компания,Город\nООО Ромашка,Алматы"),
  });
  assert(csv.extractedText.includes("ООО Ромашка"), "2. CSV читается");

  const xlsxBuf = makeXlsx([
    ["Компания", "ИНН"],
    ["Sensu", "123"],
    ["Twiga", "456"],
  ]);
  const xlsx = parseChatAttachment({
    filename: "list.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    contentBase64: xlsxBuf.toString("base64"),
  });
  assert(xlsx.extractedText.includes("Sensu") && xlsx.extractedText.includes("Twiga"), "3. XLSX читается");
  assert(xlsx.rowCount >= 2, "4. XLSX считает строки");

  const pdfErr = caught(() =>
    parseChatAttachment({ filename: "doc.pdf", contentBase64: toBase64("aaa") })
  );
  assert(pdfErr?.code === "ATTACHMENT_TYPE_NOT_SUPPORTED", "5. PDF отклоняется");

  const exeErr = caught(() =>
    parseChatAttachment({ filename: "run.exe", contentBase64: toBase64("aaa") })
  );
  assert(exeErr?.code === "ATTACHMENT_TYPE_NOT_SUPPORTED", "6. EXE отклоняется");

  const emptyErr = caught(() =>
    parseChatAttachment({ filename: "empty.txt", contentBase64: toBase64("   \n  ") })
  );
  assert(emptyErr?.code === "ATTACHMENT_EMPTY", "7. Пустой текст отклоняется");

  const tooMany = caught(() =>
    parseChatAttachments(
      Array.from({ length: 6 }, (_, i) => ({
        filename: `f${i}.txt`,
        contentBase64: toBase64("Иванов"),
      }))
    )
  );
  assert(tooMany?.code === "ATTACHMENT_LIMIT_REACHED", "8. Лимит количества файлов");

  const parsed = parseChatAttachments([
    { filename: "a.txt", contentBase64: toBase64("Иванов Иван") },
  ]);
  const llm = buildLlmUserMessage("Проверь, кто уже есть в Bitrix", parsed);
  assert(llm.includes("Иванов Иван") && llm.includes("Проверь, кто уже есть"), "9. Текст уходит в LLM-сообщение");
  assert(
    visibleUserText(llm, { attachments: [{ filename: "a.txt" }], displayText: "Проверь, кто уже есть в Bitrix" }) ===
      "Проверь, кто уже есть в Bitrix",
    "10. В пузыре чата виден только комментарий, не вся таблица"
  );

  const filesOnly = buildLlmUserMessage("", parsed);
  assert(filesOnly.startsWith(FILES_ONLY_PREFIX), "11. Файл без текста допускается");
  assert(visibleUserText(filesOnly, { attachments: [{ filename: "a.txt" }] }) === "", "12. Пузырь без комментария — только чип файла");

  const hint = catalogHintForAttachments("проверь", parsed);
  assert(/контакт/.test(hint) && /компани/.test(hint), "13. Подсказка каталога для сверки CRM");

  const huge = "x".repeat(3_000_000);
  const hugeErr = caught(() =>
    parseChatAttachment({
      filename: "big.txt",
      contentBase64: Buffer.from(huge, "utf8").toString("base64"),
    })
  );
  assert(hugeErr?.code === "ATTACHMENT_TOO_LARGE", "14. Слишком большой файл отклоняется");

  console.log(`\n[test:chat-attachments] passed=${passed} failed=${failed}\n`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
