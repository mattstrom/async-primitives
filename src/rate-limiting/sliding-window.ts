import { createDeferred, type Deferred } from '../utils/deferred.ts';

export interface SlidingWindowOptions {
	maxRequests: number;
	windowMs: number;
	signal?: AbortSignal;
}

export class SlidingWindowLimiter implements Disposable {
	private requests: number[] = [];
	private window!: [number, number];

	private queue: Deferred<void>[] = [];
	private timer: NodeJS.Timeout | null = null;
	private disposed: boolean = false;

	get count() {
		return this.requests.length;
	}

	get available() {
		return this.options.maxRequests - this.count;
	}

	constructor(private options: SlidingWindowOptions) {
		// Initialize window tracking
		this.adjustWindow();
		this.options.signal?.addEventListener('abort', this.onAbort);
	}

	private onAbort = () => {
		this[Symbol.dispose]();
	};

	[Symbol.dispose]() {
		if (this.disposed) {
			return;
		}

		this.options.signal?.removeEventListener('abort', this.onAbort);

		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}

		for (const item of this.queue) {
			item.reject('Aborted');
		}
	}

	async acquire(): Promise<void> {
		// Wait until a request is allowed within the window
		if (this.tryAcquire()) {
			return;
		}

		const deferred = createDeferred<void>();
		this.queue.push(deferred);

		return deferred.promise;
	}

	tryAcquire(): boolean {
		// Non-blocking check
		this.adjustWindow();

		if (this.available > 0) {
			this.addRequest();
			return true;
		}

		return false;
	}

	private addRequest(): boolean {
		if (this.available <= 0) {
			return false;
		}

		const end = this.window[1];

		this.requests.push(end);

		return true;
	}

	private adjustWindow(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}

		const end = Date.now();
		const start = end - this.options.windowMs;

		this.window = [start, end];

		// Assumes requests are inherently sorted by time
		while (this.requests.length > 0 && this.requests.at(0)! <= start) {
			this.requests.shift();
		}

		this.fulfillPending();

		const earliest = this.requests.at(0);

		if (earliest !== undefined) {
			const expiration = earliest + this.options.windowMs - end;

			this.timer = setTimeout(() => {
				this.adjustWindow();
			}, expiration);
		}
	}

	private fulfillPending(): void {
		while (this.queue.length > 0 && this.available > 0) {
			const deferred = this.queue.shift()!;
			this.requests.push(Date.now());
			deferred.resolve();
		}
	}
}
