import { expect, test, type Page } from '@playwright/test';

const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'correct horse battery 42';

async function fillAuth(page: Page, email: string, password: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function register(page: Page, email: string) {
  await page.goto('/register');
  await expect(page.getByText(/bot protection is bypassed/i)).toBeVisible(); // dev_bypass explícito
  await fillAuth(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/app$/);
}

test('landing é honesta e leva às limitações', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('One content in');
  await expect(page.getByText(/No generative AI is called by default/)).toBeVisible();
  await page.getByRole('link', { name: /what the product does not do/i }).click();
  await expect(page).toHaveURL(/\/docs\/limitations$/);
  await expect(page.getByRole('heading', { name: 'Renderização de vídeo' })).toBeVisible();
});

test('cadastro, workspace pessoal, logout e login', async ({ page }) => {
  const email = `a-${uniq()}@example.com`;
  await register(page, email);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await expect(page.getByText(/personal · role: owner/)).toBeVisible();
  await expect(page.getByText('Off (no paid plans)')).toBeVisible();

  // R3: nenhuma credencial acessível por JS (cookie é HttpOnly; storage sem segredos)
  const exposed = await page.evaluate(() => ({
    cookie: document.cookie,
    storage: JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
  }));
  expect(exposed.cookie).not.toContain('cf_session');
  expect(exposed.storage).not.toContain(PASSWORD);
  expect(exposed.storage.toLowerCase()).not.toMatch(/token|session|password/);
  const cookies = await page.context().cookies();
  const s = cookies.find((c) => c.name === '__Host-cf_session');
  expect(s?.httpOnly).toBe(true);
  expect(s?.secure).toBe(true);
  expect(s?.sameSite).toBe('Lax');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login$/);

  await fillAuth(page, email, 'wrong password 123');
  await expect(page.getByText('Invalid email or password.')).toBeVisible();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/app$/);
});

test('validações do formulário e e-mail duplicado', async ({ page, browser }) => {
  const email = `dup-${uniq()}@example.com`;
  await page.goto('/register');
  await fillAuth(page, email, 'short');
  await expect(page.getByText('Password must have at least 10 characters.')).toBeVisible();

  await register(page, email);
  const other = await browser.newPage();
  await other.goto('/register');
  await fillAuth(other, email, PASSWORD);
  await expect(other.getByText('This email is already registered.')).toBeVisible();
  await other.close();
});

test('isolamento multi-tenant: usuário A não acessa o workspace de B (404)', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pa = await ctxA.newPage();
  const pb = await ctxB.newPage();
  await register(pa, `iso-a-${uniq()}@example.com`);
  await register(pb, `iso-b-${uniq()}@example.com`);

  const idOf = async (p: Page) => {
    const me = await (await p.request.get('/api/auth/me')).json();
    return me.workspaces[0].id as string;
  };
  const wsA = await idOf(pa);
  const wsB = await idOf(pb);

  expect((await pa.request.get(`/api/workspaces/${wsA}`)).status()).toBe(200);
  expect((await pa.request.get(`/api/workspaces/${wsB}`)).status()).toBe(404);
  expect((await pb.request.get(`/api/workspaces/${wsA}/clients`)).status()).toBe(404);
  await ctxA.close();
  await ctxB.close();
});

test('sem sessão: API protegida responde 401 e /billing responde 404', async ({ request }) => {
  expect((await request.get('/api/auth/me')).status()).toBe(401);
  expect((await request.get('/billing/checkout')).status()).toBe(404);
  expect((await request.get('/api/billing')).status()).toBe(404);
});

test('CSRF: POST sem Origin same-origin é rejeitado', async ({ request }) => {
  const res = await request.post('/api/auth/login', {
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    data: { email: 'a@b.co', authKey: 'a'.repeat(43), turnstileToken: 't' },
  });
  expect(res.status()).toBe(403);
});

test('i18n: troca para português', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Language').selectOption('pt');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Um conteúdo entra');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt');
});

