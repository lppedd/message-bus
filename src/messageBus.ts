import { MessageBusImpl } from "./messageBusImpl";
import type { Topic, Topics, UnicastTopic } from "./topic";

/**
 * Prevents the TS compiler from performing only structural matching on `T`.
 *
 * Without this type, passing an inline plain object to `publish<T>(Topic<T>, T)`
 * would result in missing editor assistance (no go-to declaration, find usages,
 * refactoring), and in being able to add properties not declared by the type `T`.
 */
type Strict<T> = T extends T ? T : T;

/**
 * A function that handles messages published to a specific {@link Topic}.
 *
 * Message handlers are registered using {@link MessageBus.subscribe} or {@link MessageBus.subscribeOnce}.
 * They are invoked whenever a message is published to the corresponding topic.
 *
 * @example
 * ```ts
 * bus.subscribe(UserCreatedTopic, async (user) => {
 *   await sendWelcomeEmail(user);
 * });
 * ```
 *
 * @param data The payload sent with the topic message.
 * @param other Optional additional message handler arguments injected by {@link MessageInterceptor}(s).
 * @returns The handler's result, which may be returned synchronously or as a promise.
 *  Defaults to `void`, which means nothing is returned.
 *
 * @template T The type of the payload data received by the handler.
 * @template R The type of the value returned by the handler.
 *   Defaults to `void`, which means nothing is returned.
 */
export type MessageHandler<T = unknown, R = unknown> = (data: T, ...other: any[]) => R | Promise<R>;

/**
 * A listener function that observes all messages being published through a {@link MessageBus},
 * regardless of the topic.
 *
 * Message listeners are registered using {@link MessageBus.addListener}.
 *
 * @example
 * ```ts
 * bus.addListener((topic, data, activeSubscriptions) => {
 *   console.debug(`Published to ${topic} (${activeSubscriptions} subscribers)`, data);
 * });
 * ```
 *
 * @param topic The {@link Topic} to which the message was published.
 * @param data The payload associated with the topic message.
 * @param activeSubscriptions The number of active subscriptions for the topic at the time of publication.
 */
export type MessageListener = (topic: Topic, data: unknown, activeSubscriptions: number) => void | Promise<void>;

/**
 * A message interceptor that allows observing, modifying, or preventing
 * message dispatch before messages are dispatched to topic subscribers.
 *
 * A `MessageInterceptor` can:
 * - Veto (cancel) message dispatching entirely via {@link isVetoed}.
 * - Wrap or replace the topic's handler invocation logic via {@link handler}.
 *
 * Message interceptors are registered using {@link MessageBus.addInterceptor}.
 */
export interface MessageInterceptor {
  /**
   * A function to optionally wrap or replace the original topic's subscription handler.
   *
   * This method is invoked before the topic's subscriber handler executes.
   * Implementations can transform the message payload, inject behavior
   * (such as logging or timing), or completely replace the handler logic.
   *
   * The returned value, or resolved promise value, becomes the handler's result.
   *
   * @example
   * ```ts
   * const perfInterceptor: MessageInterceptor = {
   *   handler: async (topic, data, next) => {
   *     const start = performance.now();
   *     const result = await next(data);
   *     const duration = performance.now() - start;
   *     console.log(`Handler for ${topic} took ${duration.toFixed(2)} ms`);
   *     return result;
   *   },
   * };
   * ```
   *
   * @param topic The topic being published to.
   * @param next The original {@link MessageHandler} registered for the topic.
   *   The interceptor may call it to invoke the next handler in the chain.
   * @param data The message payload associated with the publication.
   * @param other Optional additional message handler arguments injected by the interceptor chain.
   */
  handler: (topic: Topic, next: MessageHandler, data: unknown, ...other: any[]) => unknown | Promise<unknown>;

