// noinspection JSUnusedLocalSymbols,JSUnusedGlobalSymbols
/* eslint-disable @typescript-eslint/no-unused-vars,@typescript-eslint/no-unsafe-member-access */

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { AutoSubscribe } from "../autoSubscribe";
import { createMessageBus } from "../messageBus";
import { createTopic, createUnicastTopic } from "../topic";

const waitForPromisesAndFakeTimers = async (): Promise<void> => {
  do {
    await vi.runAllTimersAsync();
  } while (vi.getTimerCount() > 0);
};

describe("MessageBus", () => {
  let messageBus = createMessageBus();
  let consoleErrorSpy: MockInstance<typeof console.error> | undefined;

  const TestTopic = createTopic<string>("Test");

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();

    if (consoleErrorSpy) {
      consoleErrorSpy.mockRestore();
      consoleErrorSpy = undefined;
    }

    messageBus.dispose();
    messageBus = createMessageBus();
  });

  it("should publish a message", async () => {
    const handler = vi.fn(() => {});
    messageBus.subscribe(TestTopic, handler);

    messageBus.publish(TestTopic, "it works");
    await waitForPromisesAndFakeTimers();

    expect(handler).toHaveBeenCalledExactlyOnceWith("it works");
  });

  it("should publish a void message", async () => {
    const VoidTopic = createTopic("Ping");
    const handler = vi.fn(() => {});
    messageBus.subscribe(VoidTopic, handler);

    messageBus.publish(VoidTopic);
    await waitForPromisesAndFakeTimers();

    expect(handler).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("should dispose subscription", async () => {
    const handler = vi.fn(() => {});
    messageBus.subscribe(TestTopic, handler).dispose();

    messageBus.publish(TestTopic, "it works");
    await waitForPromisesAndFakeTimers();

    expect(handler).toHaveBeenCalledTimes(0);
  });

  it("should subscribe via @AutoSubscribe", async () => {
    @AutoSubscribe(() => messageBus)
    class Example {
      data?: string;

      onTestTopic(@TestTopic() data: string): void {
        this.data = data;
      }
    }

    const example = new Example();

    messageBus.publish(TestTopic, "it works");
    await waitForPromisesAndFakeTimers();

    expect(example.data).toBe("it works");
  });

  it("should subscribe to multiple topics", async () => {
    const StringTopic = createTopic<string>("StringTopic");
    const NumberTopic = createTopic<number>("NumberTopic");

    const handler = vi.fn((_data) => {});
    const subscription = messageBus.subscribe([StringTopic, NumberTopic], handler);

    messageBus.publish(StringTopic, "a string");
    await waitForPromisesAndFakeTimers();

    messageBus.publish(NumberTopic, 99);
    await waitForPromisesAndFakeTimers();

    // Verify all topic subscriptions are removed
    subscription.dispose();

    messageBus.publish(StringTopic, "another string");
    await waitForPromisesAndFakeTimers();

    messageBus.publish(NumberTopic, 10);
    await waitForPromisesAndFakeTimers();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, "a string");
    expect(handler).toHaveBeenNthCalledWith(2, 99);
  });

  it("should throw if topic decorator is placed on constructor", () => {
    expect(() => {
      class Example {
        constructor(@TestTopic() _data: string) {}
      }
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: [message-bus] decorator for Topic<Test> cannot be used on Example's constructor]`,
    );
  });

  it("should throw if topic decorator is placed on static method", () => {
    expect(() => {
      class Example {
        static onTestTopic(@TestTopic() _data: string): void {}
      }
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: [message-bus] decorator for Topic<Test> cannot be used on static member Example.onTestTopic]`,
    );
  });

  it("should throw if multiple topics per method", () => {
    expect(() => {
      const AnotherTestTopic = createTopic<string>("AnotherTestTopic");
      class Example {
        onTestTopic(@TestTopic() _data1: string, @AnotherTestTopic() _data2: string): void {}
      }
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: [message-bus] only a single topic subscription is allowed on Example.onTestTopic]`,
    );
  });

  it("should intercept unhandled error coming from a message handler", async () => {
    messageBus.subscribe(TestTopic, () => {
      throw new Error("error occurred in handler");
    });

    vi.spyOn(console, "error").mockImplementation((...args: any[]) => {
      expect(args).toHaveLength(2);
      expect(args[0]).toBe("[message-bus] caught unhandled error.");
      expect(String(args[1])).toBe("Error: error occurred in handler");
    });

    // Should not let errors escape, but print to console.error instead
    messageBus.publish(TestTopic, "throws");
    await waitForPromisesAndFakeTimers();
  });

  it("should intercept unhandled errors coming from multiple message handlers", async () => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    messageBus.subscribe(TestTopic, () => {
      throw new Error("error occurred in handler 1");
    });

    messageBus.subscribe(TestTopic, async () => {
      await new Promise((r) => setTimeout(r, 1));
      throw new Error("async error occurred in handler 2");
    });

    // Should not let errors escape, but print to console.error instead
    messageBus.publish(TestTopic, "throws");
    await waitForPromisesAndFakeTimers();

    await vi.waitFor(() => expect(consoleErrorSpy).toHaveBeenCalledTimes(2));
    const msg = "[message-bus] caught unhandled error.";
    expect(consoleErrorSpy).toHaveBeenNthCalledWith(1, msg, new Error("error occurred in handler 1"));
    expect(consoleErrorSpy).toHaveBeenNthCalledWith(2, msg, new Error("async error occurred in handler 2"));
  });

  it("should propagate message to child buses (recursively)", async () => {
    const handler = vi.fn(() => {});
    messageBus.subscribe(TestTopic, handler);

    const childBus1 = messageBus.createChildBus();
    const childHandler1 = vi.fn(() => {});
    childBus1.subscribe(TestTopic, childHandler1);

    const childBus2 = messageBus.createChildBus();
    const childHandler2 = vi.fn(() => {});
    childBus2.subscribe(TestTopic, childHandler2);

    const childBus3 = childBus2.createChildBus();
    const childHandler3 = vi.fn(() => {});
    childBus3.subscribe(TestTopic, childHandler3);

    messageBus.publish(TestTopic, "it works");
    await waitForPromisesAndFakeTimers();

    expect(handler).toHaveBeenCalledExactlyOnceWith("it works");
    expect(childHandler1).toHaveBeenCalledExactlyOnceWith("it works");
    expect(childHandler2).toHaveBeenCalledExactlyOnceWith("it works");
    expect(childHandler3).toHaveBeenCalledExactlyOnceWith("it works");
    expect(childHandler1).toHaveBeenCalledAfter(handler);
    expect(childHandler2).toHaveBeenCalledAfter(handler);
    expect(childHandler3).toHaveBeenCalledAfter(childHandler1);
    expect(childHandler3).toHaveBeenCalledAfter(childHandler2);
  });

  it("should propagate message to parent bus (not recursively)", async () => {
    const ParentTestTopic = createTopic<string>("ParentTestTopic", { broadcastDirection: "parent" });
    const handler = vi.fn(() => {});
    messageBus.subscribe(ParentTestTopic, handler);

    const childBus = messageBus.createChildBus();
    const childHandler = vi.fn(() => {});
    childBus.subscribe(ParentTestTopic, childHandler);

    const childBus2 = childBus.createChildBus();
    const childHandler2 = vi.fn(() => {});
    childBus2.subscribe(ParentTestTopic, childHandler2);

    childBus2.publish(ParentTestTopic, "it works");
    await waitForPromisesAndFakeTimers();

    expect(childHandler2).toHaveBeenCalledExactlyOnceWith("it works");
    expect(childHandler).toHaveBeenCalledExactlyOnceWith("it works");
    expect(childHandler).toHaveBeenCalledAfter(childHandler2);
    expect(handler).toHaveBeenCalledTimes(0);
  });

  it("should receive messages asynchronously", async () => {
    vi.useRealTimers();

    let str = "";
    const subscription = messageBus.subscribe(TestTopic);
    const iterations = (async () => {
      let i = 0;

      for await (const message of subscription) {
        str += message;

        if (++i === 3) {
          subscription.dispose();
          break;
        }
      }
    })();

    messageBus.publish(TestTopic, "one");
    messageBus.publish(TestTopic, "two");
    messageBus.publish(TestTopic, "three");

    await iterations;

    // noinspection SpellCheckingInspection
    expect(str).toBe("onetwothree");
    expect((subscription as any).isDisposed).toBe(true);
  });

  it("should await single messages", async () => {
    vi.useRealTimers();

    let str = "";
    const subscription = messageBus.subscribe(TestTopic);
    const singles = (async () => {
      str += await subscription.single();
      str += await subscription.single();
      subscription.dispose();
    })();

    messageBus.publish(TestTopic, "one");
    messageBus.publish(TestTopic, "two");
    await singles;

    // noinspection SpellCheckingInspection
    expect(str).toBe("onetwo");
    expect((subscription as any).isDisposed).toBe(true);
  });

  it("should consider subscription priority", async () => {
    const handler1 = vi.fn(() => {});
    messageBus.withPriority(2).subscribe(TestTopic, handler1);

    const handler2 = vi.fn(() => {});
    messageBus.subscribe(TestTopic, handler2);

    const handler3 = vi.fn(() => {});
    messageBus.withPriority(0).subscribe(TestTopic, handler3);

    messageBus.publish(TestTopic, "one");
    await waitForPromisesAndFakeTimers();

    expect(handler2).toHaveBeenCalledBefore(handler1);
    expect(handler3).toHaveBeenCalledBefore(handler1);
    expect(handler3).toHaveBeenCalledBefore(handler2);
  });

  it("should listen to topic messages", async () => {
    const listener = vi.fn((_topic, _data, _count) => {});
    messageBus.addListener(listener);

    const childBus = messageBus.createChildBus();
    const childListener = vi.fn((_topic, _data) => {});
    childBus.addListener(childListener);

    messageBus.publish(TestTopic, "three");
    await waitForPromisesAndFakeTimers();

    messageBus.publish(TestTopic, "four");
    await waitForPromisesAndFakeTimers();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, TestTopic, "three", 0);
    expect(listener).toHaveBeenNthCalledWith(2, TestTopic, "four", 0);

    // Only listeners added to the bus where publish() is invoked must be notified.
    // Listeners of child buses must not be notified.
    expect(childListener).toHaveBeenCalledTimes(0);

    // Remove the listener and publish() again
    listener.mockClear();
    messageBus.removeListener(listener);

    messageBus.publish(TestTopic, "five");
    await waitForPromisesAndFakeTimers();

    expect(listener).toHaveBeenCalledTimes(0);
    expect(childListener).toHaveBeenCalledTimes(0);
  });

  it("should copy listeners from parent bus", async () => {
    const listener = vi.fn(() => {});
    messageBus.addListener(listener);
    expect(listener).toHaveBeenCalledTimes(0);

    const childBus = messageBus.createChildBus();
    childBus.publish(TestTopic, "one");
    await waitForPromisesAndFakeTimers();

    expect(listener).toHaveBeenCalledExactlyOnceWith(TestTopic, "one", 0);
  });

  it("should respect the unicast topic subscription limit", () => {
    // No limit
    expect(() => messageBus.subscribe(TestTopic)).not.toThrow();
    expect(() => messageBus.subscribe(TestTopic)).not.toThrow();
    expect(() => messageBus.subscribe(TestTopic)).not.toThrow();

    const UnicastTestTopic = createUnicastTopic("UnicastTest");
    expect(() => messageBus.subscribe(UnicastTestTopic)).not.toThrow();
    expect(() => messageBus.subscribe(UnicastTestTopic)).toThrowErrorMatchingInlineSnapshot(
      `[Error: [message-bus] UnicastTopic<UnicastTest> allows only a single subscription]`,
    );
  });

  it("should publish and await the topic handlers", async () => {
    const CharCountTopic = createTopic<string, number>("CharCount");
    messageBus.subscribe(CharCountTopic, (data) => data.length);
    messageBus.subscribe(CharCountTopic, (data) => data.length * 2);

    const promise = messageBus.publishAsync(CharCountTopic, "one");
    await waitForPromisesAndFakeTimers();

    const counts = await promise;
    expect(counts).toHaveLength(2);
    expect(counts[0]).toBe(3);
    expect(counts[1]).toBe(6);
  });

  it("should publish and await the unicast topic handler", async () => {
    const CharCountTopic = createUnicastTopic<string, number>("CharCount");
    messageBus.subscribe(CharCountTopic, (data) => data.length);

    const promise = messageBus.publishAsync(CharCountTopic, "one");
    await waitForPromisesAndFakeTimers();
    await expect(promise).resolves.toBe(3);
  });

  it("should publish and await a rejected promise with an error from the topic handlers", async () => {
    const CharCountTopic = createTopic<string, number>("CharCount");
    messageBus.subscribe(CharCountTopic, (data) => data.length);
    messageBus.subscribe(CharCountTopic, (data) => {
      throw new Error(`error 1 for ${data}`);
    });

    const promise = messageBus.publishAsync(CharCountTopic, "one");
    await waitForPromisesAndFakeTimers();
    await expect(promise).rejects.toThrowError(new Error("error 1 for one"));
  });

  it("should publish and await a rejected promise with errors from the topic handlers", async () => {
    const CharCountTopic = createTopic<string, number>("CharCount");
    messageBus.subscribe(CharCountTopic, (data) => {
      throw new Error(`error 1 for ${data}`);
    });
    messageBus.subscribe(CharCountTopic, (data) => {
      throw new Error(`error 2 for ${data}`);
    });

    const promise = messageBus.publishAsync(CharCountTopic, "one");
    await waitForPromisesAndFakeTimers();

    await expect(promise).rejects.toThrowError(
      new AggregateError([
        new Error("error 1 for one"), //
        new Error("error 2 for one"),
      ]),
    );
  });

  it("should intercept and modify a message payload", async () => {
    // Handler 1
    messageBus.addInterceptor({
      isVetoed: () => false,
      handler: async (_, handler, data, ...other) => {
        // handler = original subscription handler
        const result = (await handler(data, "Handler1", ...other)) as string;
        return `${result} 1`;
      },
    });

    // Handler 2
    // Will be called first, and will forward to Handler 1
    messageBus.addInterceptor({
      isVetoed: () => false,
      handler: async (_, handler, data) => {
        // handler = Handler 1
        const result = (await handler(data, "Handler2")) as string;
        return `${result} 2`;
      },
    });

    const InterceptedTopic = createTopic<string, string>("Intercepted");
    messageBus.subscribe(InterceptedTopic, (data, handler1: string, handler2: string) => {
      return `${handler1} ${handler2} ${data} 0`;
    });

    const promise = messageBus.publishAsync(InterceptedTopic, "test");
    await waitForPromisesAndFakeTimers();
    await expect(promise).resolves.toEqual(["Handler1 Handler2 test 0 1 2"]);
  });

  it("should throw if the message bus is disposed", () => {
    messageBus.subscribe(TestTopic, () => {});

    // We can call dispose() as many times we want
    messageBus.dispose();
    messageBus.dispose();

    expect(() => messageBus.publish(TestTopic, "it does not work")).toThrowErrorMatchingInlineSnapshot(
      `[Error: [message-bus] the message bus is disposed]`,
    );
  });

  it("should dispose itself and children", () => {
    const childBus = messageBus.createChildBus();
    expect(messageBus.isDisposed).toBe(false);
    expect(childBus.isDisposed).toBe(false);

    messageBus.dispose();

    expect(messageBus.isDisposed).toBe(true);
    expect(childBus.isDisposed).toBe(true);
  });
});
