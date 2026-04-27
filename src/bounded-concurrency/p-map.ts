import { createDeferred } from '../utils/index.ts';
import { Semaphore } from './semaphore.ts';

export async function pMap<T, U>(
	items: T[],
	fn: (item: T, index: number) => Promise<U>,
	concurrency: number,
): Promise<U[]> {
	const deferred = createDeferred<U[]>();
	const results = new Array(items.length).fill(null) as U[];
	const inFlight = new Set<number>();
	const completed = new Set<number>();
	let currentIndex: number = 0;
	let errored: boolean = false;

	function run() {
		while (inFlight.size < concurrency) {
			if (currentIndex >= items.length) {
				break;
			}

			const index = currentIndex;
			fn(items[index], index)
				.then((result) => {
					if (errored) {
						return;
					}

					results[index] = result;
					completed.add(index);
					inFlight.delete(index);

					run();
				})
				.catch((err) => {
					if (errored) {
						return;
					}

					errored = true;
					deferred.reject(err);
				});

			inFlight.add(index);
			currentIndex += 1;
		}

		if (completed.size === items.length) {
			deferred.resolve(results);
			return;
		}
	}

	run();

	return deferred.promise;
}

export async function pMapSemaphore<T, U>(
	items: T[],
	fn: (item: T, index: number) => Promise<U>,
	concurrency: number,
): Promise<U[]> {
	const tasks: Promise<U>[] = [];
	const semaphore = new Semaphore(concurrency);

	for (const [index, item] of Array.from(items.entries())) {
		const task = async () => {
			await semaphore.acquire();
			return fn(item, index).then((value) => {
				semaphore.release();
				return value;
			});
		};

		tasks.push(task());
	}

	return Promise.all(tasks).finally(() => {
		semaphore[Symbol.dispose]();
	});
}
