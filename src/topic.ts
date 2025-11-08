/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import type { Constructor } from "./contructor";
import { assert, error } from "./errors";
import { getMetadata } from "./metadata";
import { defaultPriority } from "./registry";

/**
 * The broadcasting direction for a topic.
 *
 * A message published to the topic will always be delivered first to handlers
 * registered on the bus where `publish()` is called.
 *
 * Then, if the direction is:
 * - `children`: the message is also propagated to all child buses recursively
 * - `parent`: the message is also propagated to the **immediate** parent bus
 */
export type BroadcastDirection = "children" | "parent";

/**
 * An identifier used to categorize messages in the message bus.
 */
export interface Topic<T = unknown> {
  // Decorator's callable signature
  (priority?: number): ParameterDecorator;

  /**
   * A human-readable name for the topic, useful for debugging and logging.
   */
  readonly displayName: string;

  /**
   * The broadcasting direction for the topic.
   *
   * @see {@link BroadcastDirection}
   */
  readonly broadcastDirection: BroadcastDirection;

  /**
   * The maximum number of subscriptions the topic allows, regardless of
   * whether they are eager or lazy. Even an inactive lazy subscription
   * counts toward this limit.
   *
   * Once the limit is reached, additional subscription attempts will
   * throw an error.
   *
   * @defaultValue Number.POSITIVE_INFINITY
   */
  readonly subscriptionLimit: number;

  /**
   * Ensures that different Topic<T> types are not structurally compatible.
   * This property is never used at runtime.
   *
   * @private
   */
  readonly __type?: T;
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
export type TopicOptions = {
  /**
   * The broadcasting direction for the topic.
   *
   * @defaultValue children
   */
  readonly broadcastDirection: BroadcastDirection;

  /**
   * The maximum number of allowed subscriptions for the topic.
   *
   * Must be greater than 0.
   *
   * @defaultValue {@link Number.POSITIVE_INFINITY}
   */
  readonly subscriptionLimit: number;
};

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
export function createTopic<T>(displayName: string, options?: Partial<TopicOptions>): Topic<T> {
  const topicDebugName = `Topic<${displayName}>`;
  const topicOptions: TopicOptions = {
    broadcastDirection: "children",
    subscriptionLimit: Number.POSITIVE_INFINITY,
    ...options,
  };

  const limit = topicOptions.subscriptionLimit;
  assert(limit > 0, `the topic subscription limit must be greater than 0, but is ${limit}`);

  const topic = (priority: number = defaultPriority): ParameterDecorator => {
    return function (target: any, propertyKey: string | symbol | undefined, parameterIndex: number): void {
      // Error out if the topic decorator has been applied to a static method
      if (propertyKey !== undefined && typeof target === "function") {
        const member = `${target.name}.${String(propertyKey)}`;
        error(`decorator for ${topicDebugName} cannot be used on static member ${member}`);
      }

      if (propertyKey === undefined) {
        error(`decorator for ${topicDebugName} cannot be used on ${target.name}'s constructor`);
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
  writableTopic.displayName = topicDebugName;
  writableTopic.broadcastDirection = topicOptions.broadcastDirection;
  writableTopic.subscriptionLimit = topicOptions.subscriptionLimit;
  writableTopic.toString = () => topicDebugName;

  return writableTopic as Topic<T>;
}