test('PWA: manifest válido, service worker ativo e shell offline', async ({ page, context }) => {
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);

  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // garante que o SW controla a página
  await context.setOffline(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('One content in');
  await expect(page.getByRole('status')).toContainText('You are offline');
  await context.setOffline(false);
});

const PT_TEXT =
  'O mercado de energia solar cresceu rapidamente no Brasil. A energia solar reduz a conta de luz das famílias e das empresas. Muitas cidades do Nordeste têm alta radiação solar durante todo o ano. Os painéis solares exigem pouca manutenção e duram mais de vinte anos. O governo criou linhas de crédito para facilitar a instalação de painéis solares. Por isso, a geração distribuída de energia solar deve continuar crescendo nos próximos anos.';

async function openNewProject(page: Page, name: string) {
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test('projeto: colar texto, analisar, gerar (template), editar e exportar', async ({ page }) => {
  await register(page, `proj-${uniq()}@example.com`);
  await openNewProject(page, 'Campanha solar');

  await page.getByLabel('Text', { exact: true }).fill(PT_TEXT);
  await page.getByRole('button', { name: 'Save and analyze' }).click();
  await expect(page.getByTestId('lang')).toHaveText('pt');
  await expect(page.getByText(/yake-inspired@1/)).toBeVisible();
  await expect(page.getByText(/not generative AI/)).toBeVisible();

  await page.getByRole('button', { name: 'Generate outputs from templates' }).click();
  const post = page.getByRole('article', { name: 'Post' });
  await expect(post).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(7);
  await expect(post.getByText(/^template · v1$/)).toBeVisible();

  const box = post.getByRole('textbox');
  await box.fill('Texto editado por mim sobre energia solar.');
  await post.getByRole('button', { name: 'Save changes' }).click();
  await expect(post.getByText(/^template · v2$/)).toBeVisible();

  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export JSON' }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe('Campanha-solar.json');
  const doc = JSON.parse(await (await import('node:fs/promises')).readFile((await dl.path()) as string, 'utf8'));
  expect(doc.schema).toBe('contentflow.export');
  expect(doc.schemaVersion).toBe(1);
  expect(doc.outputs).toHaveLength(7);
  expect(doc.outputs.every((o: { sourceKind: string }) => o.sourceKind === 'template')).toBe(true);
  expect(doc.outputs.find((o: { kind: string }) => o.kind === 'post').body).toContain('editado por mim');

  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  expect(csv.suggestedFilename()).toBe('Campanha-solar.csv');

  // persiste após recarregar
  await page.reload();
  await expect(page.getByLabel('Text', { exact: true })).toHaveValue(PT_TEXT);
  await expect(page.getByRole('article')).toHaveCount(7);
});

test('arquivos: .docx e .pdf são lidos no navegador; tipo inválido é recusado', async ({ page }) => {
  await register(page, `files-${uniq()}@example.com`);
  await openNewProject(page, 'Arquivos');
  const input = page.getByLabel('Open a file');
  const fx = (n: string) => `apps/web/src/lib/fixtures/${n}`;

  await input.setInputFiles(fx('sample.docx'));
  await expect(page.getByLabel('Text', { exact: true })).toHaveValue(/painéis solares/);
  await input.setInputFiles(fx('sample.pdf'));
  await expect(page.getByLabel('Text', { exact: true })).toHaveValue(/Solar panels/);
  await input.setInputFiles({ name: 'x.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  await expect(page.getByRole('alert')).toContainText('Unsupported file type');
  await input.setInputFiles(fx('blank.pdf'));
  await expect(page.getByRole('alert')).toContainText('No extractable text');
});

test('isolamento: B não acessa projeto/outputs/export de A (404)', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await register(a, `pa-${uniq()}@example.com`);
  await register(b, `pb-${uniq()}@example.com`);
  const me = async (p: Page) => (await (await p.request.get('/api/auth/me')).json()).workspaces[0].id as string;
  const wsA = await me(a);
  const clients = await (await a.request.get(`/api/workspaces/${wsA}/clients`)).json();
  const base = `/api/workspaces/${wsA}/clients/${clients.clients[0].id}`;
  const origin = { Origin: new URL(a.url()).origin };
  const proj = await (await a.request.post(`${base}/projects`, { data: { name: 'p' }, headers: origin })).json();
  for (const path of [`${base}/projects`, `${base}/projects/${proj.id}`, `${base}/projects/${proj.id}/outputs`, `${base}/projects/${proj.id}/export-data`]) {
    expect((await b.request.get(path)).status(), path).toBe(404);
  }
});

// ---------- Fase 3: transcrição ----------
function wavBuffer(seconds = 1, rate = 8000) {
  const n = seconds * rate;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const SRT_FILE = `1
00:00:00,000 --> 00:00:01,000
Olá, bem-vindo ao canal.

2
00:00:01,000 --> 00:00:03,000
Hoje falamos de energia solar.
`;

test('transcrição colada: revisão editável, aprovação e uso como texto-fonte', async ({ page }) => {
  await register(page, `tr1-${uniq()}@example.com`);
  await openNewProject(page, 'Podcast');
  await page.getByLabel('Transcript text').fill('Bem-vindos ao episódio sobre energia solar no Brasil.');
  await page.getByRole('button', { name: 'Send for review' }).click();

  const review = page.getByLabel('Review before saving');
  await expect(review).toBeVisible();
  await review.getByRole('textbox').fill('Bem-vindos ao episódio revisado sobre energia solar.');
  await review.getByRole('button', { name: 'Approve and save' }).click();

  await expect(page.getByLabel('Transcript', { exact: true })).toContainText('episódio revisado');
  await expect(page.getByRole('button', { name: /pasted|colada/i })).toBeVisible();
  await page.getByRole('button', { name: 'Use as source text' }).click();
  await expect(page.getByLabel('Text', { exact: true })).toHaveValue('Bem-vindos ao episódio revisado sobre energia solar.');

  await page.reload(); // persistiu
  await expect(page.getByRole('button', { name: /pasted/i })).toBeVisible();
});

test('cancelar na revisão não salva transcrição', async ({ page }) => {
  await register(page, `tr2-${uniq()}@example.com`);
  await openNewProject(page, 'Cancelar');
  await page.getByLabel('Transcript text').fill('Rascunho que será descartado.');
  await page.getByRole('button', { name: 'Send for review' }).click();
  await page.getByLabel('Review before saving').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('No transcripts yet.')).toBeVisible();
  await expect(page.getByLabel('Open jobs')).toHaveCount(0);
});

test('SRT: segmentos com timestamps, player local e exportação SRT/VTT', async ({ page }) => {
  await register(page, `tr3-${uniq()}@example.com`);
  await openNewProject(page, 'Legendas');

  // áudio local (nunca enviado): nenhuma requisição leva o arquivo
  const uploads: string[] = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && (r.postData() ?? '').includes('RIFF')) uploads.push(r.url()); });
  await page.getByLabel('Audio file (optional)').setInputFiles({ name: 'ep.wav', mimeType: 'audio/wav', buffer: wavBuffer(3) });
  await expect(page.locator('audio')).toBeVisible();
  await expect(page.getByText(/Duration: 00:00:0[23]/)).toBeVisible();

  await page.getByRole('tab', { name: 'Import SRT/VTT' }).click();
  await page.getByLabel('Subtitle file (.srt or .vtt)').setInputFiles({ name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT_FILE) });
  const review = page.getByLabel('Review before saving');
  await expect(review.getByText('00:00:01.000')).toBeVisible();
  await expect(review.getByRole('textbox')).toHaveCount(0); // com timestamps não edita
  await review.getByRole('button', { name: 'Approve and save' }).click();

  const view = page.getByLabel('Transcript', { exact: true });
  await expect(view).toContainText('Hoje falamos de energia solar.');
  await view.getByRole('button', { name: /Hoje falamos/ }).click(); // seek no player

  const fs = await import('node:fs/promises');
  const grab = async (name: string) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), view.getByRole('button', { name, exact: true }).click()]);
    return fs.readFile((await dl.path()) as string, 'utf8');
  };
  expect(await grab('SRT')).toBe('1\n00:00:00,000 --> 00:00:01,000\nOlá, bem-vindo ao canal.\n\n2\n00:00:01,000 --> 00:00:03,000\nHoje falamos de energia solar.\n');
  expect((await grab('VTT')).startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOlá')).toBe(true);
  expect(uploads).toEqual([]);
});

