/**
 * Live communications certification driver (disabled by default).
 * Secrets are never accepted via CLI — use env only.
 *
 * npm run certify:communications -- --provider wazzup --channel whatsapp --transport-id <id> --test-contact-id <id> --steps connection,webhook --confirm
 */
import { parseArgs } from "util";

const ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.COMMUNICATION_LIVE_CERTIFY || ""));

function fail(msg) {
  console.error(`[certify] ${msg}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      provider: { type: "string", default: "wazzup" },
      channel: { type: "string", default: "whatsapp" },
      "transport-id": { type: "string" },
      "test-contact-id": { type: "string" },
      steps: { type: "string", default: "connection" },
      confirm: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`Usage:
  COMMUNICATION_LIVE_CERTIFY=true npm run certify:communications -- \\
    --provider wazzup --channel whatsapp --transport-id <id> \\
    --test-contact-id <id> --steps connection,webhook --confirm

Env required for live send steps: COMMUNICATION_LIVE_TEST_ENABLED=true,
COMMUNICATIONS_SEND_ENABLED=true, COMMUNICATIONS_DRY_RUN=false.
Secrets: WAZZUP_API_KEY / WAZZUP_WEBHOOK_SECRET via .env only.`);
    process.exit(0);
  }

  if (!ENABLED) {
    fail(
      "Live certification disabled. Set COMMUNICATION_LIVE_CERTIFY=true to enable (unit default: off)."
    );
  }
  if (!values.confirm) {
    fail("Refusing to run without --confirm");
  }

  const { openDatabase } = await import("../src/database/index.js");
  openDatabase();
  const { startCertification, runCertificationStep } = await import(
    "../src/communications/certification/certificationService.js"
  );
  const { CERTIFICATION_TEST_MARKER } = await import("../src/communications/config.js");

  const contactId = values["test-contact-id"] || process.env.COMMUNICATION_TEST_CONTACT_ID;
  if (!contactId) fail("Provide --test-contact-id or COMMUNICATION_TEST_CONTACT_ID");

  const cert = startCertification({
    provider: values.provider,
    channel: values.channel,
    transportId: values["transport-id"] || null,
  });
  console.log(`[certify] started certification ${cert.id} fingerprint=${cert.accountFingerprint}`);

  const steps = String(values.steps)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const step of steps) {
    console.log(`[certify] running step ${step}…`);
    try {
      const result = await runCertificationStep(cert.id, step, {
        contactId,
        contact: {
          id: contactId,
          name: CERTIFICATION_TEST_MARKER,
          statusValue: "warmup",
          channel: values.channel,
        },
      });
      console.log(`[certify] ${step} ok`, result.result);
    } catch (error) {
      console.error(`[certify] CRITICAL stop on ${step}:`, error.code || error.message);
      process.exit(1);
    }
  }

  console.log("[certify] done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
