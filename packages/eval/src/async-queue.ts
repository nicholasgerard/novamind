/**
 * A bounded async-iterable queue. Producers `push(item)`; consumers iterate
 * with `for await`. `finish()` closes the queue gracefully.
 *
 * Used by `runEvalEvents` to bridge concurrent worker tasks (which push case
 * events) to a single async-iterable (which the SSE stream drains in order).
 */
export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private waiters: Array<(r: IteratorResult<T>) => void> = [];
  private done = false;

  push(item: T): void {
    if (this.done) return;
    const w = this.waiters.shift();
    if (w) {
      w({ value: item, done: false });
    } else {
      this.buffer.push(item);
    }
  }

  finish(): void {
    if (this.done) return;
    this.done = true;
    while (this.waiters.length > 0) {
      const w = this.waiters.shift()!;
      w({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.done) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
