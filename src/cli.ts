#!/usr/bin/env node

import { Cli, z } from "incur";
import {
  askConfirm,
  askRequired,
  askRequiredWithInitial,
  askSelect,
} from "./prompt.js";
import { getConfigPath, loadConfig, saveConfig } from "./config.js";
import { printKeyValueTable, printProfilesTable } from "./display.js";
import {
  getLatestUpdateOffset,
  sendTelegramMessage,
  waitForChatId,
} from "./telegram.js";
import { Notifier } from "./notifier.js";

const profileCli = Cli.create("profile", {
  description: "Manage notification profiles",
});

profileCli.command("add", {
  description: "Add a notification profile",
  outputPolicy: "agent-only",
  args: z.object({
    provider: z
      .enum(["telegram"])
      .default("telegram")
      .describe("Profile provider"),
  }),
  async run(c) {
    if (c.args.provider !== "telegram") {
      throw new Error(`Unsupported provider: ${c.args.provider}`);
    }

    const config = await loadConfig();
    const profileName = await askRequired("Profile name: ");

    if (config.profiles[profileName]) {
      throw new Error(`Profile "${profileName}" already exists.`);
    }

    const botToken = await askRequired("Telegram bot token: ");

    if (shouldRenderPretty(c.agent)) {
      process.stdout.write("\nSend any message to your bot in Telegram.\n");
      process.stdout.write(
        "Waiting for message to detect chat_id (up to 120s)...\n",
      );
    }

    const offset = await getLatestUpdateOffset(botToken);
    const connection = await waitForChatId(botToken, offset, 120);
    const chatId = connection.chatId;

    if (shouldRenderPretty(c.agent)) {
      if (connection.username) {
        process.stdout.write(
          `Connected Telegram username: @${connection.username}\n`,
        );
      } else {
        process.stdout.write("Connected Telegram user has no username set.\n");
      }
    }

    config.profiles[profileName] = {
      type: "telegram",
      name: profileName,
      botToken,
      chatId,
      createdAt: new Date().toISOString(),
    };

    if (!config.defaultProfile) {
      config.defaultProfile = profileName;
    }

    await saveConfig(config);

    let confirmationSent = false;
    let confirmationWarning: string | null = null;

    try {
      await sendTelegramMessage(
        botToken,
        chatId,
        `nnt: profile "${profileName}" connected successfully. You can now send notifications from CLI.`,
      );
      confirmationSent = true;
    } catch (error) {
      confirmationWarning =
        error instanceof Error
          ? error.message
          : "Unknown error while sending confirmation";
    }

    if (shouldRenderPretty(c.agent)) {
      printKeyValueTable("Profile added", [
        { key: "profile", value: profileName },
        { key: "provider", value: "telegram" },
        { key: "chat_id", value: chatId },
        {
          key: "username",
          value: connection.username ? `@${connection.username}` : "(none)",
        },
        { key: "default", value: config.defaultProfile ?? "(none)" },
      ]);
    }

    return {
      added: true,
      profile: profileName,
      provider: "telegram",
      chatId,
      username: connection.username,
      defaultProfile: config.defaultProfile,
      configPath: getConfigPath(),
      confirmationSent,
      confirmationWarning,
    };
  },
});

profileCli.command("list", {
  description: "List configured profiles",
  outputPolicy: "agent-only",
  async run(c) {
    const config = await loadConfig();
    const names = Object.keys(config.profiles).sort((a, b) =>
      a.localeCompare(b),
    );
    const profiles = names.map((name) => ({
      name,
      provider: config.profiles[name].type,
      isDefault: name === config.defaultProfile,
    }));

    if (shouldRenderPretty(c.agent)) {
      printProfilesTable(profiles);
    }

    return {
      defaultProfile: config.defaultProfile,
      totalProfiles: names.length,
      profiles,
    };
  },
});

profileCli.command("default", {
  description: "Get or set default profile",
  outputPolicy: "agent-only",
  args: z.object({
    profile: z.string().optional().describe("Profile name to set as default"),
  }),
  async run(c) {
    const config = await loadConfig();

    if (!c.args.profile) {
      if (shouldRenderPretty(c.agent)) {
        printKeyValueTable("Default profile", [
          { key: "default", value: config.defaultProfile ?? "(not set)" },
        ]);
      }

      return {
        defaultProfile: config.defaultProfile,
      };
    }

    if (!config.profiles[c.args.profile]) {
      throw new Error(`Profile "${c.args.profile}" not found.`);
    }

    config.defaultProfile = c.args.profile;
    await saveConfig(config);

    if (shouldRenderPretty(c.agent)) {
      printKeyValueTable("Default profile updated", [
        { key: "default", value: config.defaultProfile ?? "(not set)" },
      ]);
    }

    return {
      updated: true,
      defaultProfile: config.defaultProfile,
    };
  },
});

