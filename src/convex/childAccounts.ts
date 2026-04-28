export const CHILD_EMAIL_DOMAIN = 'children.curiosity.local';

export const syntheticEmailForUsername = (username: string) => `${username}@${CHILD_EMAIL_DOMAIN}`;
