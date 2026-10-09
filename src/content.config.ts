import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

export const CATEGORIES = ['necklaces', 'earrings', 'bracelets', 'rings', 'prints', 'cards', 'originals'] as const;
export const ART_KINDS = ['necklace', 'print', 'cards', 'studs', 'drops', 'hoops', 'pendant', 'chain', 'ring', 'cuff'] as const;

/**
 * One Markdown file per product in src/content/products.
 * The file name is the URL slug. The Markdown body is the product description.
 * `npm run import:etsy` writes these files from an Etsy listings CSV.
 */
const products = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/products' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      category: z.enum(CATEGORIES),
      /** Price in dollars. For items with variants this is the "from" price. */
      price: z.number().nonnegative(),
      compareAt: z.number().nonnegative().optional(),
      /** One line shown under the title on the product page. */
      summary: z.string().optional(),
      images: z.array(image()).default([]),
      /** Stand-in illustration used until real photos are added. */
      art: z
        .object({
          kind: z.enum(ART_KINDS),
          ground: z.string(),
          stone: z.string().optional(),
          metal: z.enum(['gold', 'silver']).default('gold'),
          /** Bead colors for necklaces, or the palette for prints and cards. */
          colors: z.array(z.string()).default([]),
          beads: z.enum(['round', 'oval', 'flower', 'tube']).default('round'),
          count: z.number().int().positive().default(36),
          clear: z.boolean().default(false),
          pattern: z.enum(['speckle', 'leaves', 'wash']).default('wash'),
        })
        .optional(),
      materials: z.array(z.string()).default([]),
      dimensions: z.string().optional(),
      variants: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
            price: z.number().nonnegative().optional(),
            stock: z.number().int().nonnegative().optional(),
          }),
        )
        .default([]),
      stock: z.number().int().nonnegative().default(1),
      oneOfAKind: z.boolean().default(false),
      /** available: buyable. sold: shown with a sold badge. inquire: originals sold by conversation. */
      status: z.enum(['available', 'sold', 'inquire']).default('available'),
      featured: z.boolean().default(false),
      /** Product id of the painting this piece is drawn from, if any. */
      painting: z.string().optional(),
      year: z.number().int().optional(),
      medium: z.string().optional(),
      tags: z.array(z.string()).default([]),
      /** Placeholder listing. Shown on the site, refused at checkout, excluded from feeds. */
      sample: z.boolean().default(false),
      order: z.number().default(100),
      publishedAt: z.coerce.date().optional(),
      seoDescription: z.string().optional(),
      etsyId: z.string().optional(),
    }),
});

export const collections = { products };
