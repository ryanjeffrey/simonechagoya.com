#!/usr/bin/env node
/**
 * Connects Stripe to the Netlify site in one go.
 *
 * Usage:
 *   npm run setup:stripe                 # test mode (sandbox keys)
 *   npm run setup:stripe -- --live       # live mode, production deploys only
 *   npm run setup:stripe -- --site name  # a Netlify site other than "simonechagoya"
 *
 * It asks for two keys and does the rest:
 *   1. Signs in to Netlify (opens the browser the first time) and finds the site.
 *   2. Creates the Stripe webhook for /api/stripe-webhook with the four checkout
 *      events, using the secret key. The key is used on this machine only and
 *      never saved.
 *   3. Creates the "Stripe sale" build hook, or reuses it.
 *   4. Saves STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and NETLIFY_BUILD_HOOK_URL
 *      on the site, then starts a deploy so they take effect.
 *
 * Test mode sets the keys for every deploy context. Live mode replaces them for
 * production only, so deploy previews keep test keys and can never charge a card.
 * It also creates the collector code shown by the sign-up popup (site.collector in
 * src/data/site.ts): a percent-off coupon for a customer's first order.
 *
 * Running it again is safe: it replaces the webhook it created before and reuses the code.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import readline from 'node:readline';
import Stripe from 'stripe';

const args = process.argv.slice(2);
const live = args.includes('--live');
const siteName = args.includes('--site') ? args[args.indexOf('--site') + 1] : 'simonechagoya';
const mode = live ? 'live' : 'test';
const dashboard = `https://dashboard.stripe.com${live ? '' : '/test'}`;

const EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
];
const ALL_CONTEXTS = ['production', 'deploy-preview', 'branch-deploy', 'dev'];
// The API's names, which differ from the dashboard's (post_processing, not post-processing).
const SCOPES = ['builds', 'functions', 'runtime', 'post_processing'];
const MANAGED = 'setup-stripe';

const step = (n, text) => console.log(`\n${n}. ${text}`);
const fail = (text) => {
  console.error(`\n${text}`);
  process.exit(1);
};

// ---------------------------------------------------------------- Netlify

const netlifyCmd = (() => {
  try {
    execFileSync('netlify', ['--version'], { stdio: 'ignore' });
    return ['netlify'];
  } catch {
    return [process.platform === 'win32' ? 'npx.cmd' : 'npx', '--yes', '--package=netlify-cli', 'netlify'];
  }
})();

function netlify(cliArgs, { inherit = false } = {}) {
  const [cmd, ...pre] = netlifyCmd;
  return execFileSync(cmd, [...pre, ...cliArgs], {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

/** Calls the Netlify API through the CLI, which handles sign-in. Returns null on 404. */
function api(method, data) {
  try {
    const out = netlify(['api', method, '--data', JSON.stringify(data)]);
    return out.trim() ? JSON.parse(out) : {};
  } catch (err) {
    const text = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (/not ?found|404/i.test(text)) return null;
    fail(`Netlify ${method} failed:\n${text.trim() || err.message}`);
  }
}

/** Sets a variable for the given contexts and keeps its values for the others. */
function setEnv(account, siteId, key, value, contexts) {
  const existing = api('getEnvVar', { account_id: account, site_id: siteId, key });
  const values = new Map();
  for (const v of existing?.values ?? []) {
    if (v.context === 'all') for (const c of ALL_CONTEXTS) values.set(c, v.value);
    else values.set(v.context, v.value);
  }
  for (const c of contexts) values.set(c, value);
  const body = { key, scopes: SCOPES, values: [...values].map(([context, v]) => ({ context, value: v })) };
  if (existing) api('updateEnvVar', { account_id: account, site_id: siteId, key, body });
  else api('createEnvVars', { account_id: account, site_id: siteId, body: [body] });
}

// ---------------------------------------------------------------- Prompts

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const lines = [];
const waiting = [];
rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : lines.push(line)));
rl.on('close', () => waiting.splice(0).forEach((resolve) => resolve('')));
let muted = false;
const writeOutput = rl._writeToOutput?.bind(rl);
if (writeOutput) rl._writeToOutput = (text) => writeOutput(muted ? '' : text);

/** Asks a question. Secret answers are not echoed when typed into a terminal. */
async function ask(question, { secret = false } = {}) {
  process.stdout.write(question);
  muted = secret;
  const answer = lines.length ? lines.shift() : await new Promise((resolve) => waiting.push(resolve));
  muted = false;
  if (secret && process.stdin.isTTY) process.stdout.write('\n');
  return answer.trim();
}

// ---------------------------------------------------------------- Main

console.log(`Connecting Stripe (${mode} mode) to the Netlify site "${siteName}".`);

step(1, 'Netlify');
try {
  netlify(['api', 'getCurrentUser']);
} catch {
  console.log('Sign in to Netlify in the browser window that opens.');
  netlify(['login'], { inherit: true });
}
const site = (api('listSites', { name: siteName, filter: 'all' }) ?? []).find((s) => s.name === siteName);
if (!site) fail(`No Netlify site named "${siteName}" on this account. Pass --site <name>.`);
const account = site.account_slug;
const siteUrl = (site.ssl_url || site.url).replace(/\/$/, '');
const webhookUrl = `${siteUrl}/api/stripe-webhook`;
console.log(`Found ${siteUrl}`);

