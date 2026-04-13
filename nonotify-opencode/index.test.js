import assert from "node:assert/strict";
import test from "node:test";
import { createNonotifyOpencodeHooks } from "./index.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createClient(logCalls, replies = {}) {
  replies.permissions ??= [];
  replies.questions ??= [];
  replies.rejections ??= [];

  return {
    app: {
      log: async (entry) => {
        logCalls.push(entry);
      },
    },
    permission: {
      reply: async (payload) => {
        replies.permissions.push(payload);
      },
    },
    question: {
      reply: async (payload) => {
        replies.questions.push(payload);
      },
      reject: async (payload) => {
        replies.rejections.push(payload);
      },
    },
  };
}

test("replies once to pending permission through ask()", async () => {
  const logs = [];
  const replies = {};
  const askCalls = [];
  const notifier = {
    ask: async (payload) => {
      askCalls.push(payload);
      return { selected: "allow once" };
    },
    send: async () => {
      throw new Error("send should not be used");
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs, replies) },
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

  assert.equal(askCalls.length, 1);
  assert.equal(askCalls[0].profile, "important");
  assert.deepEqual(askCalls[0].options, [
    "allow once",
    "allow always",
    "deny",
  ]);
  assert.deepEqual(replies.permissions, [{ requestID: "req-1", reply: "once" }]);
  assert.equal(logs.length, 0);
});

test("maps allow always to permission reply always", async () => {
  const logs = [];
  const replies = {};
  const notifier = {
    ask: async () => ({ selected: "allow always" }),
    send: async () => {
      throw new Error("send should not be used");
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs, replies) },
    { notifier, approvalDelayMs: 20 },
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

  await sleep(50);

  assert.deepEqual(replies.permissions, [
    { requestID: "req-1", reply: "always" },
  ]);
  assert.equal(logs.length, 0);
});

test("maps deny to permission reply reject", async () => {
  const logs = [];
  const replies = {};
  const notifier = {
    ask: async () => ({ selected: "deny" }),
    send: async () => {
      throw new Error("send should not be used");
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs, replies) },
    { notifier, approvalDelayMs: 20 },
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

  await sleep(50);

  assert.deepEqual(replies.permissions, [
    { requestID: "req-1", reply: "reject" },
  ]);
  assert.equal(logs.length, 0);
});

test("replies to single-choice question through ask()", async () => {
  const logs = [];
  const replies = {};
  const askCalls = [];
  const notifier = {
    ask: async (payload) => {
      askCalls.push(payload);
      return { selected: "Option B" };
    },
    send: async () => {
      throw new Error("send should not be used");
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs, replies) },
    { notifier, questionDelayMs: 20 },
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

  assert.equal(askCalls.length, 1);
  assert.match(askCalls[0].message, /Need decision/);
  assert.deepEqual(replies.questions, [
    { requestID: "question-1", answers: [["Option B"]] },
  ]);
  assert.equal(logs.length, 0);
});

test("supports multi-select questions through sequential ask() calls", async () => {
  const logs = [];
  const replies = {};
  const askCalls = [];
  const answers = ["Option A", "Option C", "Завершить выбор"];
  const notifier = {
    ask: async (payload) => {
      askCalls.push(payload);
      return { selected: answers.shift() };
    },
    send: async () => {
      throw new Error("send should not be used");
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs, replies) },
    { notifier, questionDelayMs: 20 },
  );

  await hooks.event({
    event: {
      type: "question.asked",
      properties: {
        id: "question-1",
        sessionID: "session-1",
        questions: [
          {
            header: "Pick several",
            question: "Select everything that applies",
            multiple: true,
            options: [
              { label: "Option A", description: "Pick A" },
              { label: "Option B", description: "Pick B" },
              { label: "Option C", description: "Pick C" },
            ],
          },
        ],
      },
    },
  });

  await sleep(80);

  assert.equal(askCalls.length, 3);
  assert.deepEqual(askCalls[0].options, [
    "Option A",
    "Option B",
    "Option C",
    "Завершить выбор",
  ]);
  assert.deepEqual(askCalls[1].options, [
    "Option B",
    "Option C",
    "Завершить выбор",
  ]);
  assert.match(askCalls[1].message, /Selected: Option A/);
  assert.deepEqual(replies.questions, [
    {
      requestID: "question-1",
      answers: [["Option A", "Option C"]],
    },
  ]);
  assert.equal(logs.length, 0);
});

