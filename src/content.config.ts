import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const baseSchema = z.object({
  title: z.string(),
  description: z.string(),
  order: z.number().optional(),
  status: z.enum(['published', 'draft']).default('published'),
});

export const collections = {
  study: defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/study' }),
    schema: baseSchema,
  }),
};
