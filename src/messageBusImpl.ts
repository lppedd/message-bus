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
import type { Topic } from "./topic";

// @internal
export class MessageBusImpl implements MessageBus {
  private readonly myParent?: MessageBusImpl;
  private readonly myOptions: Required<MessageBusOptions>;
  private readonly myListeners: Set<MessageListener>;
  private readonly myRegistry = new SubscriptionRegistry();
  private readonly myChildren = new Set<MessageBusImpl>();
  private readonly myPublishQueue: (() => void)[] = [];

  private myPublishing: boolean = false;
  private myDisposed: boolean = false;

  constructor(parent?: MessageBusImpl, listeners?: Set<MessageListener>, options?: MessageBusOptions) {
    this.myParent = parent;
    this.myListeners = listeners ?? new Set();

    const consoleHandler = (e: unknown): void => {
      console.error(tag("caught unhandled error from message handler."), e);
    };

    this.myOptions = {
      errorHandler: options?.errorHandler ?? consoleHandler,
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
    this.publishImpl(topic, data, true, true);
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

  dispose(): void {
    if (this.myDisposed) {
      return;
    }

    this.myDisposed = true;

    // Remove this bus from the parent's child buses
    this.myParent?.myChildren?.delete(this);

    // Dispose all registrations (a.k.a. subscriptions) created by this bus
    for (const registration of this.myRegistry.registrations) {
      registration.dispose();
    }

    // Dispose child buses
    for (const child of this.myChildren) {
      child.dispose();
    }

    this.myChildren.clear();
    this.myRegistry.clear();
    this.myListeners.clear();
  }

  private publishImpl(topic: Topic, data: unknown, broadcast: boolean, listeners: boolean): void {
    this.checkDisposed();
    this.myPublishQueue.push(() => this.publishMessage(topic, data, broadcast, listeners));

    if (!this.myPublishing) {
      this.myPublishing = true;
      queueMicrotask(() => this.drainPublishQueue());
    }
  }

  private publishMessage(topic: Topic, data: unknown, broadcast: boolean, listeners: boolean): void {
    // Consider only active registrations.
    // In addition, sort them by priority: a lower priority value means being invoked first.
    const registrations = this.myRegistry.getAll(topic, true).sort((a, b) => a.priority - b.priority);

    if (listeners) {
      // Listeners are invoked in the order they have been added
      for (const listener of this.myListeners) {
        void listener(topic, data, registrations.length);
      }
    }

    // Keep in mind that publish() will queue the task, so child buses,
    // or the parent bus depending on the broadcasting direction,
    // will receive the message after this bus
    if (broadcast) {
      switch (topic.broadcastDirection) {
        case "children":
          for (const child of this.myChildren) {
            child.publishImpl(topic, data, true, false);
          }

          break;
        case "parent":
          this.myParent?.publishImpl(topic, data, false, false);
          break;
      }
    }

    // Keep the type as for now we want to make sure we always deal with voids
    const localResults: Promise<void>[] = registrations.map((registration) => {
      try {
        const result = registration.handler(data);
        return Promise.resolve(result);
      } catch (e) {
        return Promise.reject(e);
      }
    });

    void Promise.allSettled(localResults).then((results) => {
      const errors = this.extractErrors(results);

      for (const error of errors) {
        void this.myOptions.errorHandler(error);
      }
    });
  }

  private extractErrors(results: PromiseSettledResult<void>[]): unknown[] {
    return results //
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason);
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

  private checkDisposed(): void {
    check(!this.myDisposed, "the message bus is disposed");
  }
}
