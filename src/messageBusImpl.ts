import { isDisposed } from "./disposable";
import { check, tag } from "./errors";
import { HandlerRegistration } from "./handlerRegistration";
import { LazyAsyncRegistration } from "./lazyAsyncRegistration";
import type {
  ChildMessageBusOptions,
  LazyAsyncSubscription,
  MessageBus,
  MessageBusOptions,
  MessageHandler,
  MessageInterceptor,
  MessageListener,
  Subscription,
  SubscriptionBuilder,
} from "./messageBus";
import { getMetadata } from "./metadata";
import { defaultLimit, defaultPriority, SubscriptionRegistry } from "./registry";
import { SubscriptionBuilderImpl } from "./subscriptionBuilderImpl";
import type { Topic, UnicastTopic } from "./topic";
import type { Constructor } from "./utils";

type InstanceData = {
  readonly subscriptions: Subscription[];
  readonly unregisterToken: object;
};

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
  readonly vetoed?: boolean;
};

interface AsyncMessageInterceptor {
  readonly handler: (topic: Topic, next: MessageHandler, data: unknown, ...other: any[]) => Promise<unknown>;
  readonly isVetoed: (topic: Topic, data: unknown) => Promise<boolean>;
}

// @internal
export class MessageBusImpl implements MessageBus {
  private readonly myParent?: MessageBusImpl;
  private readonly myChildren = new Set<MessageBusImpl>();
  private readonly myRegistry = new SubscriptionRegistry();
  private readonly myPublishQueue: (() => void)[] = [];
  private readonly myListeners: Set<MessageListener>;
  private readonly myInterceptors: Set<MessageInterceptor>;
  private readonly myOptions: MessageBusOptions;

  private readonly myInstances = new WeakMap<object, InstanceData>();
  private readonly myFinalizationRegistry = new FinalizationRegistry<Subscription[]>((subs) => {
    for (const sub of subs) {
      sub.dispose();
    }
  });

  private myInterceptor?: AsyncMessageInterceptor;
  private myPublishing: boolean = false;
  private myDisposed: boolean = false;

