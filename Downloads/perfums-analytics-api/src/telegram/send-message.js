export async function sendTelegramMessage({ botToken, chatId, text }) {
  if (!botToken || chatId == null) return;
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!response.ok) throw new Error(`Telegram sendMessage: HTTP ${response.status}`);
}
