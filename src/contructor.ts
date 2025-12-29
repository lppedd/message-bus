/**
 * Represents a class constructor.
 *
 * @internal
 */
export interface Constructor<Instance extends object> {
  new (...args: any[]): Instance;
  readonly name: string;
}
