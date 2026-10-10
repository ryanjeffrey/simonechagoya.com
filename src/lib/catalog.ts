import { getCollection, type CollectionEntry } from 'astro:content';
import { CATEGORIES } from '../content.config';

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

export async function getProducts(filter?: (p: Product) => boolean): Promise<Product[]> {
  const all = await getCollection('products', filter);
  return all.sort(sortFeatured);
}

export function sortFeatured(a: Product, b: Product) {
  const sold = Number(a.data.status === 'sold') - Number(b.data.status === 'sold');
  if (sold !== 0) return sold;
  if (a.data.featured !== b.data.featured) return a.data.featured ? -1 : 1;
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
  if (p.data.status === 'inquire') return 'Price on request';
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
