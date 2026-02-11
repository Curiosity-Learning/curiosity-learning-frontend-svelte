export const formatDateTime = (input: number | null | undefined) => {
	if (!input) {
		return 'N/A';
	}
	return new Date(input).toLocaleString();
};

export const toTimestamp = (value: string) => {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.getTime();
};
