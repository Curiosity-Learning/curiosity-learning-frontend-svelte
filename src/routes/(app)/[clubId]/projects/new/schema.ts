import { z } from 'zod';

export const projectSchema = z.object({
	name: z.string().min(1, 'Project name is required.').max(200, 'Name must be 200 characters or fewer.'),
	description: z.string().max(200, 'Description must be 200 characters or fewer.').optional().default(''),
	dueDate: z.string().min(1, 'A deadline is required.')
});

export type ProjectSchema = typeof projectSchema;
