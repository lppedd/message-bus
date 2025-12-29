/**
 * Prevents the TS compiler from performing only structural matching on `T`.
 *
 * Without this type, passing an inline plain object to `publish<T>(Topic<T>, T)`
 * would result in missing editor assistance (go-to declaration, find usages,
 * refactoring), and in being able to add properties not declared by the type `T`.
 */
export type Strict<T> = T extends T ? T : T;

/**
 * Removes the `readonly` modifier from top-level properties of objects of type `T`.
 *
 * @internal
 */
export type Writable<T> = { -readonly [P in keyof T]: T[P] };

/**
 * Represents a class constructor.
 *
 * @internal
 */
export interface Constructor<Instance extends object> {
  new (...args: any[]): Instance;
  readonly name: string;
}
