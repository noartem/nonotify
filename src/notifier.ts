import { readFileSync } from "node:fs";
import { getConfigPath } from "./config.js";
import { sendTelegramMessage } from "./telegram.js";

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
    const configPath = getConfigPath();

    let rawConfig: RawEnvConfig;

    try {
      const raw = readFileSync(configPath, "utf8");
      rawConfig = JSON.parse(raw) as RawEnvConfig;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return {
          profiles: [],
          defaultProfile: null,
        };
      }

      if (error instanceof SyntaxError) {
        throw new NotifierError(
          `Invalid JSON in config file at ${configPath}: ${error.message}`,
        );
      }

      throw error;
    }

    return normalizeEnvConfig(rawConfig);
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
    source: NotifierConfig | NotifierConfigLoader = new EnvConfigLoader(),
  ) {
    const config = isConfigLoader(source) ? source.load() : source;
    const normalized = normalizeNotifierConfig(config);
    const frozenProfiles = normalized.profiles.map((profile) =>
      Object.freeze({ ...profile }),
    );

    this.profiles = Object.freeze(frozenProfiles);
    this.defaultProfile = normalized.defaultProfile;
    this.profilesByName = new Map(
      frozenProfiles.map((profile) => [profile.name, profile]),
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
      message,
    );

    return {
      sent: true,
      profile: selectedProfile.name,
      provider: selectedProfile.type,
    };
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
      normalizeSingleProfile(profile, `profiles[${index}]`),
    );
  }

  if (typeof rawProfiles === "object") {
    const entries = Object.entries(
      rawProfiles as Record<string, RawRecordProfile>,
    );

    return entries.map(([name, profile]) =>
      normalizeRecordProfile(name, profile, `profiles.${name}`),
    );
  }

  throw new NotifierError(
    "Invalid config format: `profiles` must be an array or object.",
  );
}

function normalizeNotifierConfig(input: NotifierConfig): {
  profiles: NotifierProfile[];
  defaultProfile: string | null;
} {
  if (!Array.isArray(input.profiles)) {
    throw new NotifierError(
      "Invalid Notifier config: `profiles` must be an array.",
    );
  }

  const profiles = input.profiles.map((profile, index) =>
    normalizeSingleProfile(profile, `profiles[${index}]`),
  );

  const names = new Set<string>();

  for (const profile of profiles) {
    if (names.has(profile.name)) {
      throw new NotifierError(
        `Invalid Notifier config: duplicate profile name "${profile.name}".`,
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
  sourceLabel: string,
): NotifierProfile {
  if (!rawProfile || typeof rawProfile !== "object") {
    throw new NotifierError(
      `Invalid profile at ${sourceLabel}: expected an object.`,
    );
  }

  return {
    type: "telegram",
    name: profileName,
    botToken: requireNonEmptyString(
      rawProfile.botToken,
      `${sourceLabel}.botToken`,
    ),
    chatId: requireNonEmptyString(rawProfile.chatId, `${sourceLabel}.chatId`),
  };
}

function normalizeSingleProfile(
  rawProfile: unknown,
  sourceLabel: string,
): NotifierProfile {
  if (!rawProfile || typeof rawProfile !== "object") {
    throw new NotifierError(
      `Invalid profile at ${sourceLabel}: expected an object.`,
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
      `Invalid profile at ${sourceLabel}.type: only "telegram" is supported.`,
    );
  }

  return {
    type: "telegram",
    name: requireNonEmptyString(profile.name, `${sourceLabel}.name`),
    botToken: requireNonEmptyString(
      profile.botToken,
      `${sourceLabel}.botToken`,
    ),
    chatId: requireNonEmptyString(profile.chatId, `${sourceLabel}.chatId`),
  };
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new NotifierError(
      `Invalid value for ${label}: expected non-empty string.`,
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
