import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const news = defineCollection({
  loader: glob({ base: "./src/content/news", pattern: "**/*.md" }),
  schema: z.object({
    title: z.string(),
    category: z.enum(["Research", "Gear", "Events", "Trending"]),
    publishDate: z.date(),
    excerpt: z.string(),
    readTime: z.number(),
    image: z.string().optional(),
  }),
});

export const collections = { news };
