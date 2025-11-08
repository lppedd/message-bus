import type { MessageHandler, Subscription } from "./messageBus";
import type { Topic } from "./topic";

// @internal
export const defaultLimit: number = -1;

// @internal
export const defaultPriority: number = 1;

// @internal
export interface Registration extends Subscription {
  isActive: boolean;
  isDisposed: boolean;
  remaining: number;
  priority: number;
  handler: MessageHandler;
}

// @internal
export class SubscriptionRegistry {
  private readonly myMap = new Map<Topic, Registration[]>();

  get(topic: Topic, activeOnly: boolean = false): Registration[] {
    const registrations = this.myMap.get(topic) ?? [];
    return activeOnly ? registrations.filter((r) => r.isActive) : [...registrations];
  }

  set(topic: Topic, registration: Registration): void {
    let registrations = this.myMap.get(topic);

    if (!registrations) {
      this.myMap.set(topic, (registrations = []));
    }

    registrations.push(registration);
  }

  delete(topic: Topic, registration: Registration): boolean {
    const registrations = this.myMap.get(topic);

    if (registrations) {
      const index = registrations.indexOf(registration);

      if (index > -1) {
        return registrations.splice(index, 1).length > 0;
      }
    }

    return false;
  }

  values(): Registration[] {
    return Array.from(this.myMap.values()).flat();
  }

  clear(): void {
    this.myMap.clear();
  }
}
