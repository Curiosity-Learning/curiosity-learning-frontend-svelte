import { browser } from '$app/environment';
import { goto } from '$app/navigation';

type AuthNavigationOptions = {
	replaceState?: boolean;
};

export const navigateAfterAuthChange = async (
	path: string,
	options: AuthNavigationOptions = {}
) => {
	if (browser) {
		if (options.replaceState) {
			window.location.replace(path);
			return;
		}
		window.location.assign(path);
		return;
	}

	await goto(path, { replaceState: options.replaceState });
};
