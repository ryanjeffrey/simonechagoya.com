/**
 * Copies each inquiry from the commissions form (Netlify Forms, form name
 * `inquiry`) into the studio's Requests list (/studio/requests), as a new
 * request. Netlify runs this after a submission passes its spam filter; the
 * submission itself stays in Netlify Forms and its email notification as before.
 *
 * It writes to the private `studio` store in Netlify Blobs (see
 * src/lib/studio-store.ts and src/lib/ledger.ts for the record shape). A
 * submission is stored once under its Netlify id, so a repeat delivery never
 * duplicates it or overwrites Simone's edits.
 */
import { connectLambda, getStore } from '@netlify/blobs';

const TYPES = ['Custom necklace', 'Painting commission', 'Original painting', 'Order question', 'Wholesale or stockist', 'Something else'];

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** A file field arrives as an object with a url (or, in older payloads, a bare url). */
const fileUrl = (value) => {
  const url = typeof value === 'string' ? value : value && typeof value === 'object' ? value.url : '';
  return typeof url === 'string' && /^https:\/\//.test(url) ? url.slice(0, 2000) : undefined;
};

export const handler = async (event) => {
  let payload;
  try {
    payload = JSON.parse(event.body || '{}').payload;
  } catch {
    return { statusCode: 400, body: 'Bad payload' };
  }
  if (!payload || payload.form_name !== 'inquiry' || !payload.id) return { statusCode: 200, body: 'Ignored' };

  const data = payload.data || {};
  if (text(data.company, 10)) return { statusCode: 200, body: 'Ignored' }; // the honeypot was filled

  connectLambda(event);
  const store = getStore({ name: 'studio', consistency: 'strong' });
  const id = `r_${String(payload.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 40)}`;
  const key = `requests/${id}`;
  if (await store.get(key)) return { statusCode: 200, body: 'Already recorded' };

  const created = Date.parse(payload.created_at);
  const now = new Date().toISOString();
  const type = text(data.type, 60);
  await store.setJSON(key, {
    id,
    created: Number.isNaN(created) ? now : new Date(created).toISOString(),
    source: 'Website form',
    name: text(data.name, 120) || 'No name',
    email: text(data.email, 200) || undefined,
    type: TYPES.includes(type) ? type : 'Something else',
    budget: text(data.budget, 60) || undefined,
    piece: text(data.piece, 120) || undefined,
    message: text(data.message, 5000),
    attachment: fileUrl(data.reference),
    status: 'new',
    payments: [],
    updated: now,
  });
  return { statusCode: 200, body: 'Recorded' };
};
