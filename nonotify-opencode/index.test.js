import assert from "node:assert/strict";
import test from "node:test";
import { createNonotifyOpencodeHooks } from "./index.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createClient(logCalls) {
  return {
    app: {
      log: async (entry) => {
        logCalls.push(entry);
      },
    },
  };
}

test("sends notification when permission is pending longer than threshold", async () => {
  const sent = [];
  const logs = [];
  const notifier = {
    send: async (payload) => {
      sent.push(payload);
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs) },
    {
      notifier,
      approvalDelayMs: 20,
      readProfile: () => "important",
    },
  );

  await hooks.event({
    event: {
      type: "permission.asked",
      properties: {
        id: "req-1",
        sessionID: "session-1",
        permission: "bash",
        patterns: ["*.env"],
      },
    },
  });

  await sleep(50);

  assert.equal(sent.length, 1);
  assert.equal(logs.length, 0);
  assert.equal(sent[0].profile, "important");
  assert.match(sent[0].message, /Approval pending >/);
  assert.match(sent[0].message, /session: session-1/);
});

test("uses profile configured in opencode config", async () => {
  const sent = [];
  const logs = [];
  const notifier = {
    send: async (payload) => {
      sent.push(payload);
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs) },
    {
      notifier,
      approvalDelayMs: 20,
      readProfile: () => "from-env",
    },
  );

  await hooks.config({
    "nonotify-opencode": {
      profile: "important",
    },
  });

  await hooks.event({
    event: {
      type: "permission.asked",
      properties: {
        id: "req-1",
        sessionID: "session-1",
        permission: "bash",
      },
    },
  });

  await sleep(50);

  assert.equal(sent.length, 1);
  assert.equal(logs.length, 0);
  assert.equal(sent[0].profile, "important");
});

test("uses timing values from opencode config (seconds)", async () => {
  const sent = [];
  const logs = [];
  const notifier = {
    send: async (payload) => {
      sent.push(payload);
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs) },
    {
      notifier,
    },
  );

  await hooks.config({
    "nonotify-opencode": {
      approvalDelaySeconds: 0.02,
      questionDelaySeconds: 0.02,
      longReplyThresholdSeconds: 5,
      activityDelaySeconds: 0.02,
    },
  });

  await hooks.event({
    event: {
      type: "permission.asked",
      properties: {
        id: "req-1",
        sessionID: "session-1",
        permission: "bash",
      },
    },
  });

  await sleep(50);

  assert.equal(sent.length, 1);
  assert.equal(logs.length, 0);
});

test("uses long reply and activity delays from opencode config (seconds)", async () => {
  const sent = [];
  const logs = [];
  const notifier = {
    send: async (payload) => {
      sent.push(payload);
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs) },
    {
      notifier,
    },
  );

  await hooks.config({
    "nonotify-opencode": {
      longReplyThresholdSeconds: 5,
      activityDelaySeconds: 0.02,
    },
  });

  await hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          role: "assistant",
          sessionID: "session-1",
          agent: "general",
          time: {
            created: 1_000,
            completed: 10_000,
          },
        },
      },
    },
  });

  await sleep(10);
  assert.equal(sent.length, 0);

  await sleep(50);
  assert.equal(sent.length, 1);
  assert.equal(logs.length, 0);
});

test("does not send pending notification if permission is replied", async () => {
  const sent = [];
  const logs = [];
  const notifier = {
    send: async (payload) => {
      sent.push(payload);
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs) },
    { notifier, approvalDelayMs: 25 },
  );

  await hooks.event({
    event: {
      type: "permission.asked",
      properties: {
        id: "req-1",
        sessionID: "session-1",
        permission: "bash",
      },
    },
  });

  await hooks.event({
    event: {
      type: "permission.replied",
      properties: {
        sessionID: "session-1",
        requestID: "req-1",
        reply: "once",
      },
    },
  });

  await sleep(50);

  assert.equal(sent.length, 0);
  assert.equal(logs.length, 0);
});

test("sends notification when question is pending longer than threshold", async () => {
  const sent = [];
  const logs = [];
  const notifier = {
    send: async (payload) => {
      sent.push(payload);
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs) },
    {
      notifier,
      questionDelayMs: 20,
    },
  );

  await hooks.event({
    event: {
      type: "question.asked",
      properties: {
        id: "question-1",
        sessionID: "session-1",
        questions: [
          {
            header: "Need decision",
            question: "What should we do?",
            options: [
              { label: "Option A", description: "Pick A" },
              { label: "Option B", description: "Pick B" },
            ],
          },
        ],
      },
    },
  });

  await sleep(50);

  assert.equal(sent.length, 1);
  assert.equal(logs.length, 0);
  assert.match(sent[0].message, /Question pending >/);
  assert.match(sent[0].message, /session: session-1/);
  assert.match(sent[0].message, /headers: Need decision/);
});

