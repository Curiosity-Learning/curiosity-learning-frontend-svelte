<script lang="ts">
	import LockIcon from '@lucide/svelte/icons/lock';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { PageHeaderTitle } from '$lib/components/app';
	import UpdateCard from '$lib/components/app/feed/update-card.svelte';
	import type { UpdateCardMediaItem } from '$lib/components/app/feed/update-card.svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { routes } from '$lib/routes';
	import { t } from '$lib/i18n';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const profileResponse = useStableQuery(api.profiles.getById, () => ({
		profileId: data.profile?.profileId as Id<'profiles'>
	}));

	let profile = $derived(profileResponse.data ?? data.profile);

	const fullName = $derived(
		[profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim()
	);
	let displayName = $derived(fullName || profile?.username || t('profileDetail.fallbackName'));
	const handle = $derived(profile?.username ? `@${profile.username}` : '');
	const fallback = $derived((profile?.username ?? profile?.firstName ?? '?').slice(0, 2).toUpperCase());
	const bio = $derived(profile?.about?.trim() ?? '');

	const profileImageUrl = $derived.by(() => {
		const assetId = profile?.profileImageMediaAssetId ?? null;
		if (assetId && data.initialProfileImage?.assetId === assetId) {
			return data.initialProfileImage.signedUrl;
		}
		return null;
	});

	let clubs = $derived(profile?.clubs ?? []);

	let projectCoverById = $derived.by(() => {
		return new Map(
			(data.initialProjectCovers ?? []).map((asset) => [asset.assetId, asset.signedUrl] as const)
		);
	});

	const projectCoverUrl = (project: { coverImageMediaAssetId: Id<'mediaAssets'> | null }) => {
		if (!project.coverImageMediaAssetId) return null;
		return projectCoverById.get(project.coverImageMediaAssetId) ?? null;
	};

	let currentProjects = $derived(profile?.projects.current ?? []);
	let showcaseProjects = $derived(profile?.projects.showcase ?? []);

	let initialUpdateMediaById = $derived.by(() => {
		return new Map((data.initialUpdateMedia ?? []).map((asset) => [asset.assetId, asset] as const));
	});
	let updates = $derived.by(() => {
		return (profile?.updates ?? []).map((item) => ({
			...item,
			media: (item.mediaAssetIds ?? []).map((assetId): UpdateCardMediaItem => {
				const asset = initialUpdateMediaById.get(assetId as Id<'mediaAssets'>) ?? null;
				const isVideo = asset?.mediaKind === 'video' || asset?.contentType?.startsWith('video/');
				return {
					assetId,
					kind: isVideo ? 'video' : 'image',
					url: asset?.signedUrl ?? null
				};
			})
		}));
	});
</script>

<PageHeaderTitle title={displayName} />

<div class="flex w-full flex-col gap-4 py-4">
	{#if profileResponse.error}
		<Alert variant="destructive">
			<AlertTitle>{t('profileDetail.loadErrorTitle')}</AlertTitle>
			<AlertDescription>{profileResponse.error.message}</AlertDescription>
		</Alert>
	{/if}

	<section class="rounded-2xl border border-border/70 bg-white p-4 sm:p-5">
		<div class="flex flex-col gap-5">
			<div class="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
				<div class="min-w-0">
					<p class="truncate text-[2rem] leading-[2.2rem] font-bold text-[#262626]">
						{displayName}
					</p>
					{#if handle}
						<p class="truncate text-sm text-[#8b8fa0]">{handle}</p>
					{/if}
					{#if bio}
						<p class="mt-2 text-[1.03rem] leading-7 text-[#353535]">{bio}</p>
					{/if}
				</div>
				<Avatar class="mt-1 size-20 shrink-0 border border-border/70 sm:size-24">
					<AvatarImage src={profileImageUrl ?? undefined} alt={displayName} />
					<AvatarFallback class="bg-[#d8dbe5] text-lg font-bold text-[#3a3f50]"
						>{fallback}</AvatarFallback
					>
				</Avatar>
			</div>

			{#if clubs.length > 0}
				<div class="flex flex-col gap-3">
					<p class="text-[1.2rem] leading-6 font-bold text-[#44495f]">
						{t('profileDetail.clubsTitle')}
					</p>
					<div class="flex flex-wrap gap-2">
						{#each clubs as club (club.clubId)}
							<a
								href={routes.clubHome(club.clubId)}
								class="flex items-center gap-2 rounded-full border border-[#f0decc] bg-[#f8ecdf] px-3 py-1.5 transition-colors hover:border-orange-200 hover:bg-orange-50"
								data-sveltekit-preload-code="hover"
								data-sveltekit-preload-data="hover"
							>
								<span class="type-sm-bold text-orange-600">{club.clubName}</span>
								{#if club.roleName}
									<Badge
										class={club.roleKey === 'guide'
											? 'rounded-full bg-orange-500 px-2 py-0 text-xs text-white'
											: 'rounded-full bg-[#e4dccf] px-2 py-0 text-xs text-[#7a5c45]'}
									>
										{club.roleName}
									</Badge>
								{/if}
							</a>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</section>

	{#snippet sharedClubIndicator()}
		<span
			class="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
			title={t('profileDetail.sharedClubIndicatorLabel')}
			aria-label={t('profileDetail.sharedClubIndicatorLabel')}
		>
			<LockIcon class="size-3.5" />
		</span>
	{/snippet}

	{#snippet projectList(
		projects: typeof currentProjects,
		emptyLabel: string
	)}
		{#if projects.length === 0}
			<p class="type-sm text-muted-foreground">{emptyLabel}</p>
		{:else}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{#each projects as project (project.projectId)}
					<a
						href={routes.projectDetail(project.projectId)}
						class="flex flex-col gap-2 rounded-2xl border border-border/70 bg-white p-4 transition-colors hover:border-orange-200 hover:bg-orange-50"
						data-sveltekit-preload-code="hover"
						data-sveltekit-preload-data="hover"
					>
						{#if projectCoverUrl(project)}
							<img
								src={projectCoverUrl(project)}
								alt=""
								class="h-28 w-full rounded-xl object-cover"
							/>
						{/if}
						<div class="flex min-w-0 items-center gap-2">
							<p class="min-w-0 flex-1 truncate type-body-bold text-foreground">{project.name}</p>
							{#if project.sharedClub}
								{@render sharedClubIndicator()}
							{/if}
						</div>
						{#if project.description}
							<p class="type-sm line-clamp-2 text-muted-foreground">{project.description}</p>
						{/if}
					</a>
				{/each}
			</div>
		{/if}
	{/snippet}

	<section class="flex flex-col gap-3">
		<p class="text-[1.5rem] leading-8 font-bold text-[#44495f]">{t('profileDetail.currentTitle')}</p>
		{@render projectList(currentProjects, t('profileDetail.currentEmpty'))}
	</section>

	<section class="flex flex-col gap-3">
		<p class="text-[1.5rem] leading-8 font-bold text-[#44495f]">
			{t('profileDetail.showcaseTitle')}
		</p>
		{@render projectList(showcaseProjects, t('profileDetail.showcaseEmpty'))}
	</section>

	<section class="flex flex-col gap-3">
		<div class="flex items-center justify-between gap-3">
			<p class="text-[1.5rem] leading-8 font-bold text-[#44495f]">{t('profileDetail.updatesTitle')}</p>
		</div>
		{#if profileResponse.isLoading && updates.length === 0}
			<div class="rounded-[1.1rem] border border-border/80 bg-white px-4 py-6 text-center">
				<p class="text-[1.02rem] text-[#6b6f80]">{t('common.loading')}</p>
			</div>
		{:else if updates.length === 0}
			<div class="rounded-[1.1rem] border border-dashed border-border/80 bg-white px-4 py-6 text-center">
				<p class="type-body-bold text-foreground">{t('profileDetail.updatesEmptyTitle')}</p>
				<p class="type-sm mt-1 text-muted-foreground">{t('profileDetail.updatesEmptyDescription')}</p>
			</div>
		{:else}
			<div class="flex flex-col gap-3">
				{#each updates as item (item.updateId)}
					<div class="relative">
						<UpdateCard
							updateId={item.updateId}
							authorProfileId={profile?.profileId ?? null}
							authorName={displayName}
							authorImageUrl={profileImageUrl}
							createdAt={item.createdAt}
							content={item.content}
							media={item.media}
							relatedProject={item.projectId && item.projectName
								? {
										label: item.projectName,
										href: routes.projectDetail(item.projectId),
										navigationState: {
											headerTitleHint: item.projectName,
											headerTitleHintPath: `/project/${item.projectId}`
										}
									}
								: null}
						/>
						{#if item.sharedClub}
							<div class="absolute top-4 right-14">
								{@render sharedClubIndicator()}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>
