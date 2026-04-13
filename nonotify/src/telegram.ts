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

type TelegramChat = {
  id: number;
  username?: string;
};

type TelegramMessage = {
  message_id: number;
  from?: {
    username?: string;
  };
  chat?: TelegramChat;
  text?: string;
};

type TelegramCallbackQuery = {
  id: string;
  from?: {
    username?: string;
  };
  message?: TelegramMessage;
  data?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type TelegramConnection = {
  chatId: string;
  username: string | null;
};

export type TelegramInlineOption = {
  label: string;
  callbackData: string;
};

export type TelegramChoiceMessage = {
  messageId: number;
};

export type TelegramCallbackSelection = {
  callbackQueryId: string;
  data: string;
};

type TelegramWaitOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

type TelegramWaiter<T> = {
  match: (update: TelegramUpdate) => T | undefined;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const allowedUpdateTypes = ["message", "callback_query"];
const updateStreams = new Map<string, TelegramUpdateStream>();
const shortPollIntervalMs = 1_000;

async function telegramRequest<T>(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(
      `https://api.telegram.org/bot${botToken}/${method}`,
      {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );
  } catch (error) {
    throw new Error(formatTelegramFetchError(method, error));
  }

  if (!response.ok) {
    throw new Error(`Telegram ${method} failed with HTTP ${response.status}.`);
  }

  const json = (await response.json()) as TelegramApiResponse<T>;

  if (!json.ok) {
    if (
      method === "getUpdates" &&
      /webhook/i.test(json.description) &&
      /active|set/i.test(json.description)
    ) {
      throw new Error(
        "This Telegram bot has an active webhook. `nnt ask` requires getUpdates, so disable the webhook or use a separate bot token for nonotify."
      );
    }

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
      allowed_updates: allowedUpdateTypes,
    }
  );

  if (updates.length === 0) {
    return 0;
  }

  const maxUpdateId = updates.reduce(
    (acc, item) => Math.max(acc, item.update_id),
    0
  );
  return maxUpdateId + 1;
}

export async function waitForChatId(
  botToken: string,
  offset: number,
  timeoutSeconds = 120,
  signal?: AbortSignal
): Promise<TelegramConnection> {
  const stream = getTelegramUpdateStream(botToken, offset);

  try {
    return await stream.waitFor(
      (update) => {
        if (update.message?.chat?.id === undefined) {
          return undefined;
        }

        return {
          chatId: String(update.message.chat.id),
          username:
            update.message.from?.username ??
            update.message.chat.username ??
            null,
        };
      },
      {
        timeoutMs: timeoutSeconds * 1000,
        signal,
      }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "Timed out waiting") {
      throw new Error(
        "Timed out waiting for Telegram message. Send a message to your bot and try again."
      );
    }

    throw error;
  }
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<void> {
  await telegramRequest(botToken, "sendMessage", {
    chat_id: chatId,
    text,
  });
}

export async function sendTelegramChoiceMessage(
  botToken: string,
  chatId: string,
  text: string,
  options: readonly TelegramInlineOption[]
): Promise<TelegramChoiceMessage> {
  const message = await telegramRequest<TelegramMessage>(
    botToken,
    "sendMessage",
    {
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: options.map((option) => [
          {
            text: option.label,
            callback_data: option.callbackData,
          },
        ]),
      },
    }
  );

  return {
    messageId: message.message_id,
  };
}

export async function waitForTelegramCallback(
  botToken: string,
  input: {
    chatId: string;
    messageId: number;
    callbackData: readonly string[];
    offset?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<TelegramCallbackSelection> {
  const stream = getTelegramUpdateStream(botToken, input.offset);
  const allowedCallbackData = new Set(input.callbackData);

  return stream.waitFor(
    (update) => {
      const callback = update.callback_query;

      if (
        !callback?.message ||
        String(callback.message.chat?.id) !== input.chatId ||
        callback.message.message_id !== input.messageId ||
        typeof callback.data !== "string" ||
        !allowedCallbackData.has(callback.data)
      ) {
        return undefined;
      }

      return {
        callbackQueryId: callback.id,
        data: callback.data,
      };
    },
    {
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    }
  );
}

export async function answerTelegramCallbackQuery(
  botToken: string,
  callbackQueryId: string
): Promise<void> {
  await telegramRequest(botToken, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
  });
}

export async function clearTelegramInlineKeyboard(
  botToken: string,
  chatId: string,
  messageId: number
): Promise<void> {
  try {
    await telegramRequest(botToken, "editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [],
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      /message is not modified/i.test(error.message)
    ) {
      return;
    }

    throw error;
  }
}

export async function markTelegramSelectedOption(
  botToken: string,
  chatId: string,
  messageId: number,
  options: readonly TelegramInlineOption[],
  selectedCallbackData: string
): Promise<void> {
  try {
    await telegramRequest(botToken, "editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: options.map((option) => [
          {
            text:
              option.callbackData === selectedCallbackData
                ? `✅ ${option.label}`
                : option.label,
            callback_data: option.callbackData,
          },
        ]),
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      /message is not modified/i.test(error.message)
    ) {
      return;
    }

    throw error;
  }
}

