export const routes = {
	onboardingGetStarted: '/onboarding/get-started',
	feed: '/feed',
	chat: '/chat',
	profile: '/profile',
	settings: '/settings',
	notifications: '/notifications',

	clubHome: (clubId: string) => `/${clubId}`,
	clubSessions: (clubId: string) => `/${clubId}/sessions`,
	clubProjects: (clubId: string) => `/${clubId}/projects`,
	clubMembers: (clubId: string) => `/${clubId}/members`,
	sessionDetail: (sessionId: string) => `/session/${sessionId}`
} as const;
