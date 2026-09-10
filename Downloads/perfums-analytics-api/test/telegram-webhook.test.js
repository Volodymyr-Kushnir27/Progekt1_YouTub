import assert from "node:assert/strict";
import test from "node:test";
import { getChannelDocument } from "../src/telegram/channel-document.js";

test("reads an Excel document from channel_post", () => {
  const result = getChannelDocument({
    update_id: 100,
    channel_post: {
      message_id: 25,
      date: 1785830400,
      chat: { id: -1001234567890, title: "Звіти", type: "channel" },
      document: {
        file_id: "telegram-file-id",
        file_unique_id: "unique-id",
        file_name: "ML.xlsx",
        mime_type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        file_size: 12345,
      },
    },
  });

  assert.equal(result.fileName, "ML.xlsx");
  assert.equal(result.fileId, "telegram-file-id");
  assert.equal(result.channelId, -1001234567890);
  assert.equal(result.messageId, 25);
});

test("ignores regular messages and non-Excel documents", () => {
  assert.equal(getChannelDocument({ message: { text: "hello" } }), null);
  assert.equal(
    getChannelDocument({
      channel_post: {
        document: { file_id: "x", file_name: "report.pdf" },
      },
    }),
    null,
  );
});
