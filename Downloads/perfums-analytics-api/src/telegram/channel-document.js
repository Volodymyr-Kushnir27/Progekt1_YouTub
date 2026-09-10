const EXCEL_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

export function getChannelDocument(update) {
  const post = update?.channel_post;
  const document = post?.document;

  if (!post || !document) return null;

  const fileName = document.file_name || "";
  const isExcel =
    EXCEL_MIME_TYPES.has(document.mime_type) || /\.xlsx?$/i.test(fileName);

  if (!isExcel) return null;

  return {
    updateId: update.update_id ?? null,
    channelId: post.chat?.id ?? null,
    channelTitle: post.chat?.title ?? null,
    messageId: post.message_id ?? null,
    messageDate: post.date
      ? new Date(post.date * 1000).toISOString()
      : null,
    fileId: document.file_id,
    fileUniqueId: document.file_unique_id ?? null,
    fileName,
    mimeType: document.mime_type ?? null,
    fileSize: document.file_size ?? null,
  };
}
