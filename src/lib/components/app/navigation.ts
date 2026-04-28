import type { Component } from 'svelte';
import UsersIcon from '@lucide/svelte/icons/users';
import NewspaperIcon from '@lucide/svelte/icons/newspaper';
import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
import UserRoundIcon from '@lucide/svelte/icons/user-round';
import { routes } from '$lib/routes';

export type AppNavKey = 'club' | 'feed' | 'chat' | 'profile';

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
	badgeCount?: number;
	placement?: AppNavPlacement;
	children?: AppNavChildItem[];
};

export type AppNavBadgeCounts = {
	chatUnreadCount?: number;
};

export type AppNavigationOptions = {
	hasClubAccess?: boolean;
	badgeCounts?: AppNavBadgeCounts;
};

const clubHrefFor = (clubId: string | null | undefined) => {
	if (!clubId) return routes.noClub;
	return routes.clubHome(clubId);
};

// Route structure:
// - Club scoped: /club/[clubId], /club/[clubId]/sessions, /club/[clubId]/projects, /club/[clubId]/members
// - Non-club: /feed, /chat, /profile, /settings, /notifications
export const buildAppNavigation = (
	clubId: string | null | undefined,
	options: AppNavigationOptions = {}
): AppNavItem[] => {
	const clubHref = clubHrefFor(clubId);
	const hasClubAccess = options.hasClubAccess ?? Boolean(clubId);
	const badgeCounts = options.badgeCounts ?? {};
	const chatBadgeCount = Math.max(badgeCounts.chatUnreadCount ?? 0, 0) || undefined;
	const items: AppNavItem[] = [
		{
			key: 'club',
			label: 'Club',
			href: clubHref,
			icon: UsersIcon,
			children: clubId
				? [
						{ key: 'sessions', label: 'Sessions', href: `${clubHref}/sessions` },
						{ key: 'projects', label: 'Projects', href: `${clubHref}/projects` },
						{ key: 'members', label: 'Members', href: `${clubHref}/members` }
					]
				: []
		},
		{
			key: 'chat',
			label: 'Chat',
			href: routes.chat,
			icon: MessageCircleIcon,
			badgeCount: chatBadgeCount
		},
		{
			key: 'profile',
			label: 'Profile',
			href: routes.profile,
			icon: UserRoundIcon,
			placement: 'bottom',
			children: [
				{ key: 'settings', label: 'Settings', href: routes.settings },
				{ key: 'notifications', label: 'Notifications', href: routes.notifications }
			]
		}
	];

	if (hasClubAccess) {
		items.splice(1, 0, { key: 'feed', label: 'Feed', href: routes.feed, icon: NewspaperIcon });
	}

	return items;
};
