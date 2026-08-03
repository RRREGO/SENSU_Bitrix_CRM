/**
 * SMTP outbound provider for Communications Hub outbox worker.
 */

import {
  listSmtpAccounts,
  sendSmtpMail,
  isEmailSendAllowed,
} from "../../database/repositories/smtpAccountsRepository.js";
import { CommunicationError } from "../config.js";

export function createSmtpProvider() {
  return {
    name: "smtp",

    async sendMessage(params = {}) {
      const flags = isEmailSendAllowed();
      const accounts = listSmtpAccounts().filter((a) => a.isActive);
      const accountId = params.channelId || params.accountId || accounts[0]?.id;
      if (!accountId) {
        throw new CommunicationError(
          "CHANNEL_NOT_CONFIGURED",
          "Нет активного SMTP-аккаунта."
        );
      }

      const to = params.chatId || params.phone || params.email || params.to;
      if (!to || !String(to).includes("@")) {
        throw new CommunicationError(
          "MESSAGE_RECIPIENT_NOT_FOUND",
          "Укажите корректный email получателя."
        );
      }

      const result = await sendSmtpMail(accountId, {
        to: [String(to)],
        cc: params.cc,
        bcc: params.bcc,
        subject: params.subject || params.templateId || "Сообщение из CRM Assistant",
        text: params.text || params.body || "",
        html: params.html || null,
        replyTo: params.replyTo,
      });

      return {
        providerMessageId: result.messageId,
        status: result.dryRun ? "dry_run" : "sent",
        dryRun: Boolean(result.dryRun || flags.dryRun),
        raw: { status: result.status },
      };
    },
  };
}
