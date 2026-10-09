import type { APIRoute } from 'astro';
import { getImage } from 'astro:assets';
import { CATEGORY_META, getProducts, isPurchasable, plainText, productUrl } from '../../lib/catalog';
import { site } from '../../data/site';

/**
 * Product feed for Google Merchant Center (free Shopping listings) and Pinterest catalogs.
 * Submit https://simonechagoya.com/feeds/products.xml as a scheduled fetch in both.
 * Sample listings and price-on-request originals are left out.
 */
const GOOGLE_CATEGORY: Record<string, string> = {
  earrings: 'Apparel & Accessories > Jewelry > Earrings',
  necklaces: 'Apparel & Accessories > Jewelry > Necklaces',
  rings: 'Apparel & Accessories > Jewelry > Rings',
  bracelets: 'Apparel & Accessories > Jewelry > Bracelets',
  prints: 'Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork',
  cards: 'Arts & Entertainment > Party & Celebration > Gift Giving > Greeting & Note Cards',
  originals: 'Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork',
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = async () => {
  const products = await getProducts((p) => !p.data.sample && p.data.status === 'available' && p.data.images.length > 0);
  const abs = (path: string) => new URL(path, site.url).href;

  const items = await Promise.all(
    products.map(async (p) => {
      const { data } = p;
      const images = await Promise.all(
        data.images.slice(0, 6).map((img) => getImage({ src: img, width: 1200, format: 'jpg' }).then((r) => abs(r.src))),
      );
      const [image, ...extra] = images;
      const description = plainText(p.body ?? data.summary ?? data.title, 4900) || data.title;
      return `    <item>
      <g:id>${esc(p.id)}</g:id>
      <title>${esc(data.title)}</title>
      <description>${esc(description)}</description>
      <link>${abs(productUrl(p))}</link>
      <g:image_link>${image}</g:image_link>${extra.map((u) => `\n      <g:additional_image_link>${u}</g:additional_image_link>`).join('')}
      <g:availability>${isPurchasable(p) ? 'in_stock' : 'out_of_stock'}</g:availability>
      <g:price>${data.price.toFixed(2)} USD</g:price>
      <g:brand>${esc(site.studio)}</g:brand>
      <g:condition>new</g:condition>
      <g:identifier_exists>no</g:identifier_exists>
      <g:google_product_category>${esc(GOOGLE_CATEGORY[data.category])}</g:google_product_category>
      <g:product_type>${esc(CATEGORY_META[data.category].label)}</g:product_type>${data.materials[0] ? `\n      <g:material>${esc(data.materials.join(', ').slice(0, 200))}</g:material>` : ''}
    </item>`;
    }),
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${esc(site.studio)}</title>
    <link>${site.url}</link>
    <description>${esc(site.description)}</description>
${items.join('\n')}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