  /**
   * An optional function to determine whether a message for the given topic
   * should be vetoed (prevented from being dispatched to subscribers).
   *
   * If this method returns or resolves to `true`, the message will not be dispatched
   * to any subscribers, and subsequent interceptors will not be evaluated.
   *
   * @example
   * ```ts
   * const authInterceptor: MessageInterceptor = {
   *   isVetoed: async (topic, data) => {
   *     const user = await getCurrentUser();
   *     return !user.hasPermission(topic);
   *   },
   *   handler: (_, data, next) => next(data),
   * };
   * ```
   *
   * @param topic The topic being published to.
   * @param data The message payload associated with the publication.
   */
  isVetoed?: (topic: Topic, data: unknown) => boolean | Promise<boolean>;
}

export interface MessageBusOptions {
  /**
   * A handler for errors thrown from message handlers.
   *
   * Note that if the error handler returns a promise, it is not awaited.
   *
   * @defaultValue (e) => console.error(e)
   */
  readonly errorHandler: (e: unknown) => void | Promise<void>;
}

export interface ChildMessageBusOptions extends MessageBusOptions {
  /**
   * Whether to copy {@link MessageListener}(s) from the parent bus.
   *
   * @defaultValue true
   */
  readonly copyListeners: boolean;

  /**
   * Whether to copy {@link MessageInterceptor}(s) from the parent bus.
   *
   * @defaultValue true
   */
  readonly copyInterceptors: boolean;
}

/**
 * Represents an active subscription to a {@link Topic}.
 */
export interface Subscription {
  /**
   * Disposes the subscription, unsubscribing from the topic.
   *
   * After disposal, the subscription will no longer receive messages.
   */
  readonly dispose: () => void;
}

/**
 * Represents a lazily-initialized subscription to a {@link Topic} that is also
 * an {@link AsyncIterableIterator}.
 *
 * The subscription supports consuming published messages using `for await ... of`,
 * awaiting a single message via {@link single}, and manual disposal via {@link dispose}.
 * If an async iteration completes or ends early (e.g., via `break`, `return`, or an error),
 * the subscription is automatically disposed.
 *
 * The subscription is created lazily: the first call to `next()` or `single()`
 * triggers the underlying registration. If the consumer never starts an iteration
 * or never awaits a message, no subscription is created.
 */
export interface LazyAsyncSubscription<T = unknown> extends AsyncIterableIterator<T>, Subscription {
  /**
   * Awaits the next message published to the topic.
   *
   * Throws an error if the subscription was disposed before a message was received.
   */
  readonly single: () => Promise<T>;
}

/**
 * Allows creating customized subscriptions.
 */
export interface SubscriptionBuilder {
  /**
   * Sets the maximum number of messages to receive for the next subscription.
   *
   * When the specified limit is reached, the subscription is automatically disposed.
   *
   * @param limit The maximum number of messages to receive.
   */
  withLimit(limit: number): SubscriptionBuilder;

  /**
   * Sets the priority for the next subscription.
   *
   * Higher priority (**lower** number) subscriptions are notified before lower priority
   * (**higher** value) ones. The default priority value is `1`.
   *
   * @param priority A priority value, where a **lower** number means **higher** priority.
   */
  withPriority(priority: number): SubscriptionBuilder;

  /**
   * Creates a lazily-initialized subscription to the specified topic that is also
   * an {@link AsyncIterableIterator}.
   *
   * This allows consuming published messages using the `for await ... of` syntax.
   * If an async iteration completes or ends early (e.g., via `break`, `return`, or an error),
   * the subscription is automatically disposed.
   *
   * The subscription is created lazily: it is only registered when the first call
   * to `next()` or `single()` occurs. If iteration never begins, no subscription is created.
   *
   * @example
   * ```ts
   * const subscription = messageBus.withLimit(3).subscribe(CommandTopic);
   *
   * // Will iterate 3 times max
   * for await (const command of subscription) {
   *   switch (command) {
   *     case "shutdown":
   *       // ...
   *       break;
   *     case "restart":
   *       // ...
   *       break;
   *   }
   * }
   * ```
   *
   * @param topic The topic to subscribe to.
   */
  subscribe<T>(topic: Topic<T, void>): LazyAsyncSubscription<T>;
  subscribe<T extends [any, ...any[]]>(topics: Topics<T>): LazyAsyncSubscription<T[number]>;