test('SRT inválido e áudio de tipo errado mostram erro claro', async ({ page }) => {
  await register(page, `tr4-${uniq()}@example.com`);
  await openNewProject(page, 'Erros');
  await page.getByRole('tab', { name: 'Import SRT/VTT' }).click();
  await page.getByLabel('Subtitle file (.srt or .vtt)').setInputFiles({ name: 'x.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:00:05,000 --> 00:00:01,000\nx\n') });
  await expect(page.getByRole('alert')).toContainText('invalid timestamps');
  await page.getByLabel('Audio file (optional)').setInputFiles({ name: 'x.flac', mimeType: 'audio/flac', buffer: Buffer.from('fLaC') });
  await expect(page.getByRole('alert').first()).toContainText('Unsupported file type');
});

test('WASM: requisitos visíveis; mobile bloqueado por padrão; sem áudio não inicia', async ({ page }, info) => {
  await register(page, `tr5-${uniq()}@example.com`);
  await openNewProject(page, 'Wasm');
  await page.getByRole('tab', { name: 'In your browser (experimental)' }).click();
  const box = page.getByLabel('In your browser (experimental)').last();
  await expect(box).toContainText('Experimental');
  await expect(box).toContainText('about 40–80 MB');
  await expect(box).toContainText('4 GB');
  await expect(box).toContainText('Always review the text');
  const start = box.getByRole('button', { name: 'Start transcription' });
  await expect(start).toBeDisabled();

  await page.getByLabel('Audio file (optional)').setInputFiles({ name: 'a.wav', mimeType: 'audio/wav', buffer: wavBuffer(2) });
  await expect(box.getByText(/Rough estimate/)).toBeVisible();
  if (info.project.name === 'mobile') {
    await expect(box.getByRole('alert')).toContainText('Blocked by default on phones');
    await expect(start).toBeDisabled();
    await box.getByLabel('I understand the risks and want to try anyway').check();
    await expect(start).toBeEnabled();
  } else {
    await expect(start).toBeEnabled();
  }
  // nenhum job foi criado só por abrir a aba
  const ws = (await (await page.request.get('/api/auth/me')).json()).workspaces[0].id;
  expect(ws).toBeTruthy();
});

test('isolamento: B não acessa transcrições/jobs de A (404)', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await register(a, `ta-${uniq()}@example.com`);
  await register(b, `tb-${uniq()}@example.com`);
  const wsA = (await (await a.request.get('/api/auth/me')).json()).workspaces[0].id as string;
  const cl = (await (await a.request.get(`/api/workspaces/${wsA}/clients`)).json()).clients[0].id as string;
  const base = `/api/workspaces/${wsA}/clients/${cl}`;
  const origin = { Origin: new URL(a.url()).origin };
  const proj = await (await a.request.post(`${base}/projects`, { data: { name: 'p' }, headers: origin })).json();
  const job = await (await a.request.post(`${base}/projects/${proj.id}/transcript-jobs`, { data: { origin: 'pasted', text: 'segredo' }, headers: origin })).json();
  const done = await (await a.request.post(`${base}/projects/${proj.id}/transcript-jobs/${job.id}/approve`, { data: {}, headers: origin })).json();
  for (const path of [`/transcript-jobs`, `/transcript-jobs/${job.id}`, `/transcripts`, `/transcripts/${done.transcriptId}`]) {
    expect((await b.request.get(`${base}/projects/${proj.id}${path}`)).status(), path).toBe(404);
  }
});
