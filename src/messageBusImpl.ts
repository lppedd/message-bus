import { check, tag } from "./errors";
import { HandlerRegistration } from "./handlerRegistration";
import { LazyAsyncRegistration } from "./lazyAsyncRegistration";
import type {
  ChildMessageBusOptions,
  LazyAsyncSubscription,
  MessageBus,
  MessageBusOptions,
  MessageHandler,
  MessageListener,
  Subscription,
  SubscriptionBuilder,
} from "./messageBus";
import { defaultLimit, defaultPriority, SubscriptionRegistry } from "./registry";
import { SubscriptionBuilderImpl } from "./subscriptionBuilderImpl";
import type { Topic, UnicastTopic } from "./topic";

type Message = {
  readonly topic: Topic;
  readonly data: unknown;
  readonly broadcast?: boolean;
  readonly listeners?: boolean;
  readonly awaitable?: boolean;
};

type MessageResult = {
  readonly values: unknown[];
  readonly errors: unknown[];
};

// @internal
export class MessageBusImpl implements MessageBus {
  private readonly myParent?: MessageBusImpl;
  private readonly myChildren = new Set<MessageBusImpl>();
  private readonly myRegistry = new SubscriptionRegistry();
  private readonly myPublishQueue: (() => void)[] = [];
  private readonly myListeners: Set<MessageListener>;
  private readonly myOptions: Required<MessageBusOptions>;

  private myPublishing: boolean = false;
  private myDisposed: boolean = false;

  constructor(parent?: MessageBusImpl, listeners?: Set<MessageListener>, options?: MessageBusOptions) {
    this.myParent = parent;
    this.myListeners = listeners ?? new Set();
    this.myOptions = {
      // prettier-ignore
      errorHandler: options?.errorHandler ?? ((e) => {
        console.error(tag("caught unhandled error."), e);
      }),
    };
  }

  get isDisposed(): boolean {
    return this.myDisposed;
  }

  createChildBus(options?: ChildMessageBusOptions): MessageBus {
    this.checkDisposed();

    const listeners = options?.copyListeners === false ? undefined : new Set(this.myListeners);
    const childBus = new MessageBusImpl(this, listeners, {
      errorHandler: options?.errorHandler ?? this.myOptions.errorHandler,
    });

    this.myChildren.add(childBus);
    return childBus;
  }

  publish(topic: Topic, data?: unknown): void {
    void this.enqueueMessage({
      topic,
      data,
      broadcast: true,
      listeners: true,
    });
  }

  publishAsync(topic: UnicastTopic, data?: unknown): Promise<unknown>;
  publishAsync(topic: Topic, data?: unknown): Promise<unknown[]>;
  publishAsync(topic: Topic, data?: unknown): Promise<unknown | unknown[]> {
    const result = this.enqueueMessage({
      topic,
      data,
      broadcast: true,
      listeners: true,
      awaitable: true,
    });

    return result.then(({ values, errors }) => {
      if (errors.length > 0) {
        throw errors.length > 1 ? new AggregateError(errors) : errors[0];
      }

      check(values.length > 0, () => `no subscribers for ${topic.toString()}`);
      const isMulticast = topic.mode === "multicast";
      check(isMulticast || values.length === 1, () => `multiple result values for ${topic.toString()}`);
      return isMulticast ? values : values[0];
    });
  }

  subscribe(topic: Topic): LazyAsyncSubscription;
  subscribe(topic: Topic, handler: MessageHandler): Subscription;
  subscribe(topic: Topic[]): LazyAsyncSubscription;
  subscribe(topic: Topic[], handler: MessageHandler): Subscription;
  subscribe(topic: Topic | Topic[], handler?: MessageHandler): Subscription | LazyAsyncSubscription {
    return this.subscribeImpl(topic, handler, defaultLimit, defaultPriority);
  }

  subscribeOnce(topic: Topic): Promise<unknown>;
  subscribeOnce(topic: Topic, handler: MessageHandler): Subscription;
  subscribeOnce(topic: Topic[]): Promise<unknown>;
  subscribeOnce(topic: Topic[], handler: MessageHandler): Subscription;
  subscribeOnce(topic: Topic | Topic[], handler?: MessageHandler): Subscription | Promise<unknown> {
    const subscription = this.subscribeImpl(topic, handler, 1, defaultPriority);
    return subscription instanceof LazyAsyncRegistration
      ? subscription.single().finally(() => subscription.dispose())
      : subscription;
  }

  // @internal
  subscribeImpl(
    topic: Topic | Topic[],
    handler: MessageHandler | undefined,
    limit: number,
    priority: number,
  ): LazyAsyncRegistration | Subscription {
    this.checkDisposed();
    const topics = Array.isArray(topic) ? topic : [topic];
    check(topics.length > 0, "at least one topic must be provided for subscription");

    for (const topic of topics) {
      check(topic.mode === "multicast" || !this.hasSubscription(topic), () => {
        return `${topic.toString()} allows only a single subscription`;
      });
    }

    return handler
      ? new HandlerRegistration(this.myRegistry, topics, handler, limit, priority)
      : new LazyAsyncRegistration(this.myRegistry, topics, limit, priority);
  }

  withLimit(limit: number): SubscriptionBuilder {
    this.checkDisposed();
    check(limit > 0, () => `the limit value must be greater than 0, but is ${limit}`);
    return new SubscriptionBuilderImpl(this, limit, defaultPriority);
  }

