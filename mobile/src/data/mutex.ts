/** Runs async work one at a time, so read-modify-write cycles on the key-value store never interleave. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

/** All local stores share one lock: sync applies remote records across several of them at once. */
export const sharedMutex = new Mutex();
