import type { AsyncQueue } from './async-queue.ts';

/**
 * Processes items from a source queue to a sink queue using a worker function
 * with a specified level of concurrency. The method ensures that the sink is
 * closed once processing is completed.
 *
 * @param {AsyncQueue<T>} source - The source queue containing items to be processed.
 * @param {(item: T) => Promise<U>} worker - An asynchronous worker function to process each item from the source queue.
 * @param {AsyncQueue<U>} sink - The sink queue where processed items will be enqueued.
 * @param {number} concurrency - The maximum number of concurrent workers that can process items from the source queue.
 * @return {Promise<void>} A promise that resolves once all items are processed and the sink is closed.
 */
export async function pipeline<T, U>(
	source: AsyncQueue<T>,
	worker: (item: T) => Promise<U>,
	sink: AsyncQueue<U>,
	concurrency: number,
): Promise<void> {
	// Pull from source, process with worker, push to sink
	// Run up to `concurrency` workers simultaneously
	// Stop when source is closed and drained
	// Close sink when done

	async function processor() {
		for await (const item of source) {
			const result = await worker(item);
			sink.enqueue(result);
		}
	}

	const processors: Promise<void>[] = [];

	for (let i = 0; i < concurrency; i += 1) {
		processors.push(processor());
	}

	try {
		await Promise.all(processors);
	} finally {
		sink.close();
	}
}
