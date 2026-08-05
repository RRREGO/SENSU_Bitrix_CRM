/**
 * Unit tests for activity_add normalization and confirmation reply classification.
 */
import assert from "assert";
import {
  normalizeActivityAddParams,
  defaultActivityDeadline,
} from "../src/actions/timelineActions.js";
import { classifyConfirmationReply } from "../src/chat/confirmationIntent.js";

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log("OK:", msg);
}

function testNormalizeAliases() {
  const { fields, useTodo } = normalizeActivityAddParams({
    OWNERTYPEID: 2,
    OWNERID: 2398,
    SUBJECT: "Проверить статус",
    RESPONSIBLEID: 380,
    TYPE_ID: 1,
  });
  ok(fields.OWNER_TYPE_ID === 2, "OWNER_TYPE_ID from OWNERTYPEID");
  ok(fields.OWNER_ID === 2398, "OWNER_ID from OWNERID");
  ok(fields.RESPONSIBLE_ID === 380, "RESPONSIBLE_ID from RESPONSIBLEID");
  ok(fields.SUBJECT === "Проверить статус", "SUBJECT");
  ok(useTodo === true, "todo path for TYPE_ID=1 without COMMUNICATIONS");
}

function testNormalizeWrappedFields() {
  const { fields, useTodo } = normalizeActivityAddParams({
    fields: {
      OWNER_TYPE_ID: 2,
      OWNER_ID: 100,
      SUBJECT: "Звонок",
      TYPE_ID: 2,
      COMMUNICATIONS: [{ VALUE: "+7700", ENTITY_ID: 5, ENTITY_TYPE_ID: 3 }],
    },
  });
  ok(useTodo === false, "classic path for call with COMMUNICATIONS");
  ok(fields.TYPE_ID === 2, "TYPE_ID kept");
}

function testNormalizeRequiresOwner() {
  let threw = false;
  try {
    normalizeActivityAddParams({ SUBJECT: "x" });
  } catch {
    threw = true;
  }
  ok(threw, "requires OWNER_TYPE_ID and OWNER_ID");
}

function testDefaultDeadline() {
  const d = defaultActivityDeadline(new Date("2026-08-03T10:00:00"));
  ok(typeof d === "string" && d.includes("T"), "ISO deadline");
}

function testConfirmReplies() {
  ok(classifyConfirmationReply("Да") === "confirm", "Да → confirm");
  ok(classifyConfirmationReply("создавай!") === "confirm", "создавай → confirm");
  ok(classifyConfirmationReply("отмена") === "cancel", "отмена → cancel");
  ok(classifyConfirmationReply("не нужно") === null, "не нужно не cancel (уточнение срока)");
  ok(classifyConfirmationReply("да, без срока") === null, "длинный ответ → LLM");
}

testNormalizeAliases();
testNormalizeWrappedFields();
testNormalizeRequiresOwner();
testDefaultDeadline();
testConfirmReplies();
console.log("\nAll activity_add tests passed.");
