const ONE_MINUTE_MS = 60_000;
const FIVE_MINUTES_MS = 5 * 60_000;
const PLUGIN_CONFIG_KEY = "nonotify-opencode";

function normalizeDelayMs(value, fallbackMs) {
  if (!Number.isFinite(value) || value < 0) return fallbackMs;
  return value;
}

function secondsToMs(value) {
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value * 1000;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function defaultProfileReader() {
  return normalizeProfile(process.env.NNT_PROFILE);
}

function normalizeProfile(value) {
  if (typeof value !== "string") return undefined;
  const profile = value.trim();
  return profile.length > 0 ? profile : undefined;
}

function readProfileFromConfig(config) {
  if (!config || typeof config !== "object") return undefined;

  const pluginConfig = config[PLUGIN_CONFIG_KEY];
  if (typeof pluginConfig === "string") return normalizeProfile(pluginConfig);
  if (!pluginConfig || typeof pluginConfig !== "object") return undefined;

  return normalizeProfile(pluginConfig.profile);
}

function readDelaysFromConfig(config) {
  if (!config || typeof config !== "object") return {};

  const pluginConfig = config[PLUGIN_CONFIG_KEY];
  if (!pluginConfig || typeof pluginConfig !== "object") return {};

  return {
    approvalDelayMs: secondsToMs(pluginConfig.approvalDelaySeconds),
    questionDelayMs: secondsToMs(pluginConfig.questionDelaySeconds),
    longReplyMs: secondsToMs(pluginConfig.longReplyThresholdSeconds),
    longReplyNotifyDelayMs: secondsToMs(pluginConfig.activityDelaySeconds),
  };
}

async function createDefaultNotifier() {
  const { Notifier } = await import("nonotify");
  return new Notifier();
}

export async function createNonotifyOpencodeHooks({ client }, options = {}) {
  const pendingPermissions = new Map();
  const pendingQuestions = new Map();
  const pendingLongReplies = new Map();
  const notifiedLongMessages = new Set();
  const notifier = options.notifier ?? (await createDefaultNotifier());
  const hasOptionApprovalDelayMs = Object.prototype.hasOwnProperty.call(options, "approvalDelayMs");
  const hasOptionQuestionDelayMs = Object.prototype.hasOwnProperty.call(options, "questionDelayMs");
  const hasOptionLongReplyMs = Object.prototype.hasOwnProperty.call(options, "longReplyMs");
  const hasOptionLongReplyNotifyDelayMs = Object.prototype.hasOwnProperty.call(options, "longReplyNotifyDelayMs");
  let approvalDelayMs = normalizeDelayMs(options.approvalDelayMs, ONE_MINUTE_MS);
  let questionDelayMs = normalizeDelayMs(options.questionDelayMs, ONE_MINUTE_MS);
  let longReplyMs = normalizeDelayMs(options.longReplyMs, FIVE_MINUTES_MS);
  let longReplyNotifyDelayMs = normalizeDelayMs(options.longReplyNotifyDelayMs, ONE_MINUTE_MS);
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  const readProfile = options.readProfile ?? defaultProfileReader;
  const optionProfile = normalizeProfile(options.profile);
  let configuredProfile = optionProfile;
  let notificationsDisabled = false;

  const log = async (level, message, extra = {}) => {
    await client.app.log({
      body: {
        service: "nonotify-opencode",
        level,
        message,
        extra,
      },
    });
  };

  const sendNotification = async (title, lines) => {
    if (notificationsDisabled) return;

    const message = [`[OpenCode] ${title}`, ...lines].join("\n");
    const profile = configuredProfile ?? readProfile();

    try {
      await notifier.send({ message, profile });
    } catch (error) {
      notificationsDisabled = true;
      await log("warn", "Failed to send nonotify alert. Alerts are now disabled.", {
        error: String(error),
      });
    }
  };

  const startPermissionTimer = (event) => {
    const properties = event.properties ?? {};
    const requestID = properties.id;

    if (!requestID) return;

    const previous = pendingPermissions.get(requestID);
    if (previous) cancel(previous.timeout);

    const timeout = schedule(async () => {
      const pending = pendingPermissions.get(requestID);
      if (!pending) return;

      pendingPermissions.delete(requestID);

      const permissionName = pending.permission || "unknown";
      const patterns = pending.patterns.length > 0 ? pending.patterns.join(", ") : "none";

      await sendNotification(`Approval pending > ${formatDuration(approvalDelayMs)}`, [
        `session: ${pending.sessionID}`,
        `permission: ${permissionName}`,
        `patterns: ${patterns}`,
      ]);
    }, approvalDelayMs);

    pendingPermissions.set(requestID, {
      sessionID: properties.sessionID || "unknown",
      permission: properties.permission || properties.type,
      patterns: Array.isArray(properties.patterns)
        ? properties.patterns
        : Array.isArray(properties.pattern)
          ? properties.pattern
          : properties.pattern
            ? [String(properties.pattern)]
            : [],
      timeout,
    });
  };

  const stopPermissionTimer = (event) => {
    const properties = event.properties ?? {};
    const requestID = properties.requestID || properties.permissionID;

    if (!requestID) return;

    const pending = pendingPermissions.get(requestID);
    if (!pending) return;

    cancel(pending.timeout);
    pendingPermissions.delete(requestID);
  };

  const startQuestionTimer = (event) => {
    const properties = event.properties ?? {};
    const requestID = properties.id;

    if (!requestID) return;

    const previous = pendingQuestions.get(requestID);
    if (previous) cancel(previous.timeout);

    const timeout = schedule(async () => {
      const pending = pendingQuestions.get(requestID);
      if (!pending) return;

      pendingQuestions.delete(requestID);

      const headers = pending.headers.length > 0 ? pending.headers.join(" | ") : "none";

      await sendNotification(`Question pending > ${formatDuration(questionDelayMs)}`, [
        `session: ${pending.sessionID}`,
        `questions: ${pending.questionCount}`,
        `headers: ${headers}`,
      ]);
    }, questionDelayMs);

    const questions = Array.isArray(properties.questions) ? properties.questions : [];

    pendingQuestions.set(requestID, {
      sessionID: properties.sessionID || "unknown",
      questionCount: questions.length,
      headers: questions
        .map((question) => question?.header)
        .filter((header) => typeof header === "string" && header.trim().length > 0)
        .slice(0, 3),
      timeout,
    });
  };

  const stopQuestionTimer = (event) => {
    const properties = event.properties ?? {};
    const requestID = properties.requestID || properties.questionID;

    if (!requestID) return;

    const pending = pendingQuestions.get(requestID);
    if (!pending) return;

    cancel(pending.timeout);
    pendingQuestions.delete(requestID);
  };

  const maybeNotifyLongReply = (event) => {
    const info = event.properties?.info;
    if (!info || info.role !== "assistant") return;

    const messageID = info.id;
    if (!messageID || notifiedLongMessages.has(messageID) || pendingLongReplies.has(messageID)) return;

    const created = Number(info.time?.created);
    const completed = Number(info.time?.completed);
    if (!Number.isFinite(created) || !Number.isFinite(completed)) return;

    const duration = completed - created;
    if (duration <= longReplyMs) return;

    const timeout = schedule(async () => {
      const pending = pendingLongReplies.get(messageID);
      if (!pending) return;

      pendingLongReplies.delete(messageID);
      notifiedLongMessages.add(messageID);

      await sendNotification("Long reply completed", [
        `duration: ${formatDuration(pending.duration)}`,
        `session: ${pending.sessionID}`,
        `agent: ${pending.agent}`,
      ]);
    }, longReplyNotifyDelayMs);

    pendingLongReplies.set(messageID, {
      sessionID: info.sessionID || "unknown",
      duration,
      agent: info.agent || "unknown",
      timeout,
    });
  };

  const cancelPendingLongRepliesForSession = (sessionID) => {
    if (!sessionID) return;

    for (const [messageID, pending] of pendingLongReplies.entries()) {
      if (pending.sessionID !== sessionID) continue;
      cancel(pending.timeout);
      pendingLongReplies.delete(messageID);
    }
  };

  const markUserActivity = (sessionID) => {
    cancelPendingLongRepliesForSession(sessionID);
  };

  const cleanupSessionPendingInputs = (event) => {
    const sessionID = event.properties?.sessionID;
    if (!sessionID) return;

    for (const [requestID, pending] of pendingPermissions.entries()) {
      if (pending.sessionID !== sessionID) continue;
      cancel(pending.timeout);
      pendingPermissions.delete(requestID);
    }

    for (const [requestID, pending] of pendingQuestions.entries()) {
      if (pending.sessionID !== sessionID) continue;
      cancel(pending.timeout);
      pendingQuestions.delete(requestID);
    }

    cancelPendingLongRepliesForSession(sessionID);
  };

  return {
    config: async (config) => {
      if (!optionProfile) {
        configuredProfile = readProfileFromConfig(config);
      }

      const delays = readDelaysFromConfig(config);
      if (!hasOptionApprovalDelayMs) {
        approvalDelayMs = normalizeDelayMs(delays.approvalDelayMs, approvalDelayMs);
      }
      if (!hasOptionQuestionDelayMs) {
        questionDelayMs = normalizeDelayMs(delays.questionDelayMs, questionDelayMs);
      }
      if (!hasOptionLongReplyMs) {
        longReplyMs = normalizeDelayMs(delays.longReplyMs, longReplyMs);
      }
      if (!hasOptionLongReplyNotifyDelayMs) {
        longReplyNotifyDelayMs = normalizeDelayMs(
          delays.longReplyNotifyDelayMs,
          longReplyNotifyDelayMs,
        );
      }
    },
    event: async ({ event }) => {
      switch (event.type) {
        case "permission.asked":
        case "permission.updated":
          startPermissionTimer(event);
          return;
        case "permission.replied":
          stopPermissionTimer(event);
          markUserActivity(event.properties?.sessionID);
          return;
        case "question.asked":
          startQuestionTimer(event);
          return;
        case "question.replied":
        case "question.rejected":
          stopQuestionTimer(event);
          markUserActivity(event.properties?.sessionID);
          return;
        case "message.updated":
          if (event.properties?.info?.role === "user") {
            markUserActivity(event.properties.info.sessionID);
            return;
          }

          maybeNotifyLongReply(event);
          return;
        case "command.executed":
          markUserActivity(event.properties?.sessionID);
          return;
        case "session.deleted":
          cleanupSessionPendingInputs(event);
          return;
        default:
          return;
      }
    },
  };
}

export const NonotifyOpencodePlugin = async (input) => {
  return createNonotifyOpencodeHooks(input);
};

export default NonotifyOpencodePlugin;