function getTelegramUpdateStream(
  botToken: string,
  offset = 0
): TelegramUpdateStream {
  const existing = updateStreams.get(botToken);

  if (existing) {
    existing.setMinimumOffset(offset);
    return existing;
  }

  const stream = new TelegramUpdateStream(botToken, offset);
  updateStreams.set(botToken, stream);
  return stream;
}

class TelegramUpdateStream {
  private currentOffset: number;
  private readonly waiters = new Set<TelegramWaiter<unknown>>();
  private pollPromise: Promise<void> | null = null;
  private pollAbortController: AbortController | null = null;

  constructor(private readonly botToken: string, initialOffset: number) {
    this.currentOffset = initialOffset;
  }

  setMinimumOffset(offset: number): void {
    this.currentOffset = Math.max(this.currentOffset, offset);
  }

  async waitFor<T>(
    match: (update: TelegramUpdate) => T | undefined,
    options: TelegramWaitOptions = {}
  ): Promise<T> {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    return new Promise<T>((resolve, reject) => {
      const abortListener = () => {
        unregister();
        reject(
          options.signal?.reason ?? new DOMException("Aborted", "AbortError")
        );
      };
      const timeout =
        typeof options.timeoutMs === "number"
          ? setTimeout(() => {
              unregister();
              reject(new Error("Timed out waiting"));
            }, options.timeoutMs)
          : null;

      const waiter: TelegramWaiter<T> = {
        match,
        resolve: (value) => {
          unregister();
          resolve(value);
        },
        reject: (error) => {
          unregister();
          reject(error);
        },
      };

      const unregister = () => {
        if (timeout) {
          clearTimeout(timeout);
        }

        options.signal?.removeEventListener("abort", abortListener);
        this.waiters.delete(waiter as TelegramWaiter<unknown>);

        if (this.waiters.size === 0) {
          this.pollAbortController?.abort();
        }
      };

      this.waiters.add(waiter as TelegramWaiter<unknown>);
      options.signal?.addEventListener("abort", abortListener, { once: true });
      this.ensurePolling();
    });
  }

  private ensurePolling(): void {
    if (this.pollPromise) {
      return;
    }

    this.pollPromise = this.pollLoop().finally(() => {
      this.pollPromise = null;

      if (this.waiters.size === 0) {
        updateStreams.delete(this.botToken);
      }
    });
  }

  private async pollLoop(): Promise<void> {
    while (this.waiters.size > 0) {
      this.pollAbortController = new AbortController();

      try {
        const updates = await telegramRequest<TelegramUpdate[]>(
          this.botToken,
          "getUpdates",
          {
            offset: this.currentOffset,
            timeout: 0,
            allowed_updates: allowedUpdateTypes,
          },
          this.pollAbortController.signal
        );

        for (const update of updates) {
          this.currentOffset = Math.max(
            this.currentOffset,
            update.update_id + 1
          );
          this.dispatch(update);
        }

        if (updates.length === 0 && this.waiters.size > 0) {
          await delay(shortPollIntervalMs, this.pollAbortController.signal);
        }
      } catch (error) {
        if (isAbortError(error) && this.waiters.size === 0) {
          return;
        }

        this.rejectAll(error);
        return;
      } finally {
        this.pollAbortController = null;
      }
    }
  }

  private dispatch(update: TelegramUpdate): void {
    for (const waiter of Array.from(this.waiters)) {
      try {
        const result = waiter.match(update);

        if (result !== undefined) {
          waiter.resolve(result);
        }
      } catch (error) {
        waiter.reject(error);
      }
    }
  }

  private rejectAll(error: unknown): void {
    for (const waiter of Array.from(this.waiters)) {
      waiter.reject(error);
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      const abortReason =
        signal?.reason ?? new DOMException("Aborted", "AbortError");
      reject(abortReason);
    };

    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function formatTelegramFetchError(method: string, error: unknown): string {
  if (!(error instanceof Error)) {
    return `Telegram ${method} request failed: ${String(error)}`;
  }

  const causeMessage =
    typeof error.cause === "object" &&
    error.cause !== null &&
    "message" in error.cause &&
    typeof error.cause.message === "string"
      ? error.cause.message
      : null;

  if (causeMessage) {
    return `Telegram ${method} request failed: ${error.message} (${causeMessage})`;
  }

  return `Telegram ${method} request failed: ${error.message}`;
}
