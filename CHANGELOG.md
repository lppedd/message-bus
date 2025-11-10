# Changelog

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
