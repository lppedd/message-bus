import type { MessageHandler } from "./messageBus";
import type { Registration, SubscriptionRegistry } from "./registry";
import type { Topic } from "./topic";

// @internal
export class HandlerRegistration implements Registration {
  private readonly myRegistry: SubscriptionRegistry;
  private readonly myTopics: Topic[];
  private readonly myHandler: MessageHandler;

  // This is an eager registration and thus it is active immediately
  isActive: boolean = true;
  isDisposed: boolean = false;
  remaining: number;
  priority: number;

  constructor(
    registry: SubscriptionRegistry,
    topics: Topic[],
    handler: MessageHandler,
    limit: number,
    priority: number,
  ) {
    this.myRegistry = registry;
    this.myTopics = topics;
    this.myHandler = handler;
    this.remaining = limit;
    this.priority = priority;

    for (const topic of this.myTopics) {
      this.myRegistry.add(topic, this);
    }
  }

  handler = (data: unknown, ...other: any[]): unknown | Promise<unknown> => {
    if (this.remaining === 0) {
      this.dispose();
      return;
    }

    if (this.remaining > 0) {
      this.remaining--;
    }

    return this.myHandler(data, ...other);
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
}
