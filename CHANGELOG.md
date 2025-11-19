# Changelog

## 0.8.0

- Replaced the `@AutoSubscribe` decorator with `MessageBus.subscribeInstance`.

  ```ts
  // Create an instance, as you'd normally do
  const processor = new CommandProcessor();

  // Initialize subscriptions using the class's methods as handlers
  messageBus.subscribeInstance(processor);
  ```

- Supported specifying a `limit` value via the second parameter of a topic decorator.

## 0.7.1

- Changed `createTopic` and `createUnicastTopic` to default the payload type `T` to `void`.  
  Topics without a message payload no longer require specifying a type explicitly:

  ```ts
  // Before
  const PingTopic = createTopic<void>("Ping");
  
  // After
  const PingTopic = createTopic("Ping");
  ```
- Cleaned up internal code.

## 0.7.0

- Added support for passing arbitrary additional arguments from interceptors to message handlers.  
  The `MessageInterceptor.handler` signature allows passing extra parameters to the downstream `MessageHandler`.

  ```ts
  messageBus.addInterceptor({              /* ...other: any[] */
    handler: (_, next, data) => next(data, appContext, internal)
  });
  ```

## 0.6.3

- Fixed package exports.

## 0.6.2

- Refactored topic creation to use separate functions for `unicast` and `multicast` topics.
- Simplified `MessageBusOptions` by replacing nullable properties with non-nullable equivalents.

## 0.6.1

- Improved TypeScript type checking for message data passed to `MessageBus.publish` and `MessageBus.publishAsync`.

## 0.6.0

- Introduced message interceptors. An interceptor allows inspecting, modifying, or vetoing messages
  before they are dispatched to subscribed handlers.  
  Interceptors can be added via `MessageBus.addInterceptor` and removed via `MessageBus.removeInterceptor`.
- Removed `MessageBus.clearListeners`.

## 0.5.0

- Reworked generic type parameters for improved type inference and stricter type safety.

## 0.4.4

- Added `MessageBus.clearListeners` to remove all message listeners at once.

## 0.4.3

- Cleaned up internal code in preparation for the next minor release.

## 0.4.2

- Simplified internal message publishing and error handling.

## 0.4.1

- Avoided incorrectly removing `undefined` or `null` handler return values.
- Improved type information for `MessageListener`.

## 0.4.0

- Introduced `MessageBus.publishAsync` to allow publishing messages and awaiting the completion
  of all subscribed handlers.

  The promise returned by `publishAsync` resolves once all subscribed handlers have completed:
  - For `unicast` topics, it resolves to the single handler's result.
  - For `multicast` topics, it resolves to an array of all handler results.

  If one or more handlers throw, the returned promise is rejected:
  - With the original error if a single handler failed.
  - With an `AggregateError` containing all errors if multiple handlers failed.

## 0.3.5

- Reworked message handler error handling so that each error is processed as soon as the handler completes.
- Added error handling for errors thrown by message listeners or the `errorHandler` itself (in which case
  the error is always logged to `console.error`).

## 0.3.4

- Added support for asynchronous message listeners.
- Reverted to aggregating multiple errors into one before forwarding it to `MessageBusOptions.errorHandler`.
- Applied minor internal refactorings to improve reliability.

## 0.3.3

- Improved type inference for `UnicastTopic`s.  
  TypeScript correctly infers `UnicastTopic` **only** when `mode: "unicast"` is specified.

## 0.3.2

- Enforced that only a single `UnicastTopic` subscription can exist across a message bus hierarchy.
- Forwarded each caught message handler error individually to `MessageBusOptions.errorHandler`,
  instead of aggregating multiple errors into one.
- Refactored the machinery's internals to improve its reliability.

## 0.3.1

- Added JSDoc to `MessageHandler` and `MessageListener`.

## 0.3.0

- Introduced **multicast** and **unicast** topics for more precise subscription control.
- Added support for asynchronous message handlers.
- Unified error handling via `MessageBusOptions.errorHandler`.  
  All errors thrown from message handlers are now forwarded to the `errorHandler`.

## 0.2.0

- Enabled subscribing to multiple topics in a single call while preserving type safety.
- Added support for inheriting message listeners from the parent bus when creating a child bus.  
  Listener inheritance is configurable via the `copyListeners` option.

## 0.1.3

- Exposed the dummy `__type?: T` property on the `Topic<T>` interface to fix
  type compatibility issues in `MessageBus.publish` overloads.

## 0.1.2

- Refined the `@AutoSubscribe` decorator enhancement introduced in 0.1.1.

## 0.1.1

- Improved `@AutoSubscribe` interoperability with other decorator-based libraries.  
  The decorator now optionally returns the transformed class to support external
  consumption (e.g., for DI container registration).

## 0.1.0

Initial release, with most documented features already implemented.
