/**
 * Concurrency Control Utilities
 *
 * Provides semaphore-based concurrency limiting for parallel operations.
 */

export class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(maxConcurrent: number = 8) {
    if (maxConcurrent < 1) {
      throw new Error('Semaphore maxConcurrent must be at least 1');
    }
    this.permits = maxConcurrent;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }

  get availablePermits(): number {
    return this.permits;
  }

  get queueSize(): number {
    return this.queue.length;
  }
}
