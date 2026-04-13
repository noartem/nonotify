import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getConfigPath, getLegacyConfigPath } from "./config.js";
import {
  answerTelegramCallbackQuery,
  clearTelegramInlineKeyboard,
  getLatestUpdateOffset,
  markTelegramSelectedOption,
  sendTelegramChoiceMessage,
  sendTelegramMessage,
  waitForTelegramCallback,
} from "./telegram.js";

export type NotifierProfile = {
  type: "telegram";
  name: string;
  botToken: string;
  chatId: string;
};

export type NotifierProfileInput = {
  type?: "telegram";
  name: string;
  botToken: string;
  chatId: string;
};

export type NotifierConfig = {
  profiles: NotifierProfileInput[];
  defaultProfile?: string | null;
};

export interface NotifierConfigLoader {
  load(): NotifierConfig;
}

export type SendInput = {
  message: string;
  profile?: string;
};

export type SendResult = {
  sent: true;
  profile: string;
  provider: "telegram";
};

export type AskInput = {
  message: string;
  options: readonly string[];
  profile?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type AskResult = {
  selected: string;
  profile: string;
  provider: "telegram";
};

export class NotifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotifierError";
  }
}

export class ProfileNotFoundError extends NotifierError {
  readonly profile: string;

  constructor(profile: string) {
    super(`Profile "${profile}" not found.`);
    this.name = "ProfileNotFoundError";
    this.profile = profile;
  }
}

export class NoProfilesConfiguredError extends NotifierError {
  constructor() {
    super("No profiles configured. Run `nnt profile add` first.");
    this.name = "NoProfilesConfiguredError";
  }
}

export class AskTimeoutError extends NotifierError {
  constructor() {
    super("Timed out waiting for Telegram answer.");
    this.name = "AskTimeoutError";
  }
}

export class AskAbortedError extends NotifierError {
  constructor() {
    super("Telegram answer wait was aborted.");
    this.name = "AskAbortedError";
  }
}

type RawEnvConfig = {
  defaultProfile?: unknown;
  profiles?: unknown;
};

type RawRecordProfile = {
  type?: unknown;
  name?: unknown;
  botToken?: unknown;
  chatId?: unknown;
};

export class EnvConfigLoader implements NotifierConfigLoader {
  load(): NotifierConfig {
    const configPaths = Array.from(
      new Set([getConfigPath(), getLegacyConfigPath()])
    );

    for (const configPath of configPaths) {
      try {
        const raw = readFileSync(configPath, "utf8");
        const rawConfig = JSON.parse(raw) as RawEnvConfig;
        return normalizeEnvConfig(rawConfig);
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          continue;
        }

        if (error instanceof SyntaxError) {
          throw new NotifierError(
            `Invalid JSON in config file at ${configPath}: ${error.message}`
          );
        }

        throw error;
      }
    }

    return {
      profiles: [],
      defaultProfile: null,
    };
  }
}

export class Notifier {
  readonly profiles: readonly Readonly<NotifierProfile>[];
  private readonly defaultProfile: string | null;
  private readonly profilesByName: ReadonlyMap<
    string,
    Readonly<NotifierProfile>
  >;

  constructor(
    source: NotifierConfig | NotifierConfigLoader = new EnvConfigLoader()
  ) {
    const config = isConfigLoader(source) ? source.load() : source;
    const normalized = normalizeNotifierConfig(config);
    const frozenProfiles = normalized.profiles.map((profile) =>
      Object.freeze({ ...profile })
    );

    this.profiles = Object.freeze(frozenProfiles);
    this.defaultProfile = normalized.defaultProfile;
    this.profilesByName = new Map(
      frozenProfiles.map((profile) => [profile.name, profile])
    );
  }

  async send(input: SendInput): Promise<SendResult> {
    const message = input.message.trim();

    if (message === "") {
      throw new NotifierError("Message cannot be empty.");
    }

    const selectedProfile = this.resolveProfile(input.profile);

    await sendTelegramMessage(
      selectedProfile.botToken,
      selectedProfile.chatId,
      message
    );

    return {
      sent: true,
      profile: selectedProfile.name,
      provider: selectedProfile.type,
    };
  }

  async ask(input: AskInput): Promise<AskResult> {
    const message = input.message.trim();

    if (message === "") {
      throw new NotifierError("Message cannot be empty.");
    }

    if (!Array.isArray(input.options)) {
      throw new NotifierError("Options must be an array.");
    }

    if (input.options.length < 1 || input.options.length > 10) {
      throw new NotifierError("Options must contain between 1 and 10 items.");
    }

    const options = input.options.map((option, index) => {
      if (typeof option !== "string" || option.trim() === "") {
        throw new NotifierError(
          `Invalid option at index ${index}: expected non-empty string.`
        );
      }

      return option.trim();
    });

    if (
      input.timeoutMs !== undefined &&
      (!Number.isFinite(input.timeoutMs) || input.timeoutMs < 0)
    ) {
      throw new NotifierError("timeoutMs must be a non-negative number.");
    }

    const selectedProfile = this.resolveProfile(input.profile);
    const offset = await getLatestUpdateOffset(selectedProfile.botToken);
    const requestId = randomUUID().replaceAll("-", "");
    const callbackOptions = options.map((option, index) => ({
      label: option,
      callbackData: `nnt:${requestId}:${index}`,
    }));
    const sentMessage = await sendTelegramChoiceMessage(
      selectedProfile.botToken,
      selectedProfile.chatId,
      message,
      callbackOptions
    );

    try {
      const callback = await waitForTelegramCallback(selectedProfile.botToken, {
        chatId: selectedProfile.chatId,
        messageId: sentMessage.messageId,
        callbackData: callbackOptions.map((option) => option.callbackData),
        offset,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      });

      const selectedIndex = callbackOptions.findIndex(
        (option) => option.callbackData === callback.data
      );

      if (selectedIndex === -1) {
        throw new NotifierError("Received an unknown Telegram answer.");
      }

      await answerTelegramCallbackQuery(
        selectedProfile.botToken,
        callback.callbackQueryId
      );

      try {
        await markTelegramSelectedOption(
          selectedProfile.botToken,
          selectedProfile.chatId,
          sentMessage.messageId,
          callbackOptions,
          callback.data
        );
      } catch {
        // Keep the selected answer even if the visual update fails.
      }

      return {
        selected: options[selectedIndex],
        profile: selectedProfile.name,
        provider: selectedProfile.type,
      };
    } catch (error) {
      if (error instanceof Error && error.message === "Timed out waiting") {
        throw new AskTimeoutError();
      }

      if (isAbortError(error)) {
        throw new AskAbortedError();
      }

      throw error;
    } finally {
      if (input.signal?.aborted) {
        try {
          await clearTelegramInlineKeyboard(
            selectedProfile.botToken,
            selectedProfile.chatId,
            sentMessage.messageId
          );
        } catch {
          // Do not mask the original ask result or failure if cleanup fails.
        }
      }
    }
  }

