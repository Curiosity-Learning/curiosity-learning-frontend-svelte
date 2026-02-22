// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			token?: string;
		}

		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			headerTitleHint?: string;
			headerTitleHintPath?: string;
		}
		// interface Platform {}
	}
}

export {};
