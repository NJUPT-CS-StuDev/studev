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
    schema: ({ image }) => baseSchema.extend({
      period: z.string(),
      groups: z.array(z.object({
        name: z.string(),
        people: z.array(z.object({
          name: z.string(),
          role: z.string().optional(),
          avatar: image(),
          signature: z.string().optional(),
        })),
      })),
      events: z.array(z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string().optional(),
        title: z.string(),
        detail: z.string(),
        participants: z.string().optional(),
        href: z.string().url().optional(),
      })),
    }),
  }),
  about: defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/about' }),
    schema: baseSchema,
  }),
};
