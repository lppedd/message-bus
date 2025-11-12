import type { Constructor } from "./contructor";
import type { Topic } from "./topic";

// @internal
export interface MethodSubscription {
  // The index of the annotated parameter (zero-based)
  readonly index: number;
  readonly topic: Topic;
  readonly priority: number;
}

// @internal
export interface Subscriptions {
  readonly methods: Map<string | symbol, MethodSubscription>;
}

// @internal
export interface Metadata {
  subscriptions: Subscriptions;
}

// @internal
export function getMetadata(Class: Constructor<object>): Metadata {
  let metadata = metadataMap.get(Class);

  if (!metadata) {
    metadataMap.set(
      Class,
      (metadata = {
        subscriptions: {
          methods: new Map(),
        },
      }),
    );
  }

  return metadata;
}

const metadataMap = new WeakMap<Constructor<object>, Metadata>();
