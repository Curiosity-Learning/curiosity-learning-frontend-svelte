import { v } from 'convex/values';

export const clubRoleKeyValidator = v.union(v.literal('guide'), v.literal('learner'));
export type ClubRoleKey = 'guide' | 'learner';

export const projectRoleKeyValidator = v.union(v.literal('creator'), v.literal('contributor'));
export type ProjectRoleKey = 'creator' | 'contributor';
