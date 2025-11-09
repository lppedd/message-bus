import { check, error } from "./errors";
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

  /**
   * All registrations in the registry, regardless of whether they are active.
   */
  get registrations(): Registration[] {
    return Array.from(this.myMap.values()).flat();
  }

  /**
   * Returns whether the registry contains any registrations for the specified topic,
   * including inactive ones.
   */
  has(topic: Topic): boolean {
    const registrations = this.myMap.get(topic);
    return !!registrations && registrations.length > 0;
  }

  /**
   * Returns registrations for the specified topic.
   */
  getAll(topic: Topic, activeOnly: boolean = false): Registration[] {
    const registrations = this.myMap.get(topic) ?? [];
    return activeOnly ? registrations.filter((r) => r.isActive) : [...registrations];
  }

  /**
   * Adds a registration for the specified topic.
   */
  add(topic: Topic, registration: Registration): void {
    let registrations = this.myMap.get(topic);

    if (!registrations) {
      this.myMap.set(topic, (registrations = []));
    }

    check(!registrations.includes(registration), "duplicated registration");
    registrations.push(registration);
  }

  /**
   * Removes a registration for the specified topic.
   *
   * @returns `true` if the registration was removed, `false` otherwise
   */
  remove(topic: Topic, registration: Registration): void {
    const registrations = this.myMap.get(topic);

    if (registrations) {
      const index = registrations.indexOf(registration);

      if (index > -1) {
        registrations.splice(index, 1);
        return;
      }
    }

    error("missing registration");
  }

  /**
   * Removes all registrations from the registry **without** disposing them.
   */
  clear(): void {
    this.myMap.clear();
  }
}
