<script lang="ts">
	// Chat context banner: a pinned strip under the room title that links the chat to the thing it
	// is about — the club dashboard, the project page, the application detail page, or the join
	// request's club. Generic over contextType so every room type renders the same way; the page
	// decides the href/label (role-aware for join requests).
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import DoorOpenIcon from '@lucide/svelte/icons/door-open';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { cn } from '$lib/utils.js';

	type Props = {
		contextType: 'club' | 'project' | 'clubApplication' | 'joinRequest';
		contextId: string;
		contextName: string;
		href: string;
		label: string;
		class?: string;
	};

	let { contextType, contextId, contextName, href, label, class: className }: Props = $props();

	const icons = {
		club: UsersIcon,
		project: FolderKanbanIcon,
		clubApplication: FileTextIcon,
		joinRequest: DoorOpenIcon
	} as const;
	let Icon = $derived(icons[contextType]);
</script>

<a
	{href}
	data-context-type={contextType}
	data-context-id={contextId}
	data-sveltekit-preload-data="hover"
	class={cn(
		'flex w-full items-center gap-3 rounded-xl border border-orange-100 bg-orange-50 px-4 py-2.5 text-left transition-colors hover:bg-orange-100/70 focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:outline-none',
		className
	)}
>
	<span
		class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-orange-500 ring-1 ring-orange-100"
	>
		<Icon class="size-4" />
	</span>
	<span class="flex min-w-0 flex-1 flex-col">
		<span class="type-sm-bold truncate text-orange-600">{label}</span>
		<span class="type-xs truncate text-muted-foreground">{contextName}</span>
	</span>
	<ArrowRightIcon class="size-4 shrink-0 text-orange-500" />
</a>