test("supports multiple questions in one request", async () => {
  const logs = [];
  const replies = {};
  const answers = ["Option B", "Second A", "Завершить выбор"];
  const notifier = {
    ask: async () => ({ selected: answers.shift() }),
    send: async () => {
      throw new Error("send should not be used");
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs, replies) },
    { notifier, questionDelayMs: 20 },
  );

  await hooks.event({
    event: {
      type: "question.asked",
      properties: {
        id: "question-1",
        sessionID: "session-1",
        questions: [
          {
            header: "Pick one",
            question: "First question",
            options: [
              { label: "Option A", description: "Pick A" },
              { label: "Option B", description: "Pick B" },
            ],
          },
          {
            header: "Pick many",
            question: "Second question",
            multiple: true,
            options: [
              { label: "Second A", description: "Pick A" },
              { label: "Second B", description: "Pick B" },
            ],
          },
        ],
      },
    },
  });

  await sleep(80);

  assert.deepEqual(replies.questions, [
    {
      requestID: "question-1",
      answers: [["Option B"], ["Second A"]],
    },
  ]);
  assert.equal(logs.length, 0);
});

test("ignores ask() result after permission was answered in UI", async () => {
  const logs = [];
  const replies = {};
  let resolveAsk;
  const notifier = {
    ask: (payload) =>
      new Promise((resolve, reject) => {
        resolveAsk = () => resolve({ selected: "allow once" });
        payload.signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AskAbortedError" })),
          { once: true },
        );
      }),
    send: async () => {
      throw new Error("send should not be used");
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs, replies) },
    { notifier, approvalDelayMs: 20 },
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

  await sleep(30);

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

  resolveAsk?.();
  await sleep(20);

  assert.deepEqual(replies.permissions, []);
  assert.equal(logs.length, 0);
});

test("falls back to notification when ask() is unavailable", async () => {
  const sent = [];
  const logs = [];
  const replies = {};
  const notifier = {
    send: async (payload) => {
      sent.push(payload);
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs, replies) },
    { notifier, approvalDelayMs: 20, readProfile: () => "important" },
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

  await sleep(50);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].profile, "important");
  assert.match(sent[0].message, /Approval pending >/);
  assert.equal(replies.permissions.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0].body.message, /Falling back to alert/);
});

test("disables fallback notifications after first send failure", async () => {
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
    { notifier, approvalDelayMs: 20 },
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

  await sleep(50);

  await hooks.event({
    event: {
      type: "permission.asked",
      properties: {
        id: "req-2",
        sessionID: "session-2",
        permission: "bash",
      },
    },
  });

  await sleep(50);

  assert.equal(sendCalls, 1);
  assert.equal(logs.length, 3);
  assert.match(logs[0].body.message, /Falling back to alert/);
  assert.match(logs[1].body.message, /Failed to send nonotify alert/);
});

test("clears pending interactive question flow when session is deleted", async () => {
  const logs = [];
  const replies = {};
  let aborted = false;
  const notifier = {
    ask: (payload) =>
      new Promise((resolve, reject) => {
        payload.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(Object.assign(new Error("aborted"), { name: "AskAbortedError" }));
          },
          { once: true },
        );
        setTimeout(() => resolve({ selected: "Option A" }), 100);
      }),
    send: async () => {
      throw new Error("send should not be used");
    },
  };

  const hooks = await createNonotifyOpencodeHooks(
    { client: createClient(logs, replies) },
    { notifier, questionDelayMs: 20 },
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

  await sleep(30);

  await hooks.event({
    event: {
      type: "session.deleted",
      properties: {
        sessionID: "session-1",
      },
    },
  });

  await sleep(20);

  assert.equal(aborted, true);
  assert.deepEqual(replies.questions, []);
  assert.equal(logs.length, 0);
});
