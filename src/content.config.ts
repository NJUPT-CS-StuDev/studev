import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const baseSchema = z.object({
  title: z.string(),
  description: z.string(),
  order: z.number().optional(),
  pubDate: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).default([]),
  audio: z.string().optional(),
  duration: z.string().optional(),
  status: z.enum(['published', 'draft']).default('published'),
});

export const collections = {
  study: defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/study' }),
    schema: baseSchema.extend({
      shortTitle: z.string().optional(),
      kicker: z.string().optional(),
    }),
  }),
  develop: defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/develop' }),
    schema: baseSchema.extend({
      shortTitle: z.string().optional(),
      kicker: z.string().optional(),
      repository: z.url(),
      demo: z.url().optional(),
    }),
  }),
  life: defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/life' }),
    schema: baseSchema.extend({
      shortTitle: z.string().optional(),
      kicker: z.string().optional(),
    }),
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
        href: z.url().optional(),
      })),
    }),
  }),
  about: defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/about' }),
    schema: baseSchema.extend({
      shortTitle: z.string().optional(),
      kicker: z.string().optional(),
    }),
  }),
};