profileCli.command("delete", {
  description: "Delete a profile",
  outputPolicy: "agent-only",
  args: z.object({
    profile: z.string().describe("Profile name to delete"),
  }),
  async run(c) {
    const config = await loadConfig();
    const targetName = c.args.profile;
    const profile = config.profiles[targetName];

    if (!profile) {
      throw new Error(`Profile "${targetName}" not found.`);
    }

    delete config.profiles[targetName];

    if (config.defaultProfile === targetName) {
      const remaining = Object.keys(config.profiles).sort((a, b) =>
        a.localeCompare(b),
      );
      config.defaultProfile = remaining[0] ?? null;
    }

    await saveConfig(config);

    if (shouldRenderPretty(c.agent)) {
      printKeyValueTable("Profile deleted", [
        { key: "profile", value: targetName },
        { key: "provider", value: profile.type },
        { key: "default", value: config.defaultProfile ?? "(not set)" },
      ]);
    }

    return {
      deleted: true,
      profile: targetName,
      provider: profile.type,
      defaultProfile: config.defaultProfile,
    };
  },
});

profileCli.command("edit", {
  description: "Edit profile data",
  outputPolicy: "agent-only",
  args: z.object({
    profile: z.string().optional().describe("Existing profile name"),
  }),
  options: z.object({
    newName: z.string().optional().describe("Rename profile to a new name"),
    botToken: z.string().optional().describe("Replace Telegram bot token"),
    chatId: z.string().optional().describe("Replace Telegram chat id"),
    reconnect: z
      .boolean()
      .optional()
      .describe("Re-detect chat id from next Telegram message"),
  }),
  alias: {
    newName: "n",
    botToken: "t",
    chatId: "c",
    reconnect: "r",
  },
  async run(c) {
    const config = await loadConfig();
    const profileNames = Object.keys(config.profiles).sort((a, b) =>
      a.localeCompare(b),
    );

    if (profileNames.length === 0) {
      throw new Error("No profiles found. Run `nnt profile add` first.");
    }

    const hasDirectEditOptions = Boolean(
      c.options.newName ||
      c.options.botToken ||
      c.options.chatId ||
      c.options.reconnect,
    );

    const sourceName = await resolveProfileForEdit(
      c.args.profile,
      profileNames,
      hasDirectEditOptions,
    );
    const sourceProfile = config.profiles[sourceName];

    if (!sourceProfile) {
      throw new Error(`Profile "${sourceName}" not found.`);
    }

    const targetName = c.options.newName ?? sourceName;

    if (targetName !== sourceName && config.profiles[targetName]) {
      throw new Error(`Profile "${targetName}" already exists.`);
    }

    const botToken = c.options.botToken ?? sourceProfile.botToken;
    let nextName = targetName;
    let nextBotToken = botToken;
    let chatId = c.options.chatId ?? sourceProfile.chatId;
    let connectedUsername: string | null = null;

    if (!hasDirectEditOptions && canPromptInteractively()) {
      nextName = await askRequiredWithInitial("Profile name", sourceName);

      if (nextName !== sourceName && config.profiles[nextName]) {
        throw new Error(`Profile "${nextName}" already exists.`);
      }

      nextBotToken = await askRequiredWithInitial(
        "Telegram bot token",
        sourceProfile.botToken,
      );

      const shouldReconnect = await askConfirm(
        "Reconnect and detect chat_id from a new message?",
        false,
      );

      if (shouldReconnect) {
        if (shouldRenderPretty(c.agent)) {
          process.stdout.write("\nSend any message to your bot in Telegram.\n");
          process.stdout.write(
            "Waiting for message to detect chat_id (up to 120s)...\n",
          );
        }

        const offset = await getLatestUpdateOffset(nextBotToken);
        const connection = await waitForChatId(nextBotToken, offset, 120);
        chatId = connection.chatId;
        connectedUsername = connection.username;

        if (shouldRenderPretty(c.agent)) {
          if (connection.username) {
            process.stdout.write(
              `Connected Telegram username: @${connection.username}\n`,
            );
          } else {
            process.stdout.write(
              "Connected Telegram user has no username set.\n",
            );
          }
        }
      } else {
        chatId = await askRequiredWithInitial(
          "Telegram chat_id",
          sourceProfile.chatId,
        );
      }
    }

    if (c.options.reconnect) {
      if (shouldRenderPretty(c.agent)) {
        process.stdout.write("\nSend any message to your bot in Telegram.\n");
        process.stdout.write(
          "Waiting for message to detect chat_id (up to 120s)...\n",
        );
      }

      const offset = await getLatestUpdateOffset(nextBotToken);
      const connection = await waitForChatId(nextBotToken, offset, 120);
      chatId = connection.chatId;
      connectedUsername = connection.username;

      if (shouldRenderPretty(c.agent)) {
        if (connection.username) {
          process.stdout.write(
            `Connected Telegram username: @${connection.username}\n`,
          );
        } else {
          process.stdout.write(
            "Connected Telegram user has no username set.\n",
          );
        }
      }
    }

    const updatedProfile = {
      ...sourceProfile,
      name: nextName,
      botToken: nextBotToken,
      chatId,
    };

    if (nextName !== sourceName) {
      delete config.profiles[sourceName];
    }

    config.profiles[nextName] = updatedProfile;

    if (config.defaultProfile === sourceName) {
      config.defaultProfile = nextName;
    }

    const hasChanges =
      nextName !== sourceName ||
      nextBotToken !== sourceProfile.botToken ||
      chatId !== sourceProfile.chatId;

    if (!hasChanges) {
      return {
        updated: false,
        profile: sourceName,
        provider: sourceProfile.type,
        defaultProfile: config.defaultProfile,
        connectedUsername,
      };
    }

    await saveConfig(config);

    if (shouldRenderPretty(c.agent)) {
      printKeyValueTable("Profile updated", [
        { key: "profile", value: nextName },
        { key: "provider", value: updatedProfile.type },
        { key: "chat_id", value: chatId },
        {
          key: "username",
          value: connectedUsername
            ? `@${connectedUsername}`
            : "(unchanged/none)",
        },
        { key: "default", value: config.defaultProfile ?? "(not set)" },
      ]);
    }

    return {
      updated: true,
      previousProfile: sourceName,
      profile: nextName,
      provider: updatedProfile.type,
      defaultProfile: config.defaultProfile,
      connectedUsername,
    };
  },
});

