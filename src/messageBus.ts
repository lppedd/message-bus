import { MessageBusImpl } from "./messageBusImpl";
import type { Topic, Topics } from "./topic";

export interface MessageBusOptions {
  /**
   * A handler for errors thrown from message handlers.
   *
   * Note that if the error handler returns a Promise, it is not awaited.
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

export type MessageHandler<T = unknown> = (data: T) => void;
export type MessageListener = (topic: Topic, data: unknown, subscriberCount: number) => void;

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
  subscribe<T>(topic: Topic<T>): LazyAsyncSubscription<T>;
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
  subscribe<T>(topic: Topic<T>, handler: MessageHandler<T>): Subscription;
  subscribe<T extends [any, ...any[]]>(topics: Topics<T>, handler: MessageHandler<T[number]>): Subscription;

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
  subscribeOnce<T>(topic: Topic<T>): Promise<T>;
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
  subscribeOnce<T>(topic: Topic<T>, handler: MessageHandler<T>): Subscription;
  subscribeOnce<T extends [any, ...any[]]>(
    topics: Topics<T>,
    handler: MessageHandler<T[number]>,
  ): Subscription;
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
  publish(topic: Topic<void>): void;

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
  publish<T>(topic: Topic<T>, data: T): void;

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
  subscribe<T>(topic: Topic<T>): LazyAsyncSubscription<T>;
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
  subscribe<T>(topic: Topic<T>, handler: MessageHandler<T>): Subscription;
  subscribe<T extends [any, ...any[]]>(topics: Topics<T>, handler: MessageHandler<T[number]>): Subscription;

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
  subscribeOnce<T>(topic: Topic<T>): Promise<T>;
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
  subscribeOnce<T>(topic: Topic<T>, handler: MessageHandler<T>): Subscription;
  subscribeOnce<T extends [any, ...any[]]>(
    topics: Topics<T>,
    handler: MessageHandler<T[number]>,
  ): Subscription;

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
   * This allows observing messages even if no subscriber exists or if
   * a subscriber throws an unrecoverable error.
   *
   * @param listener A callback invoked with the topic and message data.
   */
  addListener(listener: MessageListener): void;

  /**
   * Removes a previously added message listener.
   *
   * @param listener The listener to remove.
   */
  removeListener(listener: MessageListener): void;

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
  return new MessageBusImpl(undefined, undefined, options);
}
