/**
 * Live smoke-тест исходящего сообщения.
 * По умолчанию ВЫКЛЮЧЕН. Не создавать тестового клиента.
 *
 * Требования:
 *   COMMUNICATION_LIVE_TEST_ENABLED=true
 *   COMMUNICATION_LIVE_DRAFT_ID=<uuid существующего draft>
 *   COMMUNICATION_LIVE_CHANNEL=<channel>
 *   COMMUNICATION_LIVE_CONFIRMATION_PHRASE=<фраза из prepare preview>
 *
 * Запуск вручную:
 *   node scripts/smoke-test-communication-live.js
 */
import "dotenv/config";

const enabled = /^(1|true|yes)$/i.test(String(process.env.COMMUNICATION_LIVE_TEST_ENABLED || ""));
const draftId = process.env.COMMUNICATION_LIVE_DRAFT_ID || "";
const channel = process.env.COMMUNICATION_LIVE_CHANNEL || "";
const phrase = process.env.COMMUNICATION_LIVE_CONFIRMATION_PHRASE || "";

if (!enabled) {
  console.log("COMMUNICATION_LIVE_TEST_ENABLED=false — выход без отправки.");
  process.exit(0);
}

if (!draftId || !channel || !phrase) {
  console.error(
    "Нужны COMMUNICATION_LIVE_DRAFT_ID, COMMUNICATION_LIVE_CHANNEL и COMMUNICATION_LIVE_CONFIRMATION_PHRASE."
  );
  process.exit(1);
}

const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3005";

async function main() {
  console.log("=== LIVE communication smoke (manual) ===");
  console.log(`draftId=${draftId} channel=${channel}`);
  console.log("Повторный просмотр: GET draft…");
  const draftRes = await fetch(`${base}/message-drafts/${draftId}`);
  const draftJson = await draftRes.json();
  console.log(JSON.stringify(draftJson.draft || draftJson, null, 2));

  console.log("Prepare…");
  const prepRes = await fetch(`${base}/message-drafts/${draftId}/send/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const prepared = await prepRes.json();
  if (prepared.success === false) {
    console.error(prepared);
    process.exit(1);
  }
  console.log("Preview:", JSON.stringify(prepared.preview, null, 2));
  console.log("Ожидаемая фраза:", prepared.preview?.requiredConfirmationPhrase);
  console.log("Введена фраза из env (должна совпасть).");

  if (
    prepared.preview?.requiredConfirmationPhrase &&
    String(phrase).trim().toUpperCase() !==
      String(prepared.preview.requiredConfirmationPhrase).trim().toUpperCase()
  ) {
    console.error("Фраза из env не совпадает с preview. Отправка отменена.");
    process.exit(1);
  }

  console.log("Commit…");
  const commitRes = await fetch(`${base}/bitrix/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      confirmationId: prepared.confirmationId,
      confirmationPhrase: phrase,
    }),
  });
  const committed = await commitRes.json();
  console.log(JSON.stringify(committed, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
