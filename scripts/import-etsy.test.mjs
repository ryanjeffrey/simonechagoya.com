/**
 * End-to-end tests for `import:etsy --api` against a local stand-in for the Etsy API.
 * Each test runs the real script on a scratch copy of scripts/fixtures/etsy-api/products.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const SCRIPT = fileURLToPath(new URL('./import-etsy.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/etsy-api/', import.meta.url));
const run = promisify(execFile);

let server;
let base;
let requests;
let root;

before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, base);
    requests.push({ url, headers: req.headers, method: req.method });
    const send = async (file, type) => {
      let body = await readFile(path.join(FIXTURES, file));
      if (type === 'application/json') body = body.toString().replaceAll('{{BASE}}', base);
      res.writeHead(200, { 'content-type': type }).end(body);
    };
    if (req.method === 'POST' && url.pathname === '/oauth/token') {
      const form = new URLSearchParams(await new Promise((r) => req.on('data', (d) => r(String(d)))));
      requests.at(-1).form = form;
      return res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ access_token: '1.refreshed', refresh_token: 'refresh-2', expires_in: 3600 }));
    }
    if (url.pathname === '/v3/application/shops') return send('shops.json', 'application/json');
    if (url.pathname === '/v3/application/shops/56491047/listings') {
      return send(`listings-${url.searchParams.get('state')}.json`, 'application/json');
    }
    // Listing 103 comes back without its videos include, so the importer asks for them.
    if (url.pathname === '/v3/application/listings/103/videos') {
      return res.writeHead(200, { 'content-type': 'application/json' }).end('{"count":0,"results":[]}');
    }
    if (url.pathname === '/media/il_fullxfull.1.jpg') return send('media/il_fullxfull.1.jpg', 'image/jpeg');
    if (url.pathname === '/media/mockup.jpg') return send('media/mockup.jpg', 'image/jpeg');
    if (url.pathname === '/media/listing-video.mp4') return send('media/listing-video.mp4', 'video/mp4');
    res.writeHead(404).end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(async () => {
  requests = [];
  root = await mkdtemp(path.join(tmpdir(), 'import-etsy-'));
  await cp(path.join(FIXTURES, 'products'), path.join(root, 'src/content/products'), { recursive: true });
});

function importer(args, env = {}) {
  return run(process.execPath, [SCRIPT, ...args], {
    env: {
      PATH: process.env.PATH,
      ETSY_IMPORT_ROOT: root,
      ETSY_API_BASE: `${base}/v3/application`,
      ETSY_TOKEN_URL: `${base}/oauth/token`,
      ETSY_API_KEY: 'keystring',
      ETSY_SHARED_SECRET: 'secret',
      ETSY_ACCESS_TOKEN: '1.token',
      ...env,
    },
  });
}

const product = (slug) => readFile(path.join(root, 'src/content/products', `${slug}.md`), 'utf8');
const field = (text, key) => text.match(new RegExp(`^${key}: (.*)$`, 'm'))?.[1];
const exists = (file) => stat(path.join(root, file)).then(() => true, () => false);

test('marks sold listings sold, creates the missing ones and keeps the active piece for sale', async () => {
  const { stdout } = await importer(['--api']);

  const smoke = await product('smoke-necklace');
  assert.equal(field(smoke, 'status'), 'available', 'the piece still for sale must stay for sale');
  assert.equal(field(smoke, 'etsyListingId'), '"101"');

  const dune = await product('dune-necklace');
  assert.equal(field(dune, 'status'), 'sold');
  assert.equal(field(dune, 'stock'), '0');
  assert.equal(field(dune, 'etsyListingId'), '"102"');

  // An earlier Smoke Necklace that sold gets its own page.
  const earlier = await product('smoke-necklace-2');
  assert.equal(field(earlier, 'status'), 'sold');
  assert.equal(field(earlier, 'price'), '135');
  assert.equal(field(earlier, 'etsyListingId'), '"103"');
  assert.match(earlier, /^images:\n {2}- "\.\.\/\.\.\/assets\/products\/smoke-necklace-2\/1\.jpg"$/m);

  // An original painting owns cosmos-necklace, so the sold necklace goes next to it.
  assert.equal(field(await product('cosmos-necklace'), 'category'), 'originals');
  const cosmos = await product('cosmos-necklace-2');
  assert.equal(field(cosmos, 'title'), '"Cosmos Necklace"');
  assert.equal(field(cosmos, 'status'), 'sold');
  assert.equal(field(cosmos, 'oneOfAKind'), 'false');
  assert.equal(field(cosmos, 'intention'), '"Clarity · Focus · Calm"');
  assert.match(cosmos, /\{ label: "Gemstones", value: "Rainbow fluorite" \}/);
  assert.match(cosmos, /^images:\n {2}- "\.\.\/\.\.\/assets\/products\/cosmos-necklace-2\/1\.jpg"$/m, 'photos follow Etsy rank order');
  assert.match(stdout, /image 2 failed \(HTTP 404\)/);
  // Etsy's designed mock-up card and a repeated image are left out.
  assert.match(stdout, /image 3 left out \(1080x1350/);
  assert.match(stdout, /image 4 left out \(the same image appears earlier/);

  // Without the media tools the raw videos wait in etsy-export/ and are not listed yet.
  assert.ok(await exists('etsy-export/videos/smoke-necklace/1.mp4'));
  assert.ok(await exists('etsy-export/videos/dune-necklace/1.mp4'));
  assert.doesNotMatch(smoke, /^videos:/m);
  assert.match(stdout, /2 videos are downloaded to etsy-export\/videos\/ but not graded/);

  for (const r of requests.filter((r) => r.url.pathname.startsWith('/v3/'))) {
    assert.equal(r.headers['x-api-key'], 'keystring:secret');
    assert.equal(r.headers.authorization, 'Bearer 1.token');
  }
  assert.ok(requests.some((r) => r.url.pathname === '/v3/application/listings/103/videos'));
  const states = requests.filter((r) => r.url.pathname.endsWith('/listings')).map((r) => r.url.searchParams.get('state'));
  assert.deepEqual(states.sort(), ['active', 'sold_out']);
});

const MEDIA_VENV = fileURLToPath(new URL('../.venv-media', import.meta.url));
const hasMediaTools = await stat(MEDIA_VENV).then(() => true, () => false);

test('grades videos into the gallery when the media tools are set up', { skip: !hasMediaTools && 'no .venv-media (README > Photos and video)' }, async () => {
  await symlink(MEDIA_VENV, path.join(root, '.venv-media'));
  await importer(['--api']);
  const smoke = await product('smoke-necklace');
  assert.match(smoke, /^videos:\n {2}- \{ src: "\/media\/products\/smoke-necklace\/etsy-1\.mp4", poster: "\/media\/products\/smoke-necklace\/etsy-1\.jpg" \}\netsyImages:/m);
  assert.ok(await exists('public/media/products/smoke-necklace/etsy-1.mp4'));
  assert.ok(await exists('public/media/products/smoke-necklace/etsy-1.jpg'));
  const dune = await product('dune-necklace');
  assert.match(dune, /src: "\/media\/products\/dune-necklace\/etsy-1\.mp4"/);
  assert.equal(field(dune, 'status'), 'sold');

  // Graded files are reused and the list is not duplicated.
  const { stdout } = await importer(['--api']);
  assert.match(stdout, /0 graded \(2 already present/);
  assert.equal((await product('smoke-necklace')).match(/etsy-1\.mp4/g).length, 1);
});

test('keeps hand-added videos and skips the Etsy ones', async () => {
  const file = path.join(root, 'src/content/products/smoke-necklace.md');
  const own = '  - { src: "/media/products/smoke-necklace/1.mp4", poster: "/media/products/smoke-necklace/1.jpg" }';
  await writeFile(file, (await readFile(file, 'utf8')).replace('etsyImages: []', `videos:\n${own}\netsyImages: []`));
  const { stdout } = await importer(['--api']);
  const smoke = await product('smoke-necklace');
  assert.match(smoke, /^videos:\n.*smoke-necklace\/1\.mp4.*\netsyImages:/m);
  assert.doesNotMatch(smoke, /etsy-1\.mp4/);
  assert.ok(!(await exists('etsy-export/videos/smoke-necklace')), 'the Etsy video is not even downloaded');
  assert.match(stdout, /keep +smoke-necklace videos/);
  assert.ok(await exists('etsy-export/videos/dune-necklace/1.mp4'));
});

test('a second run changes nothing', async () => {
  await importer(['--api']);
  const dir = path.join(root, 'src/content/products');
  const snapshot = async () => Object.fromEntries(await Promise.all((await readdir(dir)).map(async (f) => [f, await readFile(path.join(dir, f), 'utf8')])));
  const first = await snapshot();
  const { stdout } = await importer(['--api']);
  assert.deepEqual(await snapshot(), first);
  assert.match(stdout, /created \(sold\): +0/);
  assert.match(stdout, /marked sold: +0/);
});

test('--dry-run writes nothing', async () => {
  const { stdout } = await importer(['--api', '--dry-run']);
  assert.match(stdout, /dune-necklace +102 +sold out +1 +mark sold, record listing id/);
  assert.match(stdout, /would create: +2/);
  assert.equal(field(await product('dune-necklace'), 'status'), 'available');
  assert.ok(!(await exists('etsy-export')));
  assert.deepEqual((await readdir(path.join(root, 'src/content/products'))).sort(), ['cosmos-necklace.md', 'dune-necklace.md', 'smoke-necklace.md']);
});

test('refreshes an expired saved token', async () => {
  await mkdir(path.join(root, 'etsy-export'));
  const tokenFile = path.join(root, 'etsy-export/etsy-token.json');
  await writeFile(tokenFile, JSON.stringify({ access_token: '1.old', refresh_token: 'refresh-1', expires_at: Date.now() - 1000 }));
  await importer(['--api', '--dry-run'], { ETSY_ACCESS_TOKEN: '' });

  const refresh = requests.find((r) => r.url.pathname === '/oauth/token');
  assert.equal(refresh.form.get('grant_type'), 'refresh_token');
  assert.equal(refresh.form.get('refresh_token'), 'refresh-1');
  assert.equal(refresh.form.get('client_id'), 'keystring');
  assert.equal(requests.find((r) => r.url.pathname === '/v3/application/shops').headers.authorization, 'Bearer 1.refreshed');
  assert.equal(JSON.parse(await readFile(tokenFile, 'utf8')).refresh_token, 'refresh-2');
});

test('says which host it could not reach', async () => {
  await assert.rejects(importer(['--api'], { ETSY_API_BASE: 'http://127.0.0.1:9/v3/application' }), (err) => {
    assert.match(err.stderr, /ERROR: could not reach 127\.0\.0\.1:9/);
    return true;
  });
});

afterEach(() => rm(root, { recursive: true, force: true }));
