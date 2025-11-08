<!--suppress HtmlDeprecatedAttribute -->
<h1 align="center">message-bus</h1>
<p align="center">A minimal, type-safe, hierarchical pub-sub message bus for TypeScript and JavaScript</p>
<div align="center">

[![npm](https://img.shields.io/npm/v/@lppedd/message-bus?color=%23de1f1f&logo=npm)](https://www.npmjs.com/package/@lppedd/message-bus)
[![ecmascript](https://img.shields.io/badge/ES-2022-blue?logo=javascript)](https://en.wikipedia.org/wiki/ECMAScript_version_history#13th_edition_%E2%80%93_ECMAScript_2022)
[![status](https://img.shields.io/badge/status-alpha-DB3683)](https://github.com/lppedd/message-bus)
[![build](https://img.shields.io/github/actions/workflow/status/lppedd/message-bus/test.yml.svg?branch=main)](https://github.com/lppedd/message-bus/actions/workflows/test.yml)
[![minified size](https://img.shields.io/bundlejs/size/@lppedd/message-bus)](https://bundlejs.com/?q=@lppedd/message-bus)
[![license](https://img.shields.io/github/license/lppedd/message-bus?color=blue)](https://github.com/lppedd/message-bus/blob/main/LICENSE)

</div>
<img align="center" src="./.github/images/hierarchical-bus.jpg"  alt="Hierarchical Bus" />

### Table of Contents

- [Installation](#installation)
- [API reference](#api-reference)
- [Quickstart](#quickstart)
- [Creating a message bus](#creating-a-message-bus)
  - [Child buses](#child-buses)
- [Publishing messages](#publishing-messages)
  - [Message ordering](#message-ordering-)
- [Subscribing to topics](#subscribing-to-topics)
  - [Single message subscription](#single-message-subscription)
  - [Multiple topic subscription](#multiple-topic-subscription)
- [Asynchronous subscription](#asynchronous-subscription-)
  - [Asynchronous single message subscription](#asynchronous-single-message-subscription)
- [Decorator-based subscription](#decorator-based-subscription)
  - [Unsubscribing programmatically](#unsubscribing-programmatically)
- [Subscription options](#subscription-options)
  - [Limit](#limit)
  - [Priority](#priority)
- [Listening to all messages](#listening-to-all-messages)

### Installation

```sh
npm i @lppedd/message-bus
```

```sh
pnpm add @lppedd/message-bus
```

```sh
yarn add @lppedd/message-bus
```

### API reference

You can find the complete API reference at [lppedd.github.io/message-bus](https://lppedd.github.io/message-bus).

### Requirements

The JavaScript environment must support or polyfill `Map`, `Set`, `WeakMap` and `WeakRef`.

## Quickstart

```ts
// Create a message bus
const bus = createMessageBus();

// Create a topic to publish messages to
const CommandTopic = createTopic<string>("Command");

// Subscribe to the topic using a message handler/callback
bus.subscribe(CommandTopic, (command) => {
  if (command === "shutdown") {
    /* ... */
  }
});

// Publish a new message to the topic
bus.publish(CommandTopic, "shutdown");
```

## Creating a message bus

Use the `createMessageBus` factory function to create a new message bus:

```ts
const bus = createMessageBus();
```

You can customize the message bus behavior by also passing options:

```ts
const bus = createMessageBus({
  // Prevents publishing from failing if a message handler throws
  safePublishing: true,
  // Handles errors thrown by message handlers (requires safePublishing: true).
  // By default, caught unhandled errors are printed to console.error.
  errorHandler: () => {}
});                       
```

### Child buses

A `MessageBus` can create child buses.  
By default, subscriptions registered on a child bus will also receive messages published
by its parent bus.

To create a child bus, call:

```ts
const childBus = bus.createChildBus();
```

## Publishing messages

To publish a message via the message bus, the first step is to define a _topic_.  
A _topic_ is a typed object that uniquely identifies a message channel.

```ts
// Messages sent to the CommandTopic must be strings
const CommandTopic = createTopic<string>("Command");
```

Once you have a topic, you can publish a message:

```ts
bus.publish(CommandTopic, "shutdown");
```

Note that if the topic uses a `void` type, the value parameter can be omitted:

```ts
const PingTopic = createTopic<void>("Ping");

// No value needed
bus.publish(PingTopic);
```

### Message ordering 🚥

The message bus guarantees that messages are always dispatched to handlers in the order
they are published.

If a message is published from within a message handler, it is **not** dispatched immediately.
Instead, it is enqueued and will only be processed after all previously published (but not yet
dispatched) messages. This ensures consistent, FIFO-style message delivery, even across nested
`publish` calls.

## Subscribing to topics

There are multiple ways to subscribe to a topic, but the most straightforward
is to provide a message handler (a callback):

```ts
const subscription = bus.subscribe(CommandTopic, (command) => {
  /* ... */
});
```

The handler is invoked each time a message is published to the topic, whether it is
published on the current bus or any of its parent buses.

You can unsubscribe from the topic at any time by calling `subscription.dispose()`.

### Single message subscription

If you're only interested in the single next message, use:

```ts
bus.subscribeOnce(CommandTopic, (command) => {
  /* ... */
});
```

This subscribes to the topic and automatically disposes the created `Subscription`
after receiving a single message.

### Multiple topic subscription

You can subscribe to multiple topics with a single handler by passing an array of topics:

```ts
const StringTopic = createTopic<string>("...");
const NumberTopic = createTopic<number>("...");

bus.subscribe([StringTopic, NumberTopic], (data /* string | number */) => {
  /* ... */
});
```

The `data` parameter is automatically inferred as `string | number`, based on the union
of all topic types. This pattern is useful when the same logic should apply to multiple
related message types.

## Asynchronous subscription ⚡

An alternative way to subscribe to a topic is using async iterations:

```ts
const subscription = bus.subscribe(CommandTopic); // AsyncIterableIterator<string>
```

This creates a **lazy** subscription: no actual subscription is made until you
start consuming messages.  
You can do that using a `for await ... of` loop:

```ts
for await (const command of subscription) {
  /* ... */
}
```

Or by awaiting the next message directly with `subscription.single()`:

```ts
const command = await subscription.single(); // Promise<string>
```

Note that calling `single()` does not automatically dispose the subscription.
In contrast, a `for await ... of` loop disposes it automatically when the iteration
ends, whether normally or due to a `break`, a `return`, or an error.

If you use `single()` and no longer need the subscription afterward, remember to
dispose it manually with `subscription.dispose()`.

### Asynchronous single message subscription

The asynchronous alternative to `bus.subscribeOnce(topic, handler)` is:

```ts
const command = await bus.subscribeOnce(CommandTopic); // Promise<string>
```

> [!TIP]
> If you are only interested in a single message, prefer using `subscribeOnce(Topic)`
> over `subscribe(Topic) + subscription.single()`. This avoids the need to manually
> dispose the subscription.

## Decorator-based subscription

The library also supports a declarative way to subscribe to topics, by using
TypeScript's experimental decorators.

When applied to a method parameter, a topic created with `createTopic` can act
as a parameter decorator. This allows wiring up subscriptions directly inside
class methods.

To enable this behavior, decorate the class with `@AutoSubscribe` and pass the target
message bus, where subscriptions will be created:

```ts
@AutoSubscribe(messageBus) // or () => messageBus, if it needs to be lazily resolved
export class CommandProcessor {
  onCommand(@CommandTopic() command: string): void {
    if (command === "shutdown") {
      /* ... */
    }
  }
}
```

This automatically subscribes the `onCommand` method to `CommandTopic`,
and unsubscribes it when the instance is garbage-collected.

> [!NOTE]
> The class must be instantiated, either manually or via a third-party mechanism,
> for the subscription to be activated. Decorating the class alone does not trigger
> any subscriptions.

### Unsubscribing programmatically

If you do not want to rely on garbage collection to clean up the subscriptions,
you can unsubscribe manually. To do that, declare a `Subscription` parameter
immediately after the decorated topic parameter. The runtime will automatically
inject the corresponding subscription object:

```ts
@AutoSubscribe(messageBus)
export class CommandProcessor {
  onCommand(@CommandTopic() command: string, subscription: Subscription): void {
    if (command === "shutdown") {
      /* ... */
      subscription.dispose();
    }
  }
}
```

> [!NOTE]
> Only one `Subscription` parameter is allowed per method, and it must follow the topic parameter.

## Subscription options

### Limit

Limits how many messages a subscription can receive before it is automatically disposed.

This option is useful when you are only interested in the **first n** messages of a topic
and want to avoid manually disposing the subscription.

```ts
// The handler will be called at most 3 times
bus.withLimit(3).subscribe(CommandTopic, (command) => {
  /* ... */
});
```

The same applies to asynchronous subscriptions:

```ts
// The loop will iterate up to 3 times
for await (const command of bus.withLimit(3).subscribe(CommandTopic)) {
  /* ... */
}
```

If fewer than `limit` messages are published, the subscription simply remains idle
unless manually disposed.

> [!NOTE]
> `withLimit` returns a subscription builder, not the message bus itself.  
> This builder allows fluently applying options before finalizing the subscription.

### Priority

Sets the delivery priority of a subscription.

Lower values mean higher priority: for example, a subscription with priority `0`
will receive messages before other subscriptions with priority `1`.

By default, all subscriptions use a priority of `1`.

```ts
bus.withPriority(0).subscribe(CommandTopic, (command) => {
  /* ... */
});
```

You can also combine `withPriority` and `withLimit`:

```ts
// Subscribe with both a custom priority and message limit
bus.withLimit(2).withPriority(0).subscribe(CommandTopic, (command) => {
  /* ... */
});
```

## Listening to all messages

In addition to subscribing to specific topics, you can also listen to all messages
published on the bus, regardless of topic. Listeners are invoked before any topic-specific
subscribers, and they are notified for every message, even if no topic subscriptions exist.

This might be useful for logging, analytics, or debugging.

```ts
const listener: MessageListener = (topic, data, subscriberCount) => {
  console.log(`Message published to ${topic} with ${subscriberCount} subscribers: ${data}`);
};

// Add the listener
bus.addListener(listener);

// Remove the listener later, if needed
bus.removeListener(listener);
```

**Important**: listeners only run on the bus where the message is initially published.
If the message propagates to child buses (the default behavior), or to the parent bus,
listeners added to those buses will not be called.

## License

[MIT license](https://github.com/lppedd/message-bus/blob/main/LICENSE)

2025-present [Edoardo Luppi](https://github.com/lppedd)  
