import type { Constructor } from "./contructor";
import type { MessageBus } from "./messageBus";
import { getMetadata } from "./metadata";

/**
 * Class decorator that automatically subscribes to topics based on method parameter decorators.
 *
 * This decorator inspects the decorated class looking for methods with topic-decorated parameters,
 * and subscribes to those topics using the provided `messageBus`.
 *
 * When a message is published, the decorated parameter's method is invoked with the message data.
 * If the class instance is garbage collected, the topic subscription is automatically disposed.
 *
 * @example
 * ```ts
 * const messageBus = createMessageBus();
 *
 * @AutoSubscribe(messageBus)
 * class UserManager {
 *   onUserLogin(@LoginTopic login: UserLogin): void {
 *     // ...
 *   }
 * }
 * ```
 *
 * @param messageBus The message bus instance to use for creating subscriptions.
 * @param onTransformedClass An optional callback invoked with the class created
 *   by this decorator (`transformedClass`) and the original class (`originalClass`).
 *   Useful for registering the new class externally.
 */
export function AutoSubscribe<Ctor extends Constructor<object>>(
  messageBus: MessageBus | (() => MessageBus),
  onTransformedClass?: (transformedClass: Ctor, originalClass: Ctor) => void,
): ClassDecorator {
  return function (Class: Ctor): Ctor {
    const subClass = class extends Class {
      constructor(...args: any[]) {
        super(...args);

        const metadata = getMetadata(Class);
        const bus = typeof messageBus === "function" ? messageBus() : messageBus;
        const thisRef = new WeakRef(this);

        for (const [methodKey, methodSub] of metadata.subscriptions.methods) {
          const subscription = bus.withPriority(methodSub.priority).subscribe(methodSub.topic, (data) => {
            const deref = thisRef.deref();

            if (deref) {
              const args = new Array(methodSub.index + 2);
              args[methodSub.index] = data;
              args[methodSub.index + 1] = subscription;

              // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
              (deref as any)[methodKey](...args);
            } else {
              // The instance has been GCed, so we can get rid of the subscription
              subscription.dispose();
            }
          });
        }
      }
    };

    try {
      preserveClassIdentity(Class, subClass);
    } catch (e) {
      console.error(e);
    }

    onTransformedClass?.(subClass, Class);
    return subClass;
  } as ClassDecorator;
}

function preserveClassIdentity<Ctor extends Constructor<object>>(source: Ctor, target: Ctor): void {
  for (const name of Object.getOwnPropertyNames(source)) {
    if (name !== "prototype" && name !== "name") {
      const descriptor = Object.getOwnPropertyDescriptor(source, name);

      if (descriptor) {
        Object.defineProperty(target, name, descriptor);
      }
    }
  }

  for (const symbol of Object.getOwnPropertySymbols(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, symbol);

    if (descriptor) {
      Object.defineProperty(target, symbol, descriptor);
    }
  }

  Object.defineProperty(target, "name", {
    value: source.name,
    configurable: true,
  });
}
