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
    schema: baseSchema.extend({ shortTitle: z.string().optional() }),
  }),
  develop: defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/develop' }),
    schema: baseSchema.extend({ repository: z.string().url() }),
  }),
  life: defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/life' }),
    schema: baseSchema,
  }),
  history: defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/history' }),
    schema: baseSchema.extend({ period: z.string() }),
  }),
  about: defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/about' }),
    schema: baseSchema,
  }),
};