  /**
   * Subscribes to the specified topic with a callback.
   *
   * The subscription is established immediately, and stays active until disposal.
   *
   * @example
   * ```ts
   * // The message handler will be invoked 3 times max
   * const subscription = messageBus.withLimit(3).subscribe(CommandTopic, (command) => {
   *   switch (command) {
   *     case "shutdown":
   *       // ...
   *       break;
   *     case "restart":
   *       // ...
   *       break;
   *   }
   * });
   * ```
   *
   * @param topic The topic to subscribe to.
   * @param handler A callback invoked on each topic message.
   */
  subscribe<T, R = void>(topic: Topic<T, R>, handler: MessageHandler<T, R>): Subscription;
  subscribe<T extends [any, ...any[]]>(topics: Topics<T>, handler: MessageHandler<T[number], void>): Subscription;

  /**
   * Subscribes once to the specified topic, returning a promise that resolves
   * with the next published message.
   *
   * The subscription will be automatically disposed after receiving the first message.
   * Useful for awaiting a single message without manually managing the subscription.
   *
   * @example
   * ```ts
   * const command = await messageBus.withPriority(0).subscribeOnce(CommandTopic);
   * console.log(`Received command: ${command}`);
   * ```
   *
   * @param topic The topic to subscribe to.
   */
  subscribeOnce<T>(topic: Topic<T, void>): Promise<T>;
  subscribeOnce<T extends [any, ...any[]]>(topics: Topics<T>): Promise<T[number]>;

  /**
   * Subscribes once to the specified topic with a callback.
   *
   * The callback is invoked with the next message, after which the subscription is disposed.
   *
   * @example
   * ```ts
   * // Automatically unsubscribes after the next message
   * messageBus.withPriority(0).subscribeOnce(CommandTopic, (command) => {
   *   console.log(`Received command: ${command}`);
   * });
   * ```
   *
   * @param topic The topic to subscribe to.
   * @param handler A callback invoked on the next topic message.
   */
  subscribeOnce<T, R = void>(topic: Topic<T, R>, handler: MessageHandler<T, R>): Subscription;
  subscribeOnce<T extends [any, ...any[]]>(topics: Topics<T>, handler: MessageHandler<T[number], void>): Subscription;
}

/**
 * The message bus API.
 */
export interface MessageBus {
  /**
   * Whether the message bus is disposed.
   */
  readonly isDisposed: boolean;

  /**
   * Creates a new child bus linked to this one for hierarchical broadcasting.
   *
   * Messages with `children` broadcast direction will be propagated to it.
   */
  createChildBus(options?: Partial<ChildMessageBusOptions>): MessageBus;

  /**
   * Publishes a new message without any associated data to the specified topic.
   *
   * @example
   * ```ts
   * messageBus.publish(PingTopic);
   * ```
   *
   * @param topic The topic to publish the message to.
   */
  publish(topic: Topic<void, void>): void;

  /**
   * Publishes a new message with associated data to the specified topic.
   *
   * @example
   * ```ts
   * messageBus.publish(CommandTopic, "shutdown");
   * ```
   *
   * @param topic The topic to publish the message to.
   * @param data The data payload to send with the message.
   */
  publish<T>(topic: Topic<T, void>, data: Strict<T>): void;

  /**
   * Asynchronously publishes a new message without any associated data
   * to the specified topic and waits for all subscribed handlers to complete.
   *
   * The returned promise resolves once all subscribed handlers have completed:
   * - For `unicast` topics, it resolves to the single handler's result.
   * - For `multicast` topics, it resolves to an array of all handler results.
   *
   * If one or more handlers throw, the promise is rejected:
   * - With the original error if a single handler failed.
   * - With an `AggregateError` containing all errors if multiple handlers failed.
   *
   * @example
   * ```ts
   * // UnicastTopic
   * const user = await bus.publishAsync(UserTopic);
   *
   * // Topic
   * const statuses = await bus.publishAsync(ServiceStatusTopic);
   * console.log("All service statuses", statuses);
   * ```
   *
   * @param topic The topic to publish the message to.
   * @returns A promise that resolves with the handler result(s),
   *   or rejects if any handler throws.
   */
  publishAsync<R = void>(topic: UnicastTopic<void, R>): Promise<R>;
  publishAsync<R = void>(topic: Topic<void, R>): Promise<R[]>;

