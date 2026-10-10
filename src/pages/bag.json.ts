import type { APIRoute } from 'astro';
import { getImage } from 'astro:assets';
import { coverImage, getProducts, isPurchasable, productUrl } from '../lib/catalog';
import { site } from '../data/site';

/** Compact catalog the bag drawer reads to price and render lines. */
export const GET: APIRoute = async () => {
  const products = await getProducts((p) => p.data.status !== 'inquire');
  const entries = await Promise.all(
    products.map(async (p) => {
      const first = coverImage(p);
      const thumb = first ? await getImage({ src: first, width: 240, format: 'webp', quality: 70 }) : null;
      // Pieces without photos yet use their video's poster frame.
      const image = thumb?.src ?? p.data.videos[0]?.poster;
      return [
        p.id,
        {
          title: p.data.title,
          url: productUrl(p),
          price: p.data.price,
          variants: p.data.variants.map((v) => ({ id: v.id, label: v.label, price: v.price ?? p.data.price })),
          image,
          oneOfAKind: p.data.oneOfAKind,
          stock: p.data.stock,
          available: isPurchasable(p),
          sample: p.data.sample,
        },
      ] as const;
    }),
  );

  return new Response(JSON.stringify({ products: Object.fromEntries(entries), freeThreshold: site.shipping.freeThreshold }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
