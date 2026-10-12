import assert from "node:assert/strict";
import test from "node:test";
import { connectChartStream } from "../src/lib/market/market-stream.ts";

test("limited or disconnected stream retries, resumes, and ignores prior socket callbacks", () => {
  const sockets = [],
    pending = new Map();
  let timerId = 0;
  let messages = 0,
    resumes = 0;
  const factory = (url) => {
    const socket = {
      url,
      close() {
        this.onclose?.({ code: 1000 });
      },
    };
    sockets.push(socket);
    return socket;
  };
  const timers = {
    schedule: (fn, delay) => {
      pending.set(++timerId, { fn, delay });
      return timerId;
    },
    cancel: (id) => pending.delete(id),
  };
  const stop = connectChartStream(
    "ws://fixture",
    { message: () => messages++, resumed: () => resumes++ },
    factory,
    timers,
  );
  const old = sockets[0];
  old.onopen();
  old.onmessage({ data: "first" });
  assert.equal(messages, 1);
  old.onclose({ code: 1013 });
  assert.equal(pending.get(1).delay, 1000);
  old.onmessage({ data: "stale" });
  assert.equal(messages, 1);
  pending.get(1).fn();
  const current = sockets[1];
  current.onopen();
  assert.equal(resumes, 1);
  old.onclose({ code: 1000 });
  old.onmessage({ data: "stale" });
  assert.equal(messages, 1);
  current.onmessage({ data: "current" });
  assert.equal(messages, 2);
  stop();
  current.onmessage({ data: "disposed" });
  assert.equal(messages, 2);
});

test("identity disposal cancels pending reconnect; provider policy failure does not retry", () => {
  const sockets = [],
    pending = new Map();
  let next = 0;
  const factory = () => {
    const socket = {
      close() {
        this.onclose?.({ code: 1000 });
      },
    };
    sockets.push(socket);
    return socket;
  };
  const timers = {
    schedule: (fn) => {
      pending.set(++next, fn);
      return next;
    },
    cancel: (id) => pending.delete(id),
  };
  const stop = connectChartStream(
    "ws://fixture",
    { message() {} },
    factory,
    timers,
  );
  sockets[0].onclose({ code: 1000 });
  assert.equal(pending.size, 1);
  const delayed = pending.get(1);
  stop();
  assert.equal(pending.size, 0);
  delayed();
  assert.equal(sockets.length, 1);
  connectChartStream("ws://fixture", { message() {} }, factory, timers);
  sockets[1].onclose({ code: 1008 });
  assert.equal(pending.size, 0);
});

test("accepted-but-limited connections retain bounded exponential backoff", () => {
  const sockets = [],
    scheduled = [];
  const factory = () => {
    const socket = { close() {} };
    sockets.push(socket);
    return socket;
  };
  const timers = {
    schedule: (fn, delay) => {
      scheduled.push({ fn, delay });
      return scheduled.length;
    },
    cancel() {},
  };
  const stop = connectChartStream(
    "ws://fixture",
    { message() {} },
    factory,
    timers,
  );
  for (let i = 0; i < 6; i++) {
    sockets.at(-1).onopen();
    sockets.at(-1).onclose({ code: 1013 });
    if (i < 5) scheduled.at(-1).fn();
  }
  assert.deepEqual(
    scheduled.map((x) => x.delay),
    [1000, 2000, 4000, 8000, 10000, 10000],
  );
  stop();
});