test("does not send question notification if question is replied", async () => {
  const sent = [];
  const logs = [];
  const notifier = {
    send: async (payload) => {
      sent.push(payload);
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs) },
    {
      notifier,
      questionDelayMs: 25,
    },
  );

  await hooks.event({
    event: {
      type: "question.asked",
      properties: {
        id: "question-1",
        sessionID: "session-1",
        questions: [
          {
            header: "Need decision",
            question: "What should we do?",
            options: [{ label: "Option A", description: "Pick A" }],
          },
        ],
      },
    },
  });

  await hooks.event({
    event: {
      type: "question.replied",
      properties: {
        sessionID: "session-1",
        requestID: "question-1",
        answers: [["Option A"]],
      },
    },
  });

  await sleep(50);

  assert.equal(sent.length, 0);
  assert.equal(logs.length, 0);
});

test("sends one notification for long assistant reply", async () => {
  const sent = [];
  const logs = [];
  const notifier = {
    send: async (payload) => {
      sent.push(payload);
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs) },
    { notifier, longReplyMs: 5_000, longReplyNotifyDelayMs: 20 },
  );

  const longReplyEvent = {
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          role: "assistant",
          sessionID: "session-1",
          agent: "general",
          time: {
            created: 1000,
            completed: 10_000,
          },
        },
      },
    },
  };

  await hooks.event(longReplyEvent);

  assert.equal(sent.length, 0);

  await sleep(50);

  await hooks.event(longReplyEvent);
  await sleep(10);

  assert.equal(sent.length, 1);
  assert.equal(logs.length, 0);
  assert.match(sent[0].message, /Long reply completed/);
  assert.match(sent[0].message, /duration: 0m 9s/);
});

test("does not notify about long reply if user became active", async () => {
  const sent = [];
  const logs = [];
  const notifier = {
    send: async (payload) => {
      sent.push(payload);
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs) },
    { notifier, longReplyMs: 5_000, longReplyNotifyDelayMs: 30 },
  );

  await hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          role: "assistant",
          sessionID: "session-1",
          agent: "general",
          time: {
            created: 0,
            completed: 10_000,
          },
        },
      },
    },
  });

  await sleep(10);

  await hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "user-1",
          role: "user",
          sessionID: "session-1",
          time: {
            created: 12_000,
            completed: 12_000,
          },
        },
      },
    },
  });

  await sleep(50);

  assert.equal(sent.length, 0);
  assert.equal(logs.length, 0);
});

test("disables notifications after first send failure", async () => {
  const logs = [];
  let sendCalls = 0;
  const notifier = {
    send: async () => {
      sendCalls += 1;
      throw new Error("boom");
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs) },
    { notifier, longReplyMs: 5_000, longReplyNotifyDelayMs: 5 },
  );

  await hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          role: "assistant",
          sessionID: "session-1",
          agent: "general",
          time: {
            created: 0,
            completed: 10_000,
          },
        },
      },
    },
  });

  await sleep(25);

  await hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "message-2",
          role: "assistant",
          sessionID: "session-1",
          agent: "general",
          time: {
            created: 1_000,
            completed: 11_000,
          },
        },
      },
    },
  });

  await sleep(25);

  assert.equal(sendCalls, 1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].body.level, "warn");
  assert.match(logs[0].body.message, /Failed to send nonotify alert/);
});

test("clears pending permission timers when session is deleted", async () => {
  const sent = [];
  const logs = [];
  const notifier = {
    send: async (payload) => {
      sent.push(payload);
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs) },
    { notifier, approvalDelayMs: 25 },
  );

  await hooks.event({
    event: {
      type: "permission.asked",
      properties: {
        id: "req-1",
        sessionID: "session-1",
        permission: "bash",
      },
    },
  });

  await hooks.event({
    event: {
      type: "session.deleted",
      properties: {
        sessionID: "session-1",
      },
    },
  });

  await sleep(50);

  assert.equal(sent.length, 0);
  assert.equal(logs.length, 0);
});

test("clears pending question timers when session is deleted", async () => {
  const sent = [];
  const logs = [];
  const notifier = {
    send: async (payload) => {
      sent.push(payload);
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs) },
    { notifier, questionDelayMs: 25 },
  );

  await hooks.event({
    event: {
      type: "question.asked",
      properties: {
        id: "question-1",
        sessionID: "session-1",
        questions: [
          {
            header: "Need decision",
            question: "What should we do?",
            options: [{ label: "Option A", description: "Pick A" }],
          },
        ],
      },
    },
  });

  await hooks.event({
    event: {
      type: "session.deleted",
      properties: {
        sessionID: "session-1",
      },
    },
  });

  await sleep(50);

  assert.equal(sent.length, 0);
  assert.equal(logs.length, 0);
});