  /**
   * Asynchronously publishes a new message with associated data
   * to the specified topic and waits for all subscribed handlers to complete.
   *
   * The returned promise resolves once all subscribed handlers have completed:
   * - For `unicast` topics, it resolves to the single handler's result.
   * - For `multicast` topics, it resolves to an array of all handler results.
   *
   * If one or more handlers throw, the promise is rejected:
   * - With the original error if a single handler failed.
   * - With an `AggregateError` containing all errors if multiple handlers failed.
   *
   * @example
   * ```ts
   * // UnicastTopic
   * const result = await bus.publishAsync(NotifyUserTopic, user);
   * console.log("Notification result", result);
   *
   * // Topic
   * const results = await bus.publishAsync(CommandTopic, "shutdown");
   * console.log("Service shutdown results", results);
   * ```
   *
   * @param topic The topic to publish the message to.
   * @param data The data payload to send with the message.
   * @returns A promise that resolves with the handler result(s),
   *   or rejects if any handler throws.
   */
  publishAsync<T, R = void>(topic: UnicastTopic<T, R>, data: Strict<T>): Promise<R>;
  publishAsync<T, R = void>(topic: Topic<T, R>, data: Strict<T>): Promise<R[]>;

  /**
   * Creates a lazily-initialized subscription to the specified topic that is also
   * an {@link AsyncIterableIterator}.
   *
   * This allows consuming published messages using the `for await ... of` syntax.
   * If an async iteration completes or ends early (e.g., via `break`, `return`, or an error),
   * the subscription is automatically disposed.
   *
   * The subscription is created lazily: the first call to `next()` or `single()`
   * triggers the underlying registration. If the consumer never starts an iteration
   * or never awaits a message, no subscription is created.
   *
   * @example
   * ```ts
   * const subscription = messageBus.subscribe(CommandTopic);
   *
   * for await (const command of subscription) {
   *   switch (command) {
   *     case "shutdown":
   *       // ...
   *       break;
   *     case "restart":
   *       // ...
   *       break;
   *   }
   * }
   * ```
   *
   * @param topic The topic to subscribe to.
   */
  subscribe<T>(topic: Topic<T, void>): LazyAsyncSubscription<T>;
  subscribe<T extends [any, ...any[]]>(topics: Topics<T>): LazyAsyncSubscription<T[number]>;

  /**
   * Subscribes to the specified topic with a callback.
   *
   * The subscription is established immediately, and you can call
   * {@link Subscription.dispose} to unsubscribe.
   *
   * @example
   * ```ts
   * const subscription = messageBus.subscribe(CommandTopic, (command) => {
   *   switch (command) {
   *     case "shutdown":
   *       // ...
   *       break;
   *     case "restart":
   *       // ...
   *       break;
   *   }
   * });
   *
   * // Later
   * subscription.dispose();
   * ```
   *
   * @param topic The topic to subscribe to.
   * @param handler A callback invoked on each topic message.
   */
  subscribe<T, R = void>(topic: Topic<T, R>, handler: MessageHandler<T, R>): Subscription;
  subscribe<T extends [any, ...any[]]>(topics: Topics<T>, handler: MessageHandler<T[number], void>): Subscription;

  /**
   * Subscribes once to the specified topic, returning a promise that resolves
   * with the next published message.
   *
   * The subscription will be automatically disposed after receiving the message.
   * This allows awaiting a single message without manual subscription management.
   *
   * @example
   * ```ts
   * const command = await messageBus.subscribeOnce(CommandTopic);
   * console.log(`Received command: ${command}`);
   * ```
   *
   * @param topic The topic to subscribe to.
   */
  subscribeOnce<T>(topic: Topic<T, void>): Promise<T>;
  subscribeOnce<T extends [any, ...any[]]>(topics: Topics<T>): Promise<T[number]>;