step(2, 'Stripe');
console.log(`Secret key: ${dashboard}/apikeys ("Secret key", starts with sk_${mode}_). Used here only, never saved.`);
const setupKey = await ask('Secret key: ', { secret: true });
if (!new RegExp(`^(sk|rk)_${mode}_`).test(setupKey)) fail(`That is not a ${mode}-mode key (expected sk_${mode}_...).`);

console.log(
  `\nKey for the site: create a restricted key at ${dashboard}/apikeys/create with\n` +
    '  Checkout Sessions: Write, Products: Read, Prices: Read\n' +
    (live ? 'A restricted key limits the damage if it ever leaks.' : 'Press Enter to use the secret key instead (fine in test mode).'),
);
const siteKey = (await ask('Restricted key (rk_...): ', { secret: true })) || setupKey;
if (!new RegExp(`^(sk|rk)_${mode}_`).test(siteKey)) fail(`That is not a ${mode}-mode key.`);
if (live && siteKey.startsWith('sk_')) console.log('Using the full secret key for the site. A restricted key is safer.');

// STRIPE_MOCK_URL points the script at a local mock of the Stripe API, for testing it.
const stripeOptions = process.env.STRIPE_MOCK_URL
  ? (({ hostname, port, protocol }) => ({ host: hostname, port, protocol: protocol.slice(0, -1) }))(new URL(process.env.STRIPE_MOCK_URL))
  : {};
const stripe = new Stripe(setupKey, stripeOptions);
try {
  await new Stripe(siteKey, stripeOptions).checkout.sessions.list({ limit: 1 });
} catch (err) {
  fail(`The site key cannot read Checkout Sessions: ${err.message}`);
}

const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
for (const endpoint of endpoints.data.filter((e) => e.url === webhookUrl)) {
  if (endpoint.metadata?.managed_by !== MANAGED) {
    const answer = await ask(`A webhook for ${webhookUrl} already exists (${endpoint.id}). Replace it? [y/N] `);
    if (!/^y/i.test(answer)) fail('Stopped. Delete or keep that webhook, then run this again.');
  }
  await stripe.webhookEndpoints.del(endpoint.id);
}
const webhook = await stripe.webhookEndpoints.create({
  url: webhookUrl,
  enabled_events: EVENTS,
  description: 'simonechagoya.com orders',
  metadata: { managed_by: MANAGED },
});
console.log(`Webhook ${webhook.id} -> ${webhookUrl}`);

// The popup's code. Read from site.ts so the two never drift apart.
const siteTs = readFileSync(new URL('../src/data/site.ts', import.meta.url), 'utf8');
const collectorCode = siteTs.match(/collector:\s*{[^}]*code:\s*'([^']+)'/)?.[1];
const percentOff = Number(siteTs.match(/collector:\s*{[^}]*percentOff:\s*(\d+)/)?.[1]);
if (collectorCode && percentOff) {
  const existing = await stripe.promotionCodes.list({ code: collectorCode, limit: 1 });
  if (existing.data.length) {
    console.log(`Collector code ${collectorCode} already exists.`);
  } else {
    const coupon = await stripe.coupons.create({
      percent_off: percentOff,
      duration: 'once',
      name: `Collector welcome, ${percentOff}% off`,
      metadata: { managed_by: MANAGED },
    });
    await stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon: coupon.id },
      code: collectorCode,
      restrictions: { first_time_transaction: true },
      metadata: { managed_by: MANAGED },
    });
    console.log(`Collector code ${collectorCode}: ${percentOff}% off a first order.`);
  }
}

step(3, 'Build hook');
const branch = site.build_settings?.repo_branch || 'main';
const hooks = api('listSiteBuildHooks', { site_id: site.id }) ?? [];
const hook = hooks.find((h) => h.title === 'Stripe sale') ?? api('createSiteBuildHook', { site_id: site.id, body: { title: 'Stripe sale', branch } });
console.log(`"Stripe sale" builds ${hook.branch ?? branch}`);

step(4, 'Environment variables');
const contexts = live ? ['production'] : ALL_CONTEXTS;
setEnv(account, site.id, 'STRIPE_SECRET_KEY', siteKey, contexts);
setEnv(account, site.id, 'STRIPE_WEBHOOK_SECRET', webhook.secret, contexts);
setEnv(account, site.id, 'NETLIFY_BUILD_HOOK_URL', hook.url, ALL_CONTEXTS);
console.log(`Saved for ${contexts.join(', ')}.`);

api('createSiteBuild', { site_id: site.id });
rl.close();

console.log(`
Done. A deploy has started; checkout switches on when it finishes.

${
  live
    ? `Before the first real order:
  - Finish account activation and add the payout bank account: ${dashboard}/account/onboarding
  - Sales tax: add the Illinois registration at ${dashboard}/tax/registrations,
    then set STRIPE_AUTOMATIC_TAX=true in Netlify and redeploy.`
    : `Test it once the deploy is live:
  1. Buy a piece at ${siteUrl}/shop with card 4242 4242 4242 4242, any future date, any CVC.
  2. ${dashboard}/workbench/webhooks shows the event delivered with a 200.
  3. After the rebuild the piece shows Sold. Test orders stop counting once live keys are in.
Then run: npm run setup:stripe -- --live`
}
`);