const cli = Cli.create("nnt", {
  description: "Send Telegram notifications from terminal and agents",
})
  .command("send", {
    description: "Send a message via a saved profile",
    args: z.object({
      message: z.string().describe("Message text to send"),
    }),
    options: z.object({
      profile: z.string().optional().describe("Profile name from config"),
    }),
    alias: {
      profile: "p",
    },
    async run(c) {
      const notifier = new Notifier();

      return notifier.send({
        message: c.args.message,
        profile: c.options.profile,
      });
    },
  })
  .command(profileCli);

function routeDefaultCommand(argv: string[]): string[] {
  if (argv.length === 0) {
    return argv;
  }

  const topLevelCommands = new Set(["profile", "send", "skills", "mcp"]);
  const bareGlobalFlags = new Set([
    "--help",
    "-h",
    "--version",
    "--llms",
    "--mcp",
    "--json",
    "--verbose",
  ]);

  let index = 0;
  while (index < argv.length) {
    const token = argv[index];

    if (token === "--format") {
      index += 2;
      continue;
    }

    if (bareGlobalFlags.has(token)) {
      index += 1;
      continue;
    }

    break;
  }

  if (index >= argv.length) {
    return argv;
  }

  if (topLevelCommands.has(argv[index])) {
    return argv;
  }

  return [...argv.slice(0, index), "send", ...argv.slice(index)];
}

function normalizeFormatFlag(argv: string[]): string[] {
  const normalized: string[] = [];

  for (const token of argv) {
    if (token.startsWith("--format=")) {
      normalized.push("--format", token.slice("--format=".length));
      continue;
    }

    normalized.push(token);
  }

  return normalized;
}

function isStrictOutputRequested(argv: string[]): boolean {
  for (const token of argv) {
    if (token === "--json" || token === "--verbose" || token === "--format") {
      return true;
    }
  }

  return false;
}

function isAgentEnvironment(): boolean {
  return [
    process.env.OPENCODE,
    process.env.CLAUDECODE,
    process.env.CURSOR_AGENT,
    process.env.AIDER_SESSION,
    process.env.NNT_AGENT_MODE,
  ].some(Boolean);
}

function withAgentDefaultFormat(
  argv: string[],
  strictOutputRequested: boolean,
): string[] {
  if (strictOutputRequested || !isAgentEnvironment()) {
    return argv;
  }

  return ["--format", "toon", ...argv];
}

function canPromptInteractively(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function resolveProfileForEdit(
  profileFromArgs: string | undefined,
  profileNames: string[],
  hasDirectEditOptions: boolean,
): Promise<string> {
  if (profileFromArgs) {
    return profileFromArgs;
  }

  if (hasDirectEditOptions || !canPromptInteractively()) {
    throw new Error("Profile name is required in non-interactive mode.");
  }

  return askSelect(
    "Select profile to edit",
    profileNames.map((name) => ({
      value: name,
      label: name,
    })),
  );
}

const normalizedArgv = normalizeFormatFlag(process.argv.slice(2));
const strictOutputRequested = isStrictOutputRequested(normalizedArgv);
const argvWithAgentDefaults = withAgentDefaultFormat(
  normalizedArgv,
  strictOutputRequested,
);

function shouldRenderPretty(agent: boolean): boolean {
  return !agent && !strictOutputRequested && !isAgentEnvironment();
}

const routedArgv = routeDefaultCommand(argvWithAgentDefaults);
await cli.serve(routedArgv);

export default cli;
