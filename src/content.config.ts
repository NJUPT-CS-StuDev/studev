import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const baseSchema = z.object({
  title: z.string(),
  description: z.string(),
  section: z.string().optional(),
  order: z.number().optional(),
  tags: z.array(z.string()).default([]),
  type: z.string().default('guide'),
  duration: z.string().optional(),
  status: z.enum(['published', 'draft']).default('published'),
});

export const collections = {
  study: defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/study' }),
    schema: baseSchema,
  }),
  explore: defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/explore' }),
    schema: baseSchema,
  }),
};
