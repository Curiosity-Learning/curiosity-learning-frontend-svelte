<script lang="ts">
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { HeaderTabs, PageHeaderBanner } from '$lib/components/app';
	import type { HeaderTabItem } from '$lib/components/app/header-tabs.svelte';
	import { ATTENDANCE_LOCK_WINDOW_MS, SESSION_PHOTO_UPLOAD_WINDOW_MS } from '$lib/domain/session';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { t } from '$lib/i18n';
	import LockIcon from '@lucide/svelte/icons/lock';

	let { children } = $props();

	let sessionId = $derived((page.params as Record<string, string | undefined>).sessionId ?? '');
	let sessionIdTyped = $derived(sessionId ? (sessionId as Id<'sessions'>) : null);

	const sessionResponse = useStableQuery(api.sessions.getById, () =>
		sessionIdTyped ? { sessionId: sessionIdTyped } : 'skip'
	);
	let session = $derived(sessionResponse.data ?? null);

	const clubsResponse = useStableQuery(api.clubs.getMyClubs, {});
	let clubPermissions = $derived(
		session
			? ((clubsResponse.data ?? []).find((club) => club.clubId === session.clubId)
					?.rolePermissions ?? [])
			: []
	);
	let hasSessionPhotoPermission = $derived(clubPermissions.includes('session_photo:create'));

	const hasPhotosResponse = useStableQuery(api.sessions.hasPhotos, () =>
		sessionIdTyped ? { sessionId: sessionIdTyped } : 'skip'
	);
	let hasPhotos = $derived(Boolean(hasPhotosResponse.data));

	// Attendance can no longer change once the post-session lock window has passed; the tab
	// carries a lock icon instead of an in-content explanation (CEO decision 2026-07-11).
	let attendanceLocked = $derived(
		Boolean(session && Date.now() > session.endTime + ATTENDANCE_LOCK_WINDOW_MS)
	);

	// Photos exist only from session start until the upload window closes. Before then the tab
	// would be an affordance the user discovers they can't use — hide it entirely. Once photos
	// exist, the tab stays (viewing them is always allowed).
	let photoUploadWindowOpen = $derived.by(() => {
		if (!session || session.cancelled) return false;
		const now = Date.now();
		return now >= session.startTime && now <= session.endTime + SESSION_PHOTO_UPLOAD_WINDOW_MS;
	});
	let showPhotosTab = $derived(hasPhotos || (photoUploadWindowOpen && hasSessionPhotoPermission));

	let tabs = $derived.by<HeaderTabItem[]>(() => {
		if (!sessionId) return [];
		const items: HeaderTabItem[] = [
			{
				label: 'Activities',
				href: `/session/${sessionId}/activities`,
				aliases: [`/session/${sessionId}`]
			},
			{
				label: 'Attendees',
				href: `/session/${sessionId}/attendees`,
				...(attendanceLocked
					? { Icon: LockIcon, iconLabel: t('sessionAttendance.lockedIconLabel') }
					: {})
			}
		];
		if (showPhotosTab) {
			items.push({
				label: t('sessionPhotos.title'),
				href: `/session/${sessionId}/photos`
			});
		}
		return items;
	});
</script>

{#if tabs.length}
	<PageHeaderBanner>
		<HeaderTabs ariaLabel="Session tabs" {tabs} />
	</PageHeaderBanner>
{/if}

{@render children()}
