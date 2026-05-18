/**
 * Minimal async queue for bridging callback-oriented producers into SSE-facing
 * async generators. Producers can push events as tool handlers complete while
 * the route consumes the queue with `for await`.
 */
export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private done = false;
  private error: Error | undefined;
  private waiters: Array<{
    reject: (err: Error) => void;
    resolve: (result: IteratorResult<T>) => void;
  }> = [];

  constructor(
    private readonly opts: {
      label?: string;
      maxBuffer?: number;
    } = {},
  ) {}

  push(item: T): void {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value: item, done: false });
      return;
    }
    if (this.buffer.length >= (this.opts.maxBuffer ?? Infinity)) {
      const error = new Error(
        `${this.opts.label ?? "Async event queue"} exceeded its buffer limit.`,
      );
      this.fail(error);
      throw error;
    }
    this.buffer.push(item);
  }

  finish(): void {
    if (this.done) return;
    this.done = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.resolve({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.error) return Promise.reject(this.error);
        if (this.buffer.length > 0) {
          return Promise.resolve({
            value: this.buffer.shift()!,
            done: false,
          });
        }
        if (this.done) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise((resolve, reject) =>
          this.waiters.push({ resolve, reject }),
        );
      },
    };
  }

  private fail(error: Error): void {
    if (this.done) return;
    this.done = true;
    this.error = error;
    this.buffer = [];
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.reject(error);
    }
  }
}