  private resolveProfile(profileName?: string): Readonly<NotifierProfile> {
    if (profileName) {
      const profile = this.profilesByName.get(profileName);

      if (!profile) {
        throw new ProfileNotFoundError(profileName);
      }

      return profile;
    }

    if (this.defaultProfile) {
      const defaultProfile = this.profilesByName.get(this.defaultProfile);
      if (defaultProfile) {
        return defaultProfile;
      }
    }

    const firstProfile = this.profiles[0];

    if (!firstProfile) {
      throw new NoProfilesConfiguredError();
    }

    return firstProfile;
  }
}

function normalizeEnvConfig(raw: RawEnvConfig): NotifierConfig {
  return {
    defaultProfile:
      typeof raw.defaultProfile === "string" ? raw.defaultProfile : null,
    profiles: normalizeProfilesFromUnknown(raw.profiles),
  };
}

function normalizeProfilesFromUnknown(rawProfiles: unknown): NotifierProfile[] {
  if (!rawProfiles) {
    return [];
  }

  if (Array.isArray(rawProfiles)) {
    return rawProfiles.map((profile, index) =>
      normalizeSingleProfile(profile, `profiles[${index}]`)
    );
  }

  if (typeof rawProfiles === "object") {
    const entries = Object.entries(
      rawProfiles as Record<string, RawRecordProfile>
    );

    return entries.map(([name, profile]) =>
      normalizeRecordProfile(name, profile, `profiles.${name}`)
    );
  }

  throw new NotifierError(
    "Invalid config format: `profiles` must be an array or object."
  );
}

function normalizeNotifierConfig(input: NotifierConfig): {
  profiles: NotifierProfile[];
  defaultProfile: string | null;
} {
  if (!Array.isArray(input.profiles)) {
    throw new NotifierError(
      "Invalid Notifier config: `profiles` must be an array."
    );
  }

  const profiles = input.profiles.map((profile, index) =>
    normalizeSingleProfile(profile, `profiles[${index}]`)
  );

  const names = new Set<string>();

  for (const profile of profiles) {
    if (names.has(profile.name)) {
      throw new NotifierError(
        `Invalid Notifier config: duplicate profile name "${profile.name}".`
      );
    }

    names.add(profile.name);
  }

  return {
    profiles,
    defaultProfile:
      typeof input.defaultProfile === "string" ? input.defaultProfile : null,
  };
}

function normalizeRecordProfile(
  profileName: string,
  rawProfile: RawRecordProfile,
  sourceLabel: string
): NotifierProfile {
  if (!rawProfile || typeof rawProfile !== "object") {
    throw new NotifierError(
      `Invalid profile at ${sourceLabel}: expected an object.`
    );
  }

  return {
    type: "telegram",
    name: profileName,
    botToken: requireNonEmptyString(
      rawProfile.botToken,
      `${sourceLabel}.botToken`
    ),
    chatId: requireNonEmptyString(rawProfile.chatId, `${sourceLabel}.chatId`),
  };
}

function normalizeSingleProfile(
  rawProfile: unknown,
  sourceLabel: string
): NotifierProfile {
  if (!rawProfile || typeof rawProfile !== "object") {
    throw new NotifierError(
      `Invalid profile at ${sourceLabel}: expected an object.`
    );
  }

  const profile = rawProfile as {
    type?: unknown;
    name?: unknown;
    botToken?: unknown;
    chatId?: unknown;
  };

  if (profile.type !== undefined && profile.type !== "telegram") {
    throw new NotifierError(
      `Invalid profile at ${sourceLabel}.type: only "telegram" is supported.`
    );
  }

  return {
    type: "telegram",
    name: requireNonEmptyString(profile.name, `${sourceLabel}.name`),
    botToken: requireNonEmptyString(
      profile.botToken,
      `${sourceLabel}.botToken`
    ),
    chatId: requireNonEmptyString(profile.chatId, `${sourceLabel}.chatId`),
  };
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new NotifierError(
      `Invalid value for ${label}: expected non-empty string.`
    );
  }

  return value.trim();
}

function isConfigLoader(value: unknown): value is NotifierConfigLoader {
  return (
    typeof value === "object" &&
    value !== null &&
    "load" in value &&
    typeof (value as { load: unknown }).load === "function"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}
