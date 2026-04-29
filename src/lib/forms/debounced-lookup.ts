type DebouncedLookupOptions<TResult> = {
	key: string;
	lookup: () => Promise<TResult>;
	onStart?: () => void;
	onSuccess: (result: TResult) => void;
	onError: (error: unknown) => void;
};

export const createDebouncedLookup = <TResult>(delayMs: number) => {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let activeKey = '';

	const stop = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		activeKey = '';
	};

	const schedule = (options: DebouncedLookupOptions<TResult>) => {
		stop();
		activeKey = options.key;
		options.onStart?.();
		timer = setTimeout(() => {
			void (async () => {
				try {
					const result = await options.lookup();
					if (activeKey !== options.key) return;
					options.onSuccess(result);
				} catch (error) {
					if (activeKey !== options.key) return;
					options.onError(error);
				}
			})();
		}, delayMs);
	};

	return { schedule, stop };
};
