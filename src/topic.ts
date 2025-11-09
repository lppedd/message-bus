/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import type { Constructor } from "./contructor";
import { error } from "./errors";
import { getMetadata } from "./metadata";
import { defaultPriority } from "./registry";

/**
 * A message topic to categorize messages in the message bus.
 */
export interface Topic<T = unknown> {
  // Decorator's callable signature
  (priority?: number): ParameterDecorator;

  /**
   * A human-readable name for the topic, useful for debugging and logging.
   */
  readonly displayName: string;

  /**
   * Whether the topic allows multiple subscriptions or only a single subscription.
   *
   * - `multicast`: the topic can have multiple subscribers
   * - `unicast`: the topic can have at most one subscriber
   *
   * A topic is `multicast` by default.
   */
  readonly mode: "multicast" | "unicast";

  /**
   * The broadcasting direction for a topic.
   *
   * A message published to the topic will always be delivered first to handlers
   * registered on the bus where `publish()` is called.
   *
   * Then, if the direction is:
   * - `children`: the message is also propagated to all child buses recursively
   * - `parent`: the message is also propagated to the **immediate** parent bus
   *
   * A topic broadcasts to `children` by default.
   */
  readonly broadcastDirection: "children" | "parent";

  /**
   * Ensures that different Topic<T> types are not structurally compatible.
   * This property is never used at runtime.
   *
   * @private
   */
  readonly __type?: T;
}

/**
 * A specialized topic that allows only a single subscription.
 */
export interface UnicastTopic<T = unknown> extends Topic<T> {
  readonly mode: "unicast";
}

/**
 * Represents a non-empty array of topics.
 */
export type Topics<T extends [any, ...any[]]> = {
  readonly [K in keyof T]: Topic<T[K]>;
};

/**
 * Topic behavior customizations.
 */
export interface TopicOptions {
  /**
   * Whether the topic allows multiple subscriptions or only a single subscription.
   *
   * - `multicast`: the topic can have multiple subscribers
   * - `unicast`: the topic can have at most one subscriber
   *
   * @defaultValue multicast
   */
  readonly mode: "multicast" | "unicast";

  /**
   * The broadcasting direction for a topic.
   *
   * A message published to the topic will always be delivered first to handlers
   * registered on the bus where `publish()` is called.
   *
   * Then, if the direction is:
   * - `children`: the message is also propagated to all child buses recursively
   * - `parent`: the message is also propagated to the **immediate** parent bus
   *
   * @defaultValue children
   */
  readonly broadcastDirection: "children" | "parent";
}

/**
 * Unicast topic behavior customizations.
 */
export interface UnicastTopicOptions extends TopicOptions {
  readonly mode: "unicast";
}

/**
 * Creates a new {@link UnicastTopic} that can be used to publish or subscribe to messages.
 *
 * @example
 * ```ts
 * const EnvTopic = createTopic<string>("Env", { mode: "unicast" });
 * messageBus.subscribe(EnvTopic, (data) => console.log(data));
 * messageBus.publish(EnvTopic, "production"); // => 'production' logged to the console
 * ```
 *
 * @param displayName A human-readable name for the topic, useful for debugging and logging.
 * @param options Optional topic behavior customizations.
 */
export function createTopic<T>(displayName: string, options: Partial<UnicastTopicOptions>): UnicastTopic<T>;

/**
 * Creates a new {@link Topic} that can be used to publish or subscribe to messages.
 *
 * @example
 * ```ts
 * const EnvTopic = createTopic<string>("Env");
 * messageBus.subscribe(EnvTopic, (data) => console.log(data));
 * messageBus.publish(EnvTopic, "production"); // => 'production' logged to the console
 * ```
 *
 * @param displayName A human-readable name for the topic, useful for debugging and logging.
 * @param options Optional topic behavior customizations.
 */
export function createTopic<T>(displayName: string, options?: Partial<TopicOptions>): Topic<T>;

// @internal
export function createTopic<T>(displayName: string, options?: Partial<TopicOptions>): Topic<T> {
  const topicOptions: TopicOptions = {
    mode: "multicast",
    broadcastDirection: "children",
    ...options,
  };

  const topicName = `${topicOptions.mode === "unicast" ? "UnicastTopic" : "Topic"}<${displayName}>`;
  const topic = (priority: number = defaultPriority): ParameterDecorator => {
    return function (target: any, propertyKey: string | symbol | undefined, parameterIndex: number): void {
      // Error out if the topic decorator has been applied to a static method
      if (propertyKey !== undefined && typeof target === "function") {
        const member = `${target.name}.${String(propertyKey)}`;
        error(`decorator for ${topicName} cannot be used on static member ${member}`);
      }

      if (propertyKey === undefined) {
        error(`decorator for ${topicName} cannot be used on ${target.name}'s constructor`);
      }

      const metadata = getMetadata(target.constructor as Constructor<object>);
      const methods = metadata.subscriptions.methods;
      const methodSub = methods.get(propertyKey);

      if (methodSub) {
        const member = `${target.constructor.name}.${String(propertyKey)}`;
        error(`only a single topic subscription is allowed on ${member}`);
      }

      methods.set(propertyKey, {
        topic: topic as unknown as Topic<T>,
        index: parameterIndex,
        priority: priority,
      });
    };
  };

  type Writable<T> = {
    -readonly [P in keyof T]: T[P];
  };

  const writableTopic = topic as unknown as Writable<Topic<T>>;
  writableTopic.displayName = topicName;
  writableTopic.mode = topicOptions.mode;
  writableTopic.broadcastDirection = topicOptions.broadcastDirection;
  writableTopic.toString = () => topicName;

  return writableTopic as Topic<T>;
}
