const ONE_MINUTE_MS = 60_000;
const PLUGIN_CONFIG_KEY = "nonotify-opencode";
const FINISH_SELECTION_LABEL = "Завершить выбор";
const NEXT_PAGE_LABEL = "Еще варианты";

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
  };
}

function readSessionID(properties) {
  if (!properties || typeof properties !== "object") return undefined;
  const sessionID =
    properties.sessionID ||
    properties.sessionId ||
    properties.session?.id ||
    properties.session?.sessionID;
  return typeof sessionID === "string" && sessionID.length > 0
    ? sessionID
    : undefined;
}

function readSessionName(properties) {
  if (!properties || typeof properties !== "object") return undefined;

  const candidates = [
    properties.sessionName,
    properties.sessionTitle,
    properties.session?.name,
    properties.session?.title,
    properties.name,
    properties.title,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const sessionName = candidate.trim();
    if (sessionName.length > 0) return sessionName;
  }

  return undefined;
}

function formatSessionLabel(sessionID, sessionName) {
  if (sessionName && sessionID && sessionName !== sessionID) {
    return `${sessionName} (${sessionID})`;
  }

  return sessionName || sessionID || "unknown";
}

async function createDefaultNotifier() {
  const { Notifier } = await import("nonotify");
  return new Notifier();
}

