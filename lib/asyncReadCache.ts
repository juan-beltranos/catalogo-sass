/** Shares pending reads as well as completed values; mutations invalidate both. */
export class AsyncReadCache<K, V> extends Map<K, V> {
  private pending = new Map<K, Promise<V>>();

  getOrLoad(key: K, load: () => Promise<V>): Promise<V> {
    if (this.has(key)) return Promise.resolve(this.get(key)!);
    const current = this.pending.get(key);
    if (current) return current;

    const request = Promise.resolve().then(load).then((value) => {
      // An invalidation or an explicit update takes precedence over an old read.
      if (this.pending.get(key) === request) super.set(key, value);
      return value;
    }).finally(() => {
      if (this.pending.get(key) === request) this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }

  override set(key: K, value: V): this {
    this.pending.delete(key);
    return super.set(key, value);
  }

  override delete(key: K): boolean {
    this.pending.delete(key);
    return super.delete(key);
  }

  override clear(): void {
    this.pending.clear();
    super.clear();
  }
}
