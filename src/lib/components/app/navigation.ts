import type { Component } from 'svelte';
import UsersIcon from '@lucide/svelte/icons/users';
import NewspaperIcon from '@lucide/svelte/icons/newspaper';
import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
import UserRoundIcon from '@lucide/svelte/icons/user-round';
import { routes } from '$lib/routes';

export type AppNavKey = 'club' | 'noClub' | 'feed' | 'chat' | 'profile';

export type AppNavPlacement = 'top' | 'bottom';

export type AppNavChildItem = {
	key: string;
	label: string;
	href: string;
};

export type AppNavItem = {
	key: AppNavKey;
	label: string;
	href: string;
	icon: Component<{ class?: string }>;
	placement?: AppNavPlacement;
	children?: AppNavChildItem[];
};

export type AppNavigationOptions = {
	hasClubAccess?: boolean;
};

// Route structure:
// - Club scoped: /club/[clubId], /club/[clubId]/sessions, /club/[clubId]/projects, /club/[clubId]/members
// - Non-club: /feed, /chat, /profile, /settings, /notifications
export const buildAppNavigation = (
	clubId: string | null | undefined,
	options: AppNavigationOptions = {}
): AppNavItem[] => {
	const hasClubAccess = options.hasClubAccess ?? Boolean(clubId);
	const items: AppNavItem[] = [];

	if (hasClubAccess && clubId) {
		const clubHref = routes.clubHome(clubId);
		items.push(
			{
				key: 'club',
				label: 'Club',
				href: clubHref,
				icon: UsersIcon,
				children: [
					{ key: 'sessions', label: 'Sessions', href: `${clubHref}/sessions` },
					{ key: 'projects', label: 'Projects', href: `${clubHref}/projects` },
					{ key: 'members', label: 'Members', href: `${clubHref}/members` }
				]
			},
			{ key: 'feed', label: 'Feed', href: routes.feed, icon: NewspaperIcon },
			{
				key: 'chat',
				label: 'Chat',
				href: routes.chat,
				icon: MessageCircleIcon
			}
		);
	} else {
		items.push({
			key: 'noClub',
			label: 'New club',
			href: routes.newClub,
			icon: UsersIcon
		});
	}

	items.push({
		key: 'profile',
		label: 'Profile',
		href: routes.profile,
		icon: UserRoundIcon,
		placement: 'bottom',
		children: [
			{ key: 'settings', label: 'Settings', href: routes.settings },
			{ key: 'notifications', label: 'Notifications', href: routes.notifications }
		]
	});

	return items;
};
