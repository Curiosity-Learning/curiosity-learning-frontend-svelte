export const routes = {
	onboardingGetStarted: '/onboarding/get-started',
	onboardingJoinClub: '/onboarding/join-club',
	onboardingPublicClubs: '/onboarding/join-club/public-clubs',
	feed: '/feed',
	feedMyClubs: '/feed/my-clubs',
	feedGlobal: '/feed/global',
	chat: '/chat',
	profile: '/profile',
	settings: '/settings',
	settingsMediaUploadDev: '/settings/media-upload-dev',
	notifications: '/notifications',

	clubHome: (clubId: string) => `/club/${clubId}`,
	clubSessions: (clubId: string) => `/club/${clubId}/sessions`,
	clubProjects: (clubId: string) => `/club/${clubId}/projects`,
	clubMembers: (clubId: string) => `/club/${clubId}/members`,
	sessionDetail: (sessionId: string) => `/session/${sessionId}/activities`,
	projectDetail: (projectId: string) => `/project/${projectId}/overview`,
	activityBooklet: '/activity-booklet',
	activityBookletDetail: (activityId: string) => `/activity-booklet/${activityId}`
} as const;
