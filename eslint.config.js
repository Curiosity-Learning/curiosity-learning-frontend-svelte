import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		files: ['src/**/*.{js,ts,svelte,svelte.js,svelte.ts}'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: 'convex-svelte',
							importNames: ['useQuery'],
							message: 'Use useStableQuery from $lib/convex/use-stable-query.svelte.'
						}
					]
				}
			]
		}
	},
	{
		// Parent "View as Child" (CL-801): public mutations and actions must use the guarded
		// builders in src/convex/functions.ts, which refuse every write while a parent is viewing
		// as their child. (This block replaces the rule options above for these files, so it
		// repeats them.)
		files: ['src/convex/**/*.ts'],
		ignores: ['src/convex/functions.ts', 'src/convex/_generated/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: 'convex-svelte',
							importNames: ['useQuery'],
							message: 'Use useStableQuery from $lib/convex/use-stable-query.svelte.'
						},
						...['./_generated/server', '../_generated/server'].map((name) => ({
							name,
							importNames: ['mutation', 'action', 'mutationGeneric', 'actionGeneric'],
							message:
								"Import public mutations and actions from './functions' (View as Child guard, CL-801)."
						})),
						{
							name: 'convex/server',
							importNames: ['mutationGeneric', 'actionGeneric'],
							message:
								"Import public mutations and actions from './functions' (View as Child guard, CL-801)."
						}
					]
				}
			]
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	},
	{
		ignores: ['src/convex/_generated/**']
	},
	{
		files: ['src/lib/components/ui/button/button.svelte']
	},
	{
		files: ['src/lib/convex/use-stable-query.svelte.ts'],
		rules: {
			'no-restricted-imports': 'off'
		}
	}
);
