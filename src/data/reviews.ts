/**
 * Customer reviews shown on the home page and product pages.
 * The section stays hidden until this list has entries.
 *
 * Only add real reviews. Etsy reviews can be carried over word for word
 * (Shop Manager > Reviews); keep `source: 'Etsy'` so the attribution stays honest.
 */
import type { ImageMetadata } from 'astro';
import kaseEy from '../assets/reviews/kase-ey.jpg';

export type Review = {
  name: string;
  text: string;
  /** Star rating. Leave out for words shared without one (an Instagram post). */
  rating?: 1 | 2 | 3 | 4 | 5;
  date?: string; // YYYY-MM-DD
  source: 'Etsy' | 'Instagram' | 'Direct';
  /** Product slug the review is about, if any. */
  product?: string;
  /** The customer's own photo, used with their post. */
  photo?: { src: ImageMetadata; alt: string };
};

// Imported from the Etsy reviews export (October 2026), strongest first.
// A review from a family member was left out on purpose: insider reviews
// erode trust and the FTC review rule requires disclosing the relationship.
export const reviews: Review[] = [
  // From @kase_ey's Instagram story, shared by Simone. "My talent friend" is left
  // out of her caption at Ryan's request (2026-10-10); hashtags dropped.
  {
    name: '@kase_ey',
    text: 'Obsessed with this gorgeous necklace, hand-crafted by @simonechagoya',
    source: 'Instagram',
    product: 'african-jade-necklace',
    photo: { src: kaseEy, alt: '@kase_ey wearing her African Jade necklace by Simone Chagoya' },
  },
  {
    name: 'Nancy',
    text: 'The recipient of this gift was very pleased. The presentation is elevated because of the glamorous packaging. The handwritten note is another elegant touch. The beads themselves are high quality and the necklace is beautifully made. This made a special gift I was proud to give!',
    rating: 5,
    date: '2026-09-14',
    source: 'Etsy',
  },
  {
    name: 'Mallory',
    text: 'The necklace is gorgeous and made with high quality materials. The box and bag it came in is really nicely presented, especially because this is a gift. It arrived much quicker than I anticipated as well. I highly recommend this seller!',
    rating: 5,
    date: '2026-05-16',
    source: 'Etsy',
  },
  {
    name: 'Loni',
    text: "Beautiful, lively amethyst beads well strung and quality clasp. I'm impressed! Thank you for such a beauty!",
    rating: 5,
    date: '2026-05-23',
    source: 'Etsy',
  },
  {
    name: 'Melissa',
    text: 'One of the most beautiful necklaces I have ever ordered. Thank you so much.',
    rating: 5,
    date: '2026-08-06',
    source: 'Etsy',
  },
  {
    name: 'Nancy',
    text: 'Great communication with the seller, fast shipping, well-packaged. I am happy to be able to give this as a unique gift and support an independent artist.',
    rating: 5,
    date: '2025-12-11',
    source: 'Etsy',
  },
  {
    name: 'lacakmak',
    text: 'Beautiful necklace and very well made',
    rating: 5,
    date: '2026-04-20',
    source: 'Etsy',
  },
  {
    name: 'Nancy',
    text: 'Beautifully presented gift, great communication, fast shipping',
    rating: 5,
    date: '2025-12-18',
    source: 'Etsy',
  },
];