  withPriority(priority: number): SubscriptionBuilder {
    this.checkDisposed();
    return new SubscriptionBuilderImpl(this, defaultLimit, priority);
  }

  addListener(listener: MessageListener): void {
    this.checkDisposed();
    this.myListeners.add(listener);
  }

  removeListener(listener: MessageListener): void {
    this.checkDisposed();
    this.myListeners.delete(listener);
  }

  clearListeners(): MessageListener[] {
    this.checkDisposed();
    const listeners = Array.from(this.myListeners);
    this.myListeners.clear();
    return listeners;
  }

  dispose(): void {
    if (this.myDisposed) {
      return;
    }

    this.myDisposed = true;

    // Remove this bus from the parent's child buses
    this.myParent?.myChildren?.delete(this);
    this.myListeners.clear();

    // Dispose all registrations (a.k.a. subscriptions) created by this bus
    for (const registration of this.myRegistry.registrations) {
      registration.dispose();
    }

    this.myRegistry.clear();

    // Dispose child buses
    for (const child of this.myChildren) {
      child.dispose();
    }

    this.myChildren.clear();
  }

  private enqueueMessage(message: Message): Promise<MessageResult> {
    this.checkDisposed();
    return new Promise((resolve) => {
      this.myPublishQueue.push(() => resolve(this.publishMessage(message)));

      if (!this.myPublishing) {
        this.myPublishing = true;
        queueMicrotask(() => this.drainPublishQueue());
      }
    });
  }

  private publishMessage({ topic, data, broadcast, listeners, awaitable }: Message): Promise<MessageResult> {
    // Consider only active registrations.
    // In addition, sort them by priority: a lower priority value means being invoked first.
    const registrations = this.myRegistry.getAll(topic, true).sort((a, b) => a.priority - b.priority);

    if (listeners) {
      // Listeners are invoked in the order they have been added
      for (const listener of this.myListeners) {
        try {
          const _ = listener(topic, data, registrations.length);
          Promise.resolve(_).catch((e) => this.handleError(e));
        } catch (e) {
          this.handleError(e);
        }
      }
    }

    const broadcastResults: Promise<MessageResult>[] = [];

    // Keep in mind that publish() will queue the task, so child buses,
    // or the parent bus depending on the broadcasting direction,
    // will receive the message after this bus
    if (broadcast) {
      if (topic.broadcastDirection === "children") {
        for (const child of this.myChildren) {
          broadcastResults.push(child.enqueueMessage({ topic, data, broadcast: true, awaitable }));
        }
      } else if (this.myParent) {
        broadcastResults.push(this.myParent.enqueueMessage({ topic, data, awaitable }));
      }
    }

    const values: Promise<unknown>[] = registrations.map((r) => {
      try {
        return Promise.resolve(r.handler(data)).catch((e) => {
          if (awaitable) {
            throw e;
          }

          this.handleError(e);

          // Since fire-and-forget publishing does not use handler results,
          // we can simply return undefined. It will never be considered.
          return undefined;
        });
      } catch (e) {
        if (awaitable) {
          return Promise.reject(e);
        }

        this.handleError(e);

        // Since fire-and-forget publishing does not use handler results,
        // we can simply return a successfully completed promise
        return Promise.resolve();
      }
    });

    // Return immediately if there are no subscribers to avoid heavy promise-based code
    if (!awaitable || (values.length === 0 && broadcastResults.length === 0)) {
      return Promise.resolve({
        values: [],
        errors: [],
      });
    }

    const result = Promise.allSettled(values).then((results): MessageResult => {
      const values: unknown[] = [];
      const errors: unknown[] = [];

      for (const result of results) {
        if (result.status === "fulfilled") {
          values.push(result.value);
        } else {
          errors.push(result.reason);
        }
      }

      return { values, errors };
    });

    return Promise.all([result, ...broadcastResults]).then((results) => ({
      values: results.flatMap((r) => r.values),
      errors: results.flatMap((r) => r.errors),
    }));
  }

  private drainPublishQueue(): void {
    if (!this.myDisposed) {
      while (this.myPublishQueue.length > 0) {
        const next = this.myPublishQueue.shift()!;
        next();
      }
    }

    this.myPublishing = false;
  }

  // Scan the entire message bus tree using a BFS with a stack
  private hasSubscription(topic: Topic): boolean {
    const stack = [this.getRootBus()];

    do {
      const bus = stack.pop()!;

      if (bus.myRegistry.has(topic)) {
        return true;
      }

      for (const child of bus.myChildren) {
        stack.push(child);
      }
    } while (stack.length > 0);

    return false;
  }

  private getRootBus(): MessageBusImpl {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let root: MessageBusImpl = this;

    while (root.myParent) {
      root = root.myParent;
    }

    return root;
  }

  private handleError(e: unknown): void {
    const printError = (e: unknown): void => {
      console.error(tag("caught unhandled error from MessageBusOptions.errorHandler."), e);
    };

    try {
      Promise.resolve(this.myOptions.errorHandler(e)).catch(printError);
    } catch (e) {
      printError(e);
    }
  }

  private checkDisposed(): void {
    check(!this.myDisposed, "the message bus is disposed");
  }
}