  /**
   * Subscribes once to the specified topic with a callback.
   *
   * The callback is invoked with the next message, after which the subscription is disposed.
   *
   * @example
   * ```ts
   * // Automatically unsubscribes after the next message
   * messageBus.subscribeOnce(CommandTopic, (command) => {
   *   console.log(`Received command: ${command}`);
   * });
   * ```
   *
   * @param topic The topic to subscribe to.
   * @param handler A callback invoked on the next topic message.
   */
  subscribeOnce<T, R = void>(topic: Topic<T, R>, handler: MessageHandler<T, R>): Subscription;
  subscribeOnce<T extends [any, ...any[]]>(topics: Topics<T>, handler: MessageHandler<T[number], void>): Subscription;

  /**
   * Creates subscriptions for the given instance using the topic metadata defined
   * on its class's methods via `@Topic()`-decorated parameters.
   *
   * Each discovered method is bound to the instance and invoked whenever a
   * message is published to its associated topic. Subscriptions are cleaned up
   * automatically when the instance is garbage-collected, or immediately when
   * the returned `Subscription` is explicitly disposed.
   *
   * Returns a `Subscription` that allows unsubscribing all discovered methods at once,
   * or `undefined` if the instance's class has no methods with `@Topic()`-decorated
   * parameters.
   *
   * @example
   * ```ts
   * class CommandProcessor {
   *   // The Subscription parameter is optional.
   *   // If present, it must immediately follow the decorated parameter.
   *   onCommand(@CommandTopic() command: string, subscription: Subscription): void {
   *     if (command === "shutdown") {
   *       // ...
   *       subscription.dispose();
   *     }
   *   }
   * }
   *
   * // The onCommand method will be registered as a CommandTopic handler
   * const processor = new CommandProcessor();
   * messageBus.subscribeInstance(processor);
   * ```
   *
   * @param instance An instance whose class contains `@Topic()`-decorated methods.
   */
  subscribeInstance(instance: object): Subscription | undefined;

  /**
   * Sets the maximum number of messages to receive for the next subscription.
   *
   * When the specified limit is reached, the subscription is automatically disposed.
   *
   * @param limit The maximum number of messages to receive.
   */
  withLimit(limit: number): SubscriptionBuilder;

  /**
   * Sets the priority for the next subscription.
   *
   * Higher priority (**lower** number) subscriptions are notified before lower priority
   * (**higher** value) ones. The default priority value is `1`.
   *
   * @param priority A priority value, where a **lower** number means **higher** priority.
   */
  withPriority(priority: number): SubscriptionBuilder;

  /**
   * Adds a message listener that will be notified of every message
   * published on this message bus, regardless of topic.
   *
   * Listeners are invoked **before** any topic-specific subscribers.
   * This allows observing messages even if no subscriber for a topic exists.
   *
   * @param listener The listener to add.
   */
  addListener(listener: MessageListener): void;

  /**
   * Removes a previously added message listener.
   *
   * @param listener The listener to remove.
   */
  removeListener(listener: MessageListener): void;

  /**
   * Adds a new message interceptor to the bus.
   *
   * Message interceptors allow inspecting, modifying, or vetoing
   * messages before they are dispatched to subscribed handlers.
   *
   * Interceptors are invoked in reverse order of registration: the most
   * recently added interceptor will wrap all previously added ones.
   *
   * @param interceptor The interceptor to add.
   */
  addInterceptor(interceptor: MessageInterceptor): void;

  /**
   * Removes a previously added message interceptor.
   *
   * @param interceptor The interceptor to remove.
   */
  removeInterceptor(interceptor: MessageInterceptor): void;

  /**
   * Disposes the message bus, all its child buses, and all active subscriptions.
   *
   * After disposal, neither this bus nor any child buses can be used for publishing or subscribing.
   */
  dispose(): void;
}

/**
 * Creates a new message bus.
 */
export function createMessageBus(options?: Partial<MessageBusOptions>): MessageBus {
  return new MessageBusImpl(undefined, undefined, undefined, options);
}
