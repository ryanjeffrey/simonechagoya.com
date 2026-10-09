/**
 * Customer reviews shown on the home page and product pages.
 * The section stays hidden until this list has entries.
 *
 * Only add real reviews. Etsy reviews can be carried over word for word
 * (Shop Manager > Reviews); keep `source: 'Etsy'` so the attribution stays honest.
 */
export type Review = {
  name: string;
  text: string;
  rating: 1 | 2 | 3 | 4 | 5;
  date: string; // YYYY-MM-DD
  source: 'Etsy' | 'Direct';
  /** Product slug the review is about, if any. */
  product?: string;
};

export const reviews: Review[] = [];