  constructor(
    parent?: MessageBusImpl,
    listeners?: Set<MessageListener>,
    interceptors?: Set<MessageInterceptor>,
    options?: Partial<MessageBusOptions>,
  ) {
    this.myParent = parent;
    this.myListeners = listeners ?? new Set();
    this.myInterceptors = interceptors ?? new Set();
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

  createChildBus(options?: Partial<ChildMessageBusOptions>): MessageBus {
    this.checkDisposed();

    const listeners = options?.copyListeners === false ? undefined : new Set(this.myListeners);
    const interceptors = options?.copyInterceptors === false ? undefined : new Set(this.myInterceptors);
    const childBus = new MessageBusImpl(this, listeners, interceptors, {
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

    return result.then(({ values, errors, vetoed }) => {
      if (errors.length > 0) {
        throw errors.length > 1 ? new AggregateError(errors) : errors[0];
      }

      check(vetoed !== false, () => `publishing to ${topic} has been vetoed`);
      check(values.length > 0, () => `no subscribers for ${topic}`);

      const isMulticast = topic.mode === "multicast";
      check(isMulticast || values.length === 1, () => `multiple result values for ${topic}`);
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

  subscribeInstance(instance: object): void {
    const Class = instance.constructor as Constructor<object>;
    const metadata = getMetadata(Class, /* initialize */ false);

    if (!metadata || this.myInstances.has(instance)) {
      return;
    }

    const instanceRef = new WeakRef(instance);
    const subscriptions: Subscription[] = [];

    for (const [methodKey, methodSub] of metadata.subscriptions.methods) {
      const { index, topic, priority = defaultPriority, limit = defaultLimit } = methodSub;
      const sub = this.subscribeImpl(
        topic,
        (data, ...other) => {
          const ref = instanceRef.deref();

          if (ref && !isDisposed(ref)) {
            const args = new Array(index + other.length + 2);
            args[index] = data;
            args[index + 1] = sub;

            for (let i = 0; i < other.length; i++) {
              args[index + i + 2] = other[i];
            }

            (ref as any)[methodKey](...args);
          } else {
            sub.dispose();
          }
        },
        limit,
        priority,
      );

      subscriptions.push(sub);
    }

    const unregisterToken = {};
    this.myInstances.set(instance, { subscriptions, unregisterToken });
    this.myFinalizationRegistry.register(instance, subscriptions, unregisterToken);
  }

  unsubscribeInstance(instance: object): void {
    const data = this.myInstances.get(instance);

    if (data) {
      for (const sub of data.subscriptions) {
        sub.dispose();
      }

      this.myFinalizationRegistry.unregister(data.unregisterToken);
      this.myInstances.delete(instance);
    }
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
        return `${topic} allows only a single subscription`;
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

  addInterceptor(interceptor: MessageInterceptor): void {
    this.checkDisposed();
    this.myInterceptors.add(interceptor);
    this.myInterceptor = undefined;
  }

  removeInterceptor(interceptor: MessageInterceptor): void {
    this.checkDisposed();

    if (this.myInterceptors.delete(interceptor)) {
      this.myInterceptor = undefined;
    }
  }

  dispose(): void {
    if (this.myDisposed) {
      return;
    }

    this.myDisposed = true;

    // Remove this bus from the parent's child buses
    this.myParent?.myChildren?.delete(this);
    this.myListeners.clear();
    this.myInterceptors.clear();
    this.myInterceptor = undefined;

    // Dispose all registrations (a.k.a. subscriptions) created by this bus
    for (const registration of this.myRegistry.registrations) {
      registration.dispose();
    }

    this.myRegistry.clear();

    // Dispose of child buses
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

  private publishMessage(message: Message): Promise<MessageResult> {
    const interceptor = (this.myInterceptor ??= this.createInterceptor());
    const result = interceptor.isVetoed(message.topic, message.data).catch((e) => {
      if (message.awaitable) {
        throw e;
      }

      this.handleError(e);
      return undefined;
    });

    return result.then((vetoed) => {
      if (vetoed !== false) {
        return { values: [], errors: [], vetoed };
      }

      return this.dispatchMessage(message, interceptor);
    });
  }

  private dispatchMessage(message: Message, interceptor: AsyncMessageInterceptor): Promise<MessageResult> {
    const { topic, data, broadcast, listeners, awaitable } = message;

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
      // Possible synchronous errors thrown from the registration handler
      // or from interceptors are caught by the aggregate interceptor,
      // so the 'catch' code path is always the asynchronous one
      const value =
        // If the registration is an async registration (it does not have a
        // user-defined handler), we MUST call LazyAsyncRegistration.handler
        // to advance the message limit and data queue machinery
        r instanceof LazyAsyncRegistration
          ? interceptor.handler(topic, (d) => d, data).then((d) => r.handler(d))
          : interceptor.handler(topic, r.handler, data);

      return value.catch((e) => {
        if (awaitable) {
          throw e;
        }

        this.handleError(e);

        // Since fire-and-forget publishing does not use handler results,
        // we can simply return undefined. It will never be considered.
        return undefined;
      });
    });

    // Return immediately if there are no subscribers to avoid heavy promise-based code
    if (!awaitable || (values.length === 0 && broadcastResults.length === 0)) {
      return Promise.resolve({ values: [], errors: [] });
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

  private createInterceptor(): AsyncMessageInterceptor {
    const interceptors = Array.from(this.myInterceptors);

    // This represents the innermost call
    let handler = (_: Topic, next: MessageHandler, data: unknown, ...other: any[]): Promise<unknown> => {
      try {
        // 'next' is the real underlying handler
        return Promise.resolve(next(data, ...other));
      } catch (e) {
        return Promise.reject(e);
      }
    };

    for (const interceptor of interceptors) {
      const inner = handler;
      handler = (topic, next, ...args) => {
        try {
          return Promise.resolve(interceptor.handler(topic, (...a) => inner(topic, next, ...a), ...args));
        } catch (e) {
          return Promise.reject(e);
        }
      };
    }

    return {
      handler: handler,
      isVetoed: async (topic, data) => {
        // Since the rule is the most recently added interceptor wraps all previously added ones,
        // we must obey to the same constraint when calling isVetoed, so we loop in reverse
        for (let i = interceptors.length - 1; i > -1; i--) {
          if (await interceptors[i]!.isVetoed?.(topic, data)) {
            return true;
          }
        }

        return false;
      },
    };
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
