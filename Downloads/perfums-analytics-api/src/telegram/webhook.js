import { Router } from "express";
import { getChannelDocument } from "./channel-document.js";

export function createTelegramWebhookRouter({ webhookSecret, onDocument } = {}) {
  const router = Router();

  router.post("/", (req, res) => {
    if (
      webhookSecret &&
      req.get("x-telegram-bot-api-secret-token") !== webhookSecret
    ) {
      return res.status(401).json({ status: "error", message: "Невірний webhook secret" });
    }

    const file = getChannelDocument(req.body);

    if (!file) {
      return res.status(200).json({ status: "ignored" });
    }

    console.log("Telegram: отримано Excel-файл із каналу", file);

    if (onDocument) {
      void Promise.resolve(onDocument(file)).catch((error) => {
        console.error("Telegram: помилка обробки Excel-файла", {
          fileName: file.fileName,
          message: error.message,
        });
      });
    }

    return res.status(200).json({ status: "accepted" });
  });

  return router;
}
