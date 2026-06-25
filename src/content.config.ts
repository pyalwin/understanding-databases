import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const chapters = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/chapters' }),
  schema: z.object({
    title: z.string(),
    chapterNumber: z.number().int().positive(),
    summary: z.string(),
    readingTime: z.string().optional(),
  }),
});

export const collections = { chapters };
