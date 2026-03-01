type TelegramApiResponse<T> =
  | {
      ok: true;
      result: T;
    }
  | {
      ok: false;
      error_code: number;
      description: string;
    };

type TelegramUpdate = {
  update_id: number;
  message?: {
    from?: {
      username?: string;
    };
    chat?: {
      id: number;
      username?: string;
    };
    text?: string;
  };
};

export type TelegramConnection = {
  chatId: string;
  username: string | null;
};

async function telegramRequest<T>(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${method}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(`Telegram API HTTP ${response.status}`);
  }

  const json = (await response.json()) as TelegramApiResponse<T>;

  if (!json.ok) {
    throw new Error(json.description);
  }

  return json.result;
}

export async function getLatestUpdateOffset(botToken: string): Promise<number> {
  const updates = await telegramRequest<TelegramUpdate[]>(
    botToken,
    "getUpdates",
    {
      timeout: 0,
      allowed_updates: ["message"],
    },
  );

  if (updates.length === 0) {
    return 0;
  }

  const maxUpdateId = updates.reduce(
    (acc, item) => Math.max(acc, item.update_id),
    0,
  );
  return maxUpdateId + 1;
}

export async function waitForChatId(
  botToken: string,
  offset: number,
  timeoutSeconds = 120,
): Promise<TelegramConnection> {
  const startedAt = Date.now();
  let currentOffset = offset;

  while ((Date.now() - startedAt) / 1000 < timeoutSeconds) {
    const remainingSeconds =
      timeoutSeconds - Math.floor((Date.now() - startedAt) / 1000);
    const pollTimeout = Math.max(1, Math.min(25, remainingSeconds));

    const updates = await telegramRequest<TelegramUpdate[]>(
      botToken,
      "getUpdates",
      {
        offset: currentOffset,
        timeout: pollTimeout,
        allowed_updates: ["message"],
      },
    );

    for (const update of updates) {
      currentOffset = Math.max(currentOffset, update.update_id + 1);

      if (update.message?.chat?.id !== undefined) {
        return {
          chatId: String(update.message.chat.id),
          username:
            update.message.from?.username ??
            update.message.chat.username ??
            null,
        };
      }
    }
  }

  throw new Error(
    "Timed out waiting for Telegram message. Send a message to your bot and try again.",
  );
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  await telegramRequest(botToken, "sendMessage", {
    chat_id: chatId,
    text,
  });
}
