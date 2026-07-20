import express from "express";
import { crm_context_get } from "../clientContext/crmContextGet.js";
import { crm_context_summary } from "../clientContext/crmContextSummary.js";
import { meeting_protocol_generate } from "../clientContext/meetingProtocolService.js";
import {
  client_message_draft,
  recommend_next_client_action,
} from "../clientContext/clientActions.js";
import { ClientContextError } from "../clientContext/config.js";
import {
  createMeetingTranscript,
  getMeetingTranscript,
  listMeetingTranscripts,
} from "../database/repositories/meetingTranscriptsRepository.js";
import {
  getMeetingProtocol,
  updateMeetingProtocol,
  listMeetingProtocols,
  listProtocolTemplates,
  upsertProjectProtocolTemplate,
  ensureDefaultProtocolTemplate,
} from "../database/repositories/meetingProtocolsRepository.js";
import { prepareAction } from "../safety/executor.js";
import { redactObject } from "../safety/redact.js";

function sendError(res, error) {
  if (error instanceof ClientContextError) {
    const status =
      error.code === "CRM_CONTEXT_ENTITY_NOT_FOUND" ||
      error.code === "TRANSCRIPT_NOT_FOUND"
        ? 404
        : 400;
    return res.status(status).json(error.toJSON());
  }
  return res.status(500).json({
    success: false,
    error: { code: "CRM_CONTEXT_SOURCE_UNAVAILABLE", message: error.message },
  });
}

export function createClientContextRouter() {
  const router = express.Router();
  ensureDefaultProtocolTemplate();

  router.get("/crm/context/:entityType/:entityId", async (req, res) => {
    try {
      const include = req.query.include
        ? String(req.query.include).split(",").map((s) => s.trim())
        : undefined;
      const result = await crm_context_get({
        entityType: req.params.entityType,
        entityId: req.params.entityId,
        include,
        mode: req.query.mode || "standard",
        dateFrom: req.query.dateFrom || null,
        dateTo: req.query.dateTo || null,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/crm/context/summary", async (req, res) => {
    try {
      const result = await crm_context_summary(req.body || {});
      res.json({ ok: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/meeting-transcripts", (req, res) => {
    try {
      const transcript = createMeetingTranscript(req.body || {});
      res.json({
        success: true,
        transcript: {
          ...transcript,
          contentText: undefined,
          preview: String(transcript.contentText || "").slice(0, 200),
        },
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/meeting-transcripts/:id", (req, res) => {
    const transcript = getMeetingTranscript(req.params.id);
    if (!transcript) {
      return res.status(404).json({
        success: false,
        error: { code: "TRANSCRIPT_NOT_FOUND", message: "Транскрипт не найден." },
      });
    }
    res.json({ success: true, transcript });
  });

  router.get("/meeting-transcripts", (req, res) => {
    res.json({
      success: true,
      transcripts: listMeetingTranscripts({
        chatId: req.query.chatId,
        entityType: req.query.entityType,
        entityId: req.query.entityId,
        limit: req.query.limit,
      }).map((t) => ({
        ...t,
        contentText: undefined,
        sizeChars: t.sizeChars,
      })),
    });
  });

  router.post("/meeting-protocols/generate", async (req, res) => {
    try {
      const result = await meeting_protocol_generate(req.body || {});
      res.json({ ok: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/meeting-protocols/:id", (req, res) => {
    const protocol = getMeetingProtocol(req.params.id);
    if (!protocol) {
      return res.status(404).json({
        success: false,
        error: { code: "TRANSCRIPT_NOT_FOUND", message: "Протокол не найден." },
      });
    }
    res.json({ success: true, protocol });
  });

  router.get("/meeting-protocols", (req, res) => {
    res.json({
      success: true,
      protocols: listMeetingProtocols({
        chatId: req.query.chatId,
        entityType: req.query.entityType,
        entityId: req.query.entityId,
        limit: req.query.limit,
      }),
    });
  });

  router.patch("/meeting-protocols/:id", (req, res) => {
    const protocol = updateMeetingProtocol(req.params.id, req.body || {});
    if (!protocol) {
      return res.status(404).json({
        success: false,
        error: { code: "TRANSCRIPT_NOT_FOUND", message: "Протокол не найден." },
      });
    }
    res.json({ success: true, protocol });
  });

  router.post("/meeting-protocols/:id/save-to-crm/prepare", async (req, res) => {
    try {
      const protocol = getMeetingProtocol(req.params.id);
      if (!protocol) {
        return res.status(404).json({
          success: false,
          error: { code: "TRANSCRIPT_NOT_FOUND", message: "Протокол не найден." },
        });
      }
      if (!protocol.crmEntityType || !protocol.crmEntityId) {
        return res.status(400).json({
          success: false,
          error: {
            code: "CRM_CONTEXT_ENTITY_NOT_FOUND",
            message: "У протокола нет привязки к CRM-сущности.",
          },
        });
      }

      const comment = [
        `Протокол встречи: ${protocol.title}`,
        "",
        protocol.protocolText,
      ].join("\n");

      // Never put full transcript in operation audit — only protocol text preview
      const result = await prepareAction(
        "timeline_comment_add",
        {
          entityType: protocol.crmEntityType,
          entityId: Number(protocol.crmEntityId),
          comment,
        },
        {
          source: req.body?.source || "meeting_protocol",
          sessionId: req.body?.sessionId || null,
          chatId: protocol.chatId || req.body?.chatId || null,
        }
      );

      // Strip potential huge texts from public response later; prepare already redacts
      res.json({
        ok: true,
        ...result,
        preview: {
          ...(result.preview || {}),
          protocolId: protocol.id,
          entityType: protocol.crmEntityType,
          entityId: protocol.crmEntityId,
          commentPreview: comment.slice(0, 400),
          commentLength: comment.length,
          note: "Комментарий будет добавлен в таймлайн после подтверждения. Операция не обратима.",
        },
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/meeting-protocol-templates", (req, res) => {
    ensureDefaultProtocolTemplate();
    res.json({
      success: true,
      templates: listProtocolTemplates({ projectId: req.query.projectId || null }),
    });
  });

  router.put("/projects/:id/meeting-protocol-template", (req, res) => {
    try {
      const template = upsertProjectProtocolTemplate(req.params.id, req.body || {});
      res.json({ success: true, template });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/client-message/draft", async (req, res) => {
    try {
      const result = await client_message_draft(req.body || {});
      res.json({ ok: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/client-next-action/recommend", async (req, res) => {
    try {
      const result = await recommend_next_client_action(req.body || {});
      res.json({ ok: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
