import { check } from "./errors";
import { getMetadata } from "./metadata";
import type { Constructor, Writable } from "./utils";

/**
 * A callable interface to allow using {@link Topic} as a parameter decorator.
 */
export interface TopicDecorator {
  (priority?: number, limit?: number): ParameterDecorator;
}

/**
 * A message topic to categorize messages sent via the message bus.
 *
 * @template T The type of the payload data associated with the topic.
 * @template R The type of the value returned from message handlers subscribed to the topic.
 */
export interface Topic<T = unknown, R = unknown> extends TopicDecorator {
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
   * Ensures that different `Topic<T, R>` types are not structurally compatible.
   *
   * This property is never used at runtime.
   *
   * @private
   */
  readonly __types?: (t: T, r: R) => void;
}

/**
 * A specialized topic that allows only a single subscription **per message bus hierarchy**.
 *
 * Once a subscription exists anywhere in the hierarchy (root bus and all its children),
 * attempting to subscribe again for the same topic will throw an error.
 *
 * Separate message bus hierarchies can each have their own subscription.
 */
export interface UnicastTopic<T = unknown, R = unknown> extends Topic<T, R> {
  readonly mode: "unicast";
}

/**
 * Represents a non-empty array of topics.
 */
export type Topics<T extends [any, ...any[]]> = {
  readonly [K in keyof T]: Topic<T[K], void>;
};

/**
 * Topic behavior customizations.
 */
export interface TopicOptions {
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
 * Creates a new {@link UnicastTopic} that can be used to publish or subscribe to messages.
 *
 * @example
 * ```ts
 * const EnvTopic = createUnicastTopic<string>("Env");
 * messageBus.subscribe(EnvTopic, (data) => console.log(data));
 * messageBus.publish(EnvTopic, "production"); // => 'production' logged to the console
 * ```
 *
 * @param displayName A human-readable name for the topic, useful for debugging and logging.
 * @param options Optional topic behavior customizations.
 */
export function createUnicastTopic<T = void, R = void>(
  displayName: string,
  options?: Partial<TopicOptions>,
): UnicastTopic<T, R> {
  return createTopicByMode(displayName, "unicast", options);
}

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
export function createTopic<T = void, R = void>(
  displayName: string, //
  options?: Partial<TopicOptions>,
): Topic<T, R> {
  return createTopicByMode(displayName, "multicast", options);
}

function createTopicByMode(displayName: string, mode: "unicast", options?: Partial<TopicOptions>): UnicastTopic;
function createTopicByMode(displayName: string, mode: "multicast", options?: Partial<TopicOptions>): Topic;
function createTopicByMode(displayName: string, mode: "unicast" | "multicast", options?: Partial<TopicOptions>): Topic {
  const topicName = `${mode === "unicast" ? "UnicastTopic" : "Topic"}<${displayName}>`;
  const topicDecorator = (priority?: number, limit?: number): ParameterDecorator => {
    return function (target: any, propertyKey: string | symbol | undefined, parameterIndex: number): void {
      // Error out if the topic decorator has been applied to a static method
      check(propertyKey === undefined || typeof target !== "function", () => {
        const member = `${target.name}.${String(propertyKey)}`;
        return `decorator for ${topicName} cannot be used on static member ${member}`;
      });

      check(propertyKey !== undefined, () => {
        return `decorator for ${topicName} cannot be used on ${target.name}'s constructor`;
      });

      const metadata = getMetadata(target.constructor as Constructor<object>);
      const methods = metadata.subscriptions.methods;
      const methodSub = methods.get(propertyKey);

      check(!methodSub, () => {
        const member = `${target.constructor.name}.${String(propertyKey)}`;
        return `only a single topic subscription is allowed on ${member}`;
      });

      methods.set(propertyKey, {
        topic: topicDecorator as unknown as Topic,
        index: parameterIndex,
        priority: priority,
        limit: limit,
      });
    };
  };

  const topic = topicDecorator as unknown as Writable<Topic>;
  topic.displayName = topicName;
  topic.mode = mode;
  topic.broadcastDirection = options?.broadcastDirection ?? "children";
  topic.toString = () => topicName;
  return topic as Topic;
}