export async function createNonotifyOpencodeHooks({ client }, options = {}) {
  const pendingPermissions = new Map();
  const pendingQuestions = new Map();
  const notifier = options.notifier ?? (await createDefaultNotifier());
  const hasOptionApprovalDelayMs = Object.prototype.hasOwnProperty.call(
    options,
    "approvalDelayMs",
  );
  const hasOptionQuestionDelayMs = Object.prototype.hasOwnProperty.call(
    options,
    "questionDelayMs",
  );
  let approvalDelayMs = normalizeDelayMs(options.approvalDelayMs, ONE_MINUTE_MS);
  let questionDelayMs = normalizeDelayMs(options.questionDelayMs, ONE_MINUTE_MS);
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
      await log(
        "warn",
        "Failed to send nonotify alert. Alerts are now disabled.",
        {
          error: String(error),
        },
      );
    }
  };

  const ask = async (message, optionLabels, signal) => {
    if (typeof notifier.ask !== "function") {
      throw new Error("Installed notifier does not support ask().");
    }

    return notifier.ask({
      message,
      options: optionLabels,
      profile: configuredProfile ?? readProfile(),
      signal,
    });
  };

  const startPermissionTimer = (event) => {
    const properties = event.properties ?? {};
    const requestID =
      properties.requestID || properties.permissionID || properties.id;

    if (!requestID) return;

    const previous = pendingPermissions.get(requestID);
    if (previous?.timeout) cancel(previous.timeout);
    if (previous?.controller) return;

    const entry = {
      requestID,
      delayMs: approvalDelayMs,
      sessionID: readSessionID(properties) || "unknown",
      sessionName: readSessionName(properties),
      permission: properties.permission || properties.type,
      patterns: Array.isArray(properties.patterns)
        ? properties.patterns
        : Array.isArray(properties.pattern)
          ? properties.pattern
          : properties.pattern
            ? [String(properties.pattern)]
            : [],
      timeout: null,
      controller: null,
    };

    entry.timeout = schedule(async () => {
      const pending = pendingPermissions.get(requestID);
      if (!pending || pending.controller) return;

      pending.timeout = null;
      pending.controller = new AbortController();
      await handlePermissionRequest(pending);
    }, approvalDelayMs);

    pendingPermissions.set(requestID, entry);
  };

  const stopPermissionTimer = (event) => {
    const properties = event.properties ?? {};
    const requestID =
      properties.requestID || properties.permissionID || properties.id;

    if (!requestID) return;

    const pending = pendingPermissions.get(requestID);
    if (!pending) return;

    if (pending.timeout) cancel(pending.timeout);
    pending.controller?.abort();
    pendingPermissions.delete(requestID);
  };

  const startQuestionTimer = (event) => {
    const properties = event.properties ?? {};
    const requestID = properties.id;

    if (!requestID) return;

    const previous = pendingQuestions.get(requestID);
    if (previous?.timeout) cancel(previous.timeout);
    if (previous?.controller) return;

    const questions = Array.isArray(properties.questions)
      ? properties.questions
      : [];
    const entry = {
      requestID,
      delayMs: questionDelayMs,
      sessionID: readSessionID(properties) || "unknown",
      sessionName: readSessionName(properties),
      questions,
      questionCount: questions.length,
      headers: questions
        .map((question) => question?.header)
        .filter(
          (header) => typeof header === "string" && header.trim().length > 0,
        )
        .slice(0, 3),
      timeout: null,
      controller: null,
    };

    entry.timeout = schedule(async () => {
      const pending = pendingQuestions.get(requestID);
      if (!pending || pending.controller) return;

      pending.timeout = null;
      pending.controller = new AbortController();
      await handleQuestionRequest(pending);
    }, questionDelayMs);

    pendingQuestions.set(requestID, entry);
  };

  const stopQuestionTimer = (event) => {
    const properties = event.properties ?? {};
    const requestID = properties.requestID || properties.questionID;

    if (!requestID) return;

    const pending = pendingQuestions.get(requestID);
    if (!pending) return;

    if (pending.timeout) cancel(pending.timeout);
    pending.controller?.abort();
    pendingQuestions.delete(requestID);
  };

  const cleanupSessionPendingInputs = (event) => {
    const sessionID = event.properties?.sessionID;
    if (!sessionID) return;

    for (const [requestID, pending] of pendingPermissions.entries()) {
      if (pending.sessionID !== sessionID) continue;
      if (pending.timeout) cancel(pending.timeout);
      pending.controller?.abort();
      pendingPermissions.delete(requestID);
    }

    for (const [requestID, pending] of pendingQuestions.entries()) {
      if (pending.sessionID !== sessionID) continue;
      if (pending.timeout) cancel(pending.timeout);
      pending.controller?.abort();
      pendingQuestions.delete(requestID);
    }
  };

  const handlePermissionRequest = async (pending) => {
    const title = `Approval pending > ${formatDuration(approvalDelayMs)}`;
    const lines = [
      `session: ${formatSessionLabel(pending.sessionID, pending.sessionName)}`,
      `permission: ${pending.permission || "unknown"}`,
      `patterns: ${pending.patterns.length > 0 ? pending.patterns.join(", ") : "none"}`,
    ];

    try {
      const result = await ask(
        [`[OpenCode] ${title}`, ...lines, "Select action:"].join("\n"),
        ["allow once", "allow always", "deny"],
        pending.controller.signal,
      );

      if (!isPendingRequestActive(pendingPermissions, pending.requestID, pending)) {
        return;
      }

      const reply =
        result.selected === "allow once"
          ? "once"
          : result.selected === "allow always"
            ? "always"
            : "reject";

      await client.permission.reply({
        requestID: pending.requestID,
        reply,
      });
      pendingPermissions.delete(pending.requestID);
    } catch (error) {
      if (isCancellationError(error)) {
        return;
      }

      await log(
        "warn",
        "Failed to resolve permission through nonotify ask(). Falling back to alert.",
        {
          error: String(error),
          requestID: pending.requestID,
        },
      );
      pendingPermissions.delete(pending.requestID);
      await sendNotification(title, lines);
    }
  };

  const handleQuestionRequest = async (pending) => {
    const title = `Question pending > ${formatDuration(questionDelayMs)}`;
    const lines = [
      `session: ${formatSessionLabel(pending.sessionID, pending.sessionName)}`,
      `questions: ${pending.questionCount}`,
      `headers: ${pending.headers.length > 0 ? pending.headers.join(" | ") : "none"}`,
    ];

    try {
      if (!isSupportedQuestionRequest(pending.questions)) {
        throw new Error("Question request is not supported by Telegram single-choice flow.");
      }

      const answers = [];

      for (let index = 0; index < pending.questions.length; index += 1) {
        if (!isPendingRequestActive(pendingQuestions, pending.requestID, pending)) {
          return;
        }

        const question = pending.questions[index];
        const labels = extractQuestionLabels(question);

        if (!labels) {
          throw new Error("Question request is not supported by Telegram single-choice flow.");
        }

        const answer = question.multiple
          ? await askMultiSelectQuestion(pending, question, index)
          : [await askQuestionPage(buildQuestionPrompt(pending, question, index), labels, pending.controller.signal)];
        answers.push(answer);
      }

      if (!isPendingRequestActive(pendingQuestions, pending.requestID, pending)) {
        return;
      }

      await client.question.reply({
        requestID: pending.requestID,
        answers,
      });
      pendingQuestions.delete(pending.requestID);
    } catch (error) {
      if (isCancellationError(error)) {
        return;
      }

      await log(
        "warn",
        "Failed to resolve question through nonotify ask(). Falling back to alert.",
        {
          error: String(error),
          requestID: pending.requestID,
        },
      );
      pendingQuestions.delete(pending.requestID);
      await sendNotification(title, lines);
    }
  };

  const askQuestionPage = async (message, labels, signal, extraButtons = []) => {
    const selected = await askPagedOptions(
      message,
      labels,
      extraButtons,
      signal,
    );
    return selected;
  };

  const askMultiSelectQuestion = async (pending, question, index) => {
    const selected = [];
    let remaining = extractQuestionLabels(question);

    if (!remaining) {
      throw new Error("Question request is not supported by Telegram single-choice flow.");
    }

    while (remaining.length > 0) {
      const message = buildQuestionPrompt(pending, question, index, selected);
      const finishLabel = createUniqueServiceLabel(
        FINISH_SELECTION_LABEL,
        remaining,
      );
      const choice = await askPagedOptions(
        message,
        remaining,
        [finishLabel],
        pending.controller.signal,
      );

      if (choice === finishLabel) {
        return selected;
      }

      selected.push(choice);
      remaining = remaining.filter((option) => option !== choice);
    }

    return selected;
  };

  const askPagedOptions = async (message, labels, extraButtons, signal) => {
    if (labels.length === 0) {
      throw new Error("Question must contain at least one option.");
    }

    let page = 0;
    const nextPageLabel = createUniqueServiceLabel(
      NEXT_PAGE_LABEL,
      labels,
      extraButtons,
    );
    const pageSize = extraButtons.length === 0 ? 9 : 8;

    while (true) {
      const start = page * pageSize;
      const pageItems = labels.slice(start, start + pageSize);
      const hasMorePages = start + pageSize < labels.length;
      const pageButtons = hasMorePages
        ? [...pageItems, nextPageLabel, ...extraButtons]
        : [...pageItems, ...extraButtons];
      const pageMessage = hasMorePages
        ? `${message}\nPage ${page + 1}/${Math.ceil(labels.length / pageSize)}`
        : message;
      const result = await ask(pageMessage, pageButtons, signal);

      if (result.selected === nextPageLabel) {
        page += 1;

        if (page * pageSize >= labels.length) {
          page = 0;
        }

        continue;
      }

      return result.selected;
    }
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
    },
    event: async ({ event }) => {
      switch (event.type) {
        case "permission.asked":
        case "permission.updated":
          startPermissionTimer(event);
          return;
        case "permission.replied":
          stopPermissionTimer(event);
          return;
        case "question.asked":
          startQuestionTimer(event);
          return;
        case "question.replied":
        case "question.rejected":
          stopQuestionTimer(event);
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

function isPendingRequestActive(store, requestID, entry) {
  return store.get(requestID) === entry && !entry.controller.signal.aborted;
}

function isCancellationError(error) {
  return (
    error instanceof Error &&
    (error.name === "AskAbortedError" || error.name === "AbortError")
  );
}

function isSupportedQuestionRequest(questions) {
  return (
    Array.isArray(questions) &&
    questions.length > 0 &&
    questions.every(isSupportedQuestion)
  );
}

function isSupportedQuestion(question) {
  if (!question || typeof question !== "object") return false;
  if (question.custom) return false;

  return extractQuestionLabels(question) !== null;
}

function extractQuestionLabels(question) {
  if (!Array.isArray(question?.options)) return null;

  const labels = [];

  for (const option of question.options) {
    if (typeof option?.label !== "string") {
      return null;
    }

    const label = option.label.trim();

    if (label.length === 0) {
      return null;
    }

    labels.push(label);
  }

  if (labels.length === 0 || new Set(labels).size !== labels.length) {
    return null;
  }

  return labels;
}

function buildQuestionPrompt(pending, question, index, selected = []) {
  const lines = [
    `[OpenCode] Question pending > ${formatDuration(pending.delayMs)}`,
    `session: ${formatSessionLabel(pending.sessionID, pending.sessionName)}`,
    `question: ${index + 1}/${pending.questions.length}`,
  ];

  if (typeof question.header === "string" && question.header.trim().length > 0) {
    lines.push(`header: ${question.header.trim()}`);
  }

  if (typeof question.question === "string" && question.question.trim().length > 0) {
    lines.push(question.question.trim());
  }

  if (question.multiple) {
    lines.push(
      selected.length > 0
        ? `Selected: ${selected.join(", ")}`
        : "Select one option at a time, then press \"Завершить выбор\".",
    );
  }

  return lines.join("\n");
}

function createUniqueServiceLabel(baseLabel, ...labelSets) {
  const existing = new Set(labelSets.flat());
  let candidate = baseLabel;
  let suffix = 2;

  while (existing.has(candidate)) {
    candidate = `${baseLabel} ${suffix}`;
    suffix += 1;
  }

  return candidate;
}

export const NonotifyOpencodePlugin = async (input) => {
  return createNonotifyOpencodeHooks(input);
};

export default NonotifyOpencodePlugin;
