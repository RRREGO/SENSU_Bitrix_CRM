/**
 * Защита от повторной отправки одинакового сообщения.
 */

import { getDatabase } from "../database/index.js";
import { CommunicationError, getCommunicationsConfig } from "./config.js";

export function findRecentDuplicate({ contactId, channel, bodyHash, excludeDraftId = null }) {
  const cfg = getCommunicationsConfig();
  const since = new Date(Date.now() - cfg.duplicateWindowMinutes * 60_000).toISOString();
  const rows = getDatabase()
    .prepare(
      `SELECT o.id, o.draft_id, o.sent_at, d.contact_id, d.channel
       FROM outbound_messages o
       JOIN message_drafts d ON d.id = o.draft_id
       WHERE o.body_hash = ?
         AND d.channel = ?
         AND IFNULL(d.contact_id, '') = ?
         AND o.status IN ('sent', 'verification_required', 'delivered')
         AND IFNULL(o.sent_at, o.created_at) >= ?
       ORDER BY o.created_at DESC
       LIMIT 5`
    )
    .all(bodyHash, channel, contactId != null ? String(contactId) : "", since);

  return rows.filter((r) => !excludeDraftId || r.draft_id !== excludeDraftId);
}

export function assertNoDuplicate(opts) {
  if (opts.forceDuplicateReason && String(opts.forceDuplicateReason).trim()) {
    return { forced: true, reason: String(opts.forceDuplicateReason).trim() };
  }
  const hits = findRecentDuplicate(opts);
  if (hits.length) {
    throw new CommunicationError(
      "DUPLICATE_MESSAGE_DETECTED",
      "Такое сообщение уже отправлялось этому получателю недавно.",
      { outboundMessageId: hits[0].id, windowMinutes: getCommunicationsConfig().duplicateWindowMinutes }
    );
  }
  return { forced: false };
}
