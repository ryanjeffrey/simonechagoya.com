import { getCollection, type CollectionEntry } from 'astro:content';
import { CATEGORIES } from '../content.config';
import { withInventory } from './inventory';

export type Product = CollectionEntry<'products'>;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_META: Record<Category, { label: string; singular: string; blurb: string }> = {
  necklaces: {
    label: 'Necklaces',
    singular: 'Necklace',
    blurb: 'Natural gemstone necklaces, each one named and strung by hand in Chicago.',
  },
  earrings: {
    label: 'Earrings',
    singular: 'Earrings',
    blurb: 'Gemstone earrings, made in small runs in the Chicago studio.',
  },
  bracelets: {
    label: 'Bracelets',
    singular: 'Bracelet',
    blurb: 'Gemstone bracelets, strung by hand.',
  },
  rings: {
    label: 'Rings',
    singular: 'Ring',
    blurb: 'Rings, each finished by hand.',
  },
  prints: {
    label: 'Prints',
    singular: 'Print',
    blurb: 'Certified archival giclée prints of Simone’s artwork, signed by the artist.',
  },
  cards: {
    label: 'Watercolor cards',
    singular: 'Card set',
    blurb: 'Small original watercolors, painted by hand in sets.',
  },
  originals: {
    label: 'Original paintings',
    singular: 'Original painting',
    blurb: 'Oil on canvas. One of each, ever.',
  },
};

export const GROUPS = {
  jewelry: {
    label: 'Jewelry',
    categories: ['necklaces', 'earrings', 'bracelets', 'rings'] as Category[],
    blurb: 'Natural gemstones, strung by hand in Chicago. No two are alike.',
  },
  art: {
    label: 'Art',
    categories: ['prints', 'cards', 'originals'] as Category[],
    blurb: 'Signed prints, hand-painted watercolors and original oil paintings.',
  },
} as const;

export type Group = keyof typeof GROUPS;

/**
 * Every product, with single pieces that sold since the last build marked sold
 * (see inventory.ts). Pass `fresh` at request time to skip the build cache.
 */
export async function getProducts(filter?: (p: Product) => boolean, options?: { fresh?: boolean }): Promise<Product[]> {
  const all = await withInventory(await getCollection('products'), options);
  return (filter ? all.filter(filter) : all).sort(sortFeatured);
}

/**
 * Studio framings made by scripts/media/frame.py: the first photo with the piece centered at
 * one shared size, so a grid of pieces lines up. Kept beside the photos as cover.jpg rather
 * than in frontmatter, so an Etsy re-import never drops them.
 */
const covers = import.meta.glob<{ default: ImageMetadata }>('../assets/products/*/cover.jpg', { eager: true });

/** The image a card shows: the framed cover if there is one, else the first photo. */
export function coverImage(p: Product): ImageMetadata | undefined {
  return covers[`../assets/products/${p.id}/cover.jpg`]?.default ?? p.data.images[0];
}

/**
 * The first material, without its explanation: "Goldstone, made of sand..." reads "Goldstone",
 * and "African Jade (Dendritic Jade, Grossular Garnet)" reads "African Jade".
 */
export function shortMaterial(p: Product) {
  return p.data.materials[0]?.replace(/\s*\(.*$/, '').split(',')[0].trim();
}

/** Shelf order across categories: jewelry, then prints and cards, then paintings sold by inquiry. */
const SHELF: Category[] = ['necklaces', 'earrings', 'bracelets', 'rings', 'prints', 'cards', 'originals'];
const JEWELRY = new Set<Category>(['necklaces', 'earrings', 'bracelets', 'rings']);

/** Sold jewelry and art products move to the end; paintings keep their hung order, sold or not. */
const soldOut = (p: Product) => p.data.status === 'sold' && p.data.category !== 'originals';

export function sortFeatured(a: Product, b: Product) {
  const sold = Number(soldOut(a)) - Number(soldOut(b));
  if (sold !== 0) return sold;
  if (a.data.featured !== b.data.featured) return a.data.featured ? -1 : 1;
  // `order` is per category, so compare it only within one; otherwise necklaces and paintings interleave.
  const shelf = SHELF.indexOf(a.data.category) - SHELF.indexOf(b.data.category);
  if (shelf !== 0) return shelf;
  // Jewelry for sale runs from the highest price down; sold pieces keep their hand-set `order`.
  if (a.data.status !== 'sold' && JEWELRY.has(a.data.category) && a.data.price !== b.data.price) {
    return b.data.price - a.data.price;
  }
  if (a.data.order !== b.data.order) return a.data.order - b.data.order;
  return a.data.title.localeCompare(b.data.title);
}

export function productUrl(p: Product | string) {
  return `/products/${typeof p === 'string' ? p : p.id}`;
}

export function isPurchasable(p: Product) {
  return p.data.status === 'available' && p.data.stock > 0;
}

export function variantPrice(p: Product, variantId?: string) {
  const v = p.data.variants.find((x) => x.id === variantId);
  return v?.price ?? p.data.price;
}

export function priceLabel(p: Product) {
  // Originals are sold by inquiry. Simone lists a price on most; the rest are priced on request.
  if (p.data.status === 'inquire') return p.data.price > 0 ? formatPrice(p.data.price) : 'Price on request';
  // Sold pieces stay on the site to show the body of work, without a price.
  if (p.data.status === 'sold') return 'Sold';
  const prices = p.data.variants.length ? p.data.variants.map((v) => v.price ?? p.data.price) : [p.data.price];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatPrice(min) : `From ${formatPrice(min)}`;
}

export function formatPrice(dollars: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
  }).format(dollars);
}

export function plainText(markdown = '', max = 160) {
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function groupOf(category: Category): Group {
  return GROUPS.jewelry.categories.includes(category) ? 'jewelry' : 'art';
}
