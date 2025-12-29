import type { Topic } from "./topic";
import type { Constructor } from "./utils";

// @internal
export interface MethodSubscription {
  // The index of the annotated parameter (zero-based)
  readonly index: number;
  readonly topic: Topic;
  readonly priority?: number;
  readonly limit?: number;
}

// @internal
export interface Subscriptions {
  readonly methods: Map<string | symbol, MethodSubscription>;
}

// @internal
export interface Metadata {
  readonly subscriptions: Subscriptions;
}

// @internal
export function getMetadata(Class: Constructor<object>, initialize?: true): Metadata;
export function getMetadata(Class: Constructor<object>, initialize: false): Metadata | undefined;
export function getMetadata(Class: Constructor<object>, initialize: boolean = true): Metadata | undefined {
  let metadata = metadataMap.get(Class);

  if (!metadata && initialize) {
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
