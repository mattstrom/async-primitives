import { createDeferred, type Deferred } from './utils/deferred.js';

/**
 * An asynchronous queue implementation that supports backpressure and allows
 * for asynchronous enqueueing and dequeueing of items.
 *
 * The queue can operate with a defined capacity, and when at capacity, enqueue
 * operations will block until space becomes available. Consumers can asynchronously
 * dequeue items, and the queue will notify waiting consumers when new items are
 * available.
 *
 * Once the queue is closed, no more items can be enqueued, and pending consumers
 * are notified of closure.
 *
 * @template T The type of items stored in the queue.
 */
export class AsyncQueue<T> {
	private _closed: boolean = false;
	private queue: T[] = [];

	private inbound: Deferred<void>[] = [];
	private consumers: Deferred<T>[] = [];

	get closed(): boolean {
		return this._closed;
	}

	get atCapacity() {
		return this.queue.length >= this.capacity;
	}

	constructor(private capacity: number = Infinity) {}

	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		while (true) {
			try {
				yield await this.dequeue();
			} catch (err) {
				return;
			}
		}
	}

	async enqueue(item: T): Promise<void> {
		if (this.closed) {
			throw new Error('Queue closed');
		}

		if (this.atCapacity) {
			const deferred = createDeferred<void>();
			this.inbound.push(deferred);

			await deferred.promise;
		}

		const consumer = this.consumers.shift();

		if (consumer) {
			consumer.resolve(item);
		} else {
			this.queue.push(item);
		}
	}

	async dequeue(): Promise<T> {
		if (this.closed && this.queue.length === 0) {
			throw new Error('Queue closed');
		}

		if (this.queue.length > 0) {
			const item = this.queue.shift()!;
			this.inbound.shift()?.resolve();
			return item;
		}

		const deferred = createDeferred<T>();
		this.consumers.push(deferred);

		return deferred.promise;
	}

	close() {
		this._closed = true;
		this.drain();
	}

	private drain(): void {
		if (!this.closed) {
			return;
		}

		while (this.queue.length > 0 && this.consumers.length > 0) {
			this.consumers.shift()!.resolve(this.queue.shift() as T);
		}

		for (const consumer of this.consumers) {
			consumer.reject(new Error('Queue closed'));
		}

		this.consumers = [];
	}
}
