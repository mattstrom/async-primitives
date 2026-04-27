export type TaskFn<T> = (signal: AbortSignal) => Promise<T>;

/**
 * Represents a cancellable asynchronous task.
 * Allows for the execution of a promise-based function that can be cancelled
 * mid-execution using an AbortSignal.
 *
 * @template T The type of the result returned by the task function.
 */
export class CancellableTask<T> {
	private task: TaskFn<T>;
	private abortController: AbortController;
	private running: boolean = false;
	private completed: boolean = false;

	constructor(fn: (signal: AbortSignal) => Promise<T>) {
		this.task = fn;
		this.abortController = new AbortController();
	}

	async start(): Promise<T> {
		// Execute fn with the abort signal
		// If cancelled, reject with "Cancelled" (or custom reason)
		const promise = new Promise<T>((resolve, reject) => {
			const { signal } = this.abortController;

			this.running = true;

			this.task(signal)
				.then((result) => {
					if (!this.isCancelled()) {
						resolve(result);
						this.completed = true;
					}
				})
				.catch((err) => {
					reject(err);
				})
				.finally(() => {
					this.running = false;
				});
		});

		return promise;
	}

	cancel(reason?: string): void {
		// Abort the controller. No-op if already completed.
		if (this.completed) {
			return;
		}

		this.abortController.abort(reason ?? 'Cancelled');
	}

	isCancelled(): boolean {
		return this.abortController.signal.aborted;
	}

	isRunning(): boolean {
		return this.running;
	}
}

/**
 * A TaskGroup manages multiple cancellable tasks, providing methods to add, cancel, wait, and race tasks.
 */
export class TaskGroup {
	private tasks = new Map<CancellableTask<unknown>, Promise<unknown>>();

	add<T>(fn: TaskFn<T>): CancellableTask<T> {
		// Create a CancellableTask, start it, track it
		const task = new CancellableTask(fn);

		this.tasks.set(task, task.start());

		return task;
	}

	cancelAll(reason?: string): void {
		// Cancel every task in the group
		for (const [task] of this.tasks) {
			task.cancel(reason);
		}
	}

	async waitForAll(): Promise<void> {
		// Wait for all tasks to settle (complete, fail, or cancel)
		const tasks = [...this.tasks.values()];

		await Promise.allSettled(tasks);
	}

	async race<T>(fns: TaskFn<T>[]): Promise<T> {
		// Start all, return first success, cancel the rest
		for (const fn of fns) {
			this.add(fn);
		}

		return Promise.any([...this.tasks.values()] as Promise<T>[]).then((result) => {
			this.cancelAll();
			return result;
		});
	}
}

/**
 * Executes a given task function with a specified timeout duration.
 * If the task does not complete within the specified time, it is canceled and a rejection with a "Timeout" error occurs.
 * Cleans up the associated timer when the task completes.
 *
 * @param {TaskFn<T>} fn The task function to execute, which returns a promise.
 * @param {number} ms The timeout duration in milliseconds. If the task does not complete within this duration, it will be canceled.
 * @return {Promise<T>} A promise that resolves with the result of the task function if it completes within the timeout, or rejects with "Timeout" if it exceeds the specified duration.
 */
export async function withTimeout<T>(fn: TaskFn<T>, ms: number): Promise<T> {
	// Run fn with a timeout
	// If fn doesn't complete in ms, cancel and reject with "Timeout"
	// Clean up timer if fn completes first

	const task = new CancellableTask(fn);
	const timeout = AbortSignal.timeout(ms);

	const handler = () => {
		timeout.removeEventListener('abort', handler);
		task.cancel('Timeout');
	};

	timeout.addEventListener('abort', handler);

	try {
		return task.start();
	} finally {
		timeout.removeEventListener('abort', handler);
	}
}
