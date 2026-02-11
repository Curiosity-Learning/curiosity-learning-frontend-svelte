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
	placement?: AppNavPlacement;
	children?: AppNavChildItem[];
};

const clubHrefFor = (clubId: string | null | undefined) => {
	if (!clubId) return routes.onboardingGetStarted;
	return routes.clubHome(clubId);
};

// Route structure:
// - Club scoped: /[clubId], /[clubId]/sessions, /[clubId]/projects, /[clubId]/members
// - Non-club: /feed, /chat, /profile, /settings, /notifications
export const buildAppNavigation = (clubId: string | null | undefined): AppNavItem[] => {
	const clubHref = clubHrefFor(clubId);
	return [
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
		{ key: 'chat', label: 'Chat', href: routes.chat, icon: MessageCircleIcon },
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
};
