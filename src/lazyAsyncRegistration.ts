import { assert } from "./errors";
import type { LazyAsyncSubscription } from "./messageBus";
import type { Registration, SubscriptionRegistry } from "./registry";
import type { Topic } from "./topic";

// @internal
export class LazyAsyncRegistration implements Registration, LazyAsyncSubscription {
  private readonly myDataQueue: unknown[] = [];
  private readonly myPromiseQueue: [(v: IteratorResult<unknown>) => void, (e?: any) => void][] = [];
  private readonly myRegistry: SubscriptionRegistry;
  private readonly myTopics: Topic[];

  isActive: boolean = false;
  isDisposed: boolean = false;
  remaining: number;
  priority: number;

  constructor(registry: SubscriptionRegistry, topics: Topic[], limit: number, priority: number) {
    this.myRegistry = registry;
    this.myTopics = topics;
    this.remaining = limit;
    this.priority = priority;

    for (const topic of this.myTopics) {
      this.myRegistry.add(topic, this);
    }
  }

  handler = (data: unknown): void => {
    if (this.remaining === 0) {
      this.dispose();
      return;
    }

    if (this.remaining > 0) {
      this.remaining--;
    }

    if (this.myPromiseQueue.length > 0) {
      const [resolve] = this.myPromiseQueue.shift()!;
      resolve({ done: false, value: data });
    } else {
      this.myDataQueue.push(data);
    }
  };

  dispose = (): void => {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    this.isActive = false;

    for (const topic of this.myTopics) {
      this.myRegistry.remove(topic, this);
    }
  };

  single = async (): Promise<unknown> => {
    const { done, value } = await this.next();
    assert(!done, "the subscription is disposed");
    return value;
  };

  next = async (): Promise<IteratorResult<unknown>> => {
    // Consume from the queue before waiting for more data
    if (this.myDataQueue.length > 0) {
      const data = this.myDataQueue.shift()!;
      return { done: false, value: data };
    }

    if (this.isDisposed) {
      return { done: true, value: undefined };
    }

    this.isActive = true;
    return new Promise((resolve, reject) => this.myPromiseQueue.push([resolve, reject]));
  };

  // eslint-disable-next-line @typescript-eslint/require-await
  return = async (): Promise<IteratorResult<unknown>> => {
    this.dispose();

    // Resolve pending promises
    while (this.myPromiseQueue.length > 0) {
      const [resolve] = this.myPromiseQueue.shift()!;
      resolve({ done: true, value: undefined });
    }

    return { done: true, value: undefined };
  };

  throw = (e?: any): Promise<IteratorResult<unknown>> => {
    this.dispose();

    while (this.myPromiseQueue.length > 0) {
      const [, reject] = this.myPromiseQueue.shift()!;
      reject(e);
    }

    throw e;
  };

  public [Symbol.asyncIterator] = (): AsyncIterableIterator<unknown> => this;
}
