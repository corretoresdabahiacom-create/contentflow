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

// ---------- Fase 4: cortes, canais, SRT/VTT ----------
const TOPIC_LINES = [
  'A energia solar cresceu muito no Brasil.',
  'Os painéis solares reduzem a conta de luz.',
  'A energia solar é limpa e os painéis duram vinte anos.',
  'Instalar painéis solares exige pouca manutenção.',
  'Muitos painéis solares já estão em telhados do Nordeste.',
  'A energia solar gera economia todo mês.',
  'Agora vamos falar de receitas de bolo.',
  'O bolo de cenoura leva três ovos e duas cenouras.',
  'Misture a farinha com o açúcar e a manteiga do bolo.',
  'Você sabe qual é o segredo da cobertura de chocolate?',
  'A cobertura de chocolate precisa de creme de leite e chocolate.',
  'Asse o bolo por quarenta minutos no forno quente.',
];
const clock = (s: number) => `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},000`;
const TOPIC_SRT = TOPIC_LINES.map((t, i) => `${i + 1}\n${clock(i * 6)} --> ${clock(i * 6 + 5)}\n${t}`).join('\n\n');

async function importSrt(page: Page, srt: string) {
  await page.getByRole('tab', { name: 'Import SRT/VTT' }).click();
  await page.getByLabel('Subtitle file (.srt or .vtt)').setInputFiles({ name: 'a.srt', mimeType: 'text/plain', buffer: Buffer.from(srt) });
  await page.getByLabel('Review before saving').getByRole('button', { name: 'Approve and save' }).click();
  await expect(page.getByLabel('Transcript', { exact: true })).toBeVisible();
}

test('cortes: heurística com justificativa, edição, manual, regenerar preserva edições, exportação', async ({ page }) => {
  await register(page, `clip-${uniq()}@example.com`);
  await openNewProject(page, 'Cortes');
  const panel = page.getByLabel('Clip suggestions', { exact: true });
  await expect(panel.getByText(/does not analyze audio or video/)).toBeVisible();
  await expect(panel.getByText(/need a transcript with timestamps/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Suggest clips' })).toHaveCount(0);

  await importSrt(page, TOPIC_SRT);
  await panel.getByRole('button', { name: 'Suggest clips' }).click();
  const cards = panel.getByRole('article');
  await expect(cards.first()).toBeVisible();
  await expect(cards.first().getByText('Why:')).toBeVisible();
  await expect(panel.getByText(/topic shifts|question|number|imperative/).first()).toBeVisible();
  const total = await cards.count();
  expect(total).toBeGreaterThan(0);
  // as justificativas nunca falam de emoção, rosto ou viralidade (só o aviso geral nega isso)
  const reasons = (await cards.allInnerTexts()).join(' ').toLowerCase();
  expect(reasons).not.toMatch(/viral|emotion|emoç|facial|engaj/);

  // edição manual com versão
  const first = cards.first();
  await first.getByLabel('Title').fill('Meu título de corte');
  await first.getByRole('button', { name: 'Save changes' }).click();
  await expect(panel.getByRole('article', { name: 'Clip: Meu título de corte' })).toContainText('edited');
  await expect(panel.getByRole('article', { name: 'Clip: Meu título de corte' })).toContainText('v2');

  // intervalo inválido bloqueia salvar
  const edited = panel.getByRole('article', { name: 'Clip: Meu título de corte' });
  await edited.getByLabel('End (m:ss)').fill('0:00');
  await expect(edited.getByRole('alert')).toContainText('end after the start');
  await expect(edited.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await edited.getByLabel('End (m:ss)').fill('0:50');

  // corte manual
  const form = panel.getByRole('form', { name: 'Add clip manually' });
  await form.getByLabel('Title').fill('Corte manual');
  await form.getByLabel('Start (m:ss)').fill('0:10');
  await form.getByLabel('End (m:ss)').fill('0:40');
  await form.getByRole('button', { name: 'Add clip manually' }).click();
  await expect(panel.getByRole('article', { name: 'Clip: Corte manual' })).toContainText('manual');

  // regenerar não apaga o editado nem o manual
  await panel.getByRole('button', { name: 'Suggest clips' }).click();
  await expect(panel.getByRole('article', { name: 'Clip: Meu título de corte' })).toBeVisible();
  await expect(panel.getByRole('article', { name: 'Clip: Corte manual' })).toBeVisible();

  // persiste e vai para o JSON exportado
  await page.reload();
  await expect(panel.getByRole('article', { name: 'Clip: Corte manual' })).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()]);
  const doc = JSON.parse(await (await import('node:fs/promises')).readFile((await dl.path()) as string, 'utf8'));
  expect(doc.clips.map((c: { title: string }) => c.title)).toEqual(expect.arrayContaining(['Meu título de corte', 'Corte manual']));
  expect(doc.clips.find((c: { title: string }) => c.title === 'Corte manual').origin ?? 'manual').toBe('manual');
  expect(doc.transcript.segments).toHaveLength(12);

  // excluir
  await panel.getByRole('article', { name: 'Clip: Corte manual' }).getByRole('button', { name: 'Delete' }).click();
  await expect(panel.getByRole('article', { name: 'Clip: Corte manual' })).toHaveCount(0);
});

test('exportação SRT/VTT só com timestamps; MD traz cortes', async ({ page }) => {
  await register(page, `subs-${uniq()}@example.com`);
  await openNewProject(page, 'Subs');
  await expect(page.getByRole('button', { name: 'Export SRT' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export VTT' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeEnabled();

  await importSrt(page, TOPIC_SRT);
  await expect(page.getByRole('button', { name: 'Export SRT' })).toBeEnabled();
  const fs = await import('node:fs/promises');
  const grab = async (name: string) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).click()]);
    return { file: dl.suggestedFilename(), body: await fs.readFile((await dl.path()) as string, 'utf8') };
  };
  const srt = await grab('Export SRT');
  expect(srt.file).toBe('Subs.srt');
  expect(srt.body.startsWith('1\n00:00:00,000 --> 00:00:05,000\nA energia solar cresceu')).toBe(true);
  expect(srt.body.trimEnd().split('\n\n')).toHaveLength(12);
  expect((await grab('Export VTT')).body.startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:05.000')).toBe(true);
});

test('canais: templates por canal, contador de limite e rótulo template', async ({ page }) => {
  await register(page, `chan-${uniq()}@example.com`);
  await openNewProject(page, 'Canais');
  await page.getByLabel('Text', { exact: true }).fill(PT_TEXT);
  await page.getByRole('button', { name: 'Save and analyze' }).click();
  await expect(page.getByTestId('lang')).toHaveText('pt');

  const group = page.getByRole('group', { name: 'Generate for channels' });
  for (const c of ['YouTube', 'TikTok', 'Facebook', 'Blog', 'E-mail']) await group.getByLabel(c, { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Generate for selected channels' }).click();

  const insta = page.getByRole('article', { name: 'Instagram · Caption' });
  await expect(insta).toBeVisible();
  await expect(insta.getByText(/^template · v1$/)).toBeVisible();
  await expect(insta.getByText(/\/ 2,200 characters/)).toBeVisible();
  await expect(insta.getByRole('textbox')).toHaveValue(/#\w+/);
  await expect(page.getByRole('article', { name: 'LinkedIn · Post' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(2);

  // passar do limite avisa
  await insta.getByRole('textbox').fill('x'.repeat(2300));
  await expect(insta.getByText(/Over the approximate limit/)).toBeVisible();
});

test('isolamento: B não acessa clips de A (404)', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await register(a, `ca-${uniq()}@example.com`);
  await register(b, `cb-${uniq()}@example.com`);
  const wsA = (await (await a.request.get('/api/auth/me')).json()).workspaces[0].id as string;
  const cl = (await (await a.request.get(`/api/workspaces/${wsA}/clients`)).json()).clients[0].id as string;
  const base = `/api/workspaces/${wsA}/clients/${cl}`;
  const origin = { Origin: new URL(a.url()).origin };
  const proj = await (await a.request.post(`${base}/projects`, { data: { name: 'p' }, headers: origin })).json();
  const mk = await a.request.post(`${base}/projects/${proj.id}/clips`, { data: { clips: [{ startMs: 0, endMs: 5000, title: 't', justification: 'j', origin: 'manual' }] }, headers: origin });
  expect(mk.status()).toBe(201);
  expect((await b.request.get(`${base}/projects/${proj.id}/clips`)).status()).toBe(404);
  const bOrigin = { Origin: new URL(b.url()).origin };
  expect((await b.request.post(`${base}/projects/${proj.id}/clips`, { data: { clips: [{ startMs: 0, endMs: 5000, title: 't', justification: 'j' }] }, headers: bOrigin })).status()).toBe(404);
});

test('plano de edição: exporta MD/CSV/TXT/JSON com IN/OUT, roteiro e notas; sem vídeo', async ({ page }) => {
  await register(page, `plan-${uniq()}@example.com`);
  await openNewProject(page, 'Plano');
  const panel = page.getByLabel('Clip suggestions', { exact: true });
  const plan = panel.getByLabel('Edit plan', { exact: true });
  await expect(plan.getByText(/does not cut or render video/)).toBeVisible();
  await expect(plan.getByRole('note')).toContainText('não corta nem renderiza vídeo');
  await expect(plan.getByRole('button', { name: 'Edit plan as MD' })).toBeDisabled();

  await importSrt(page, TOPIC_SRT);
  const form = panel.getByRole('form', { name: 'Add clip manually' });
  await form.getByLabel('Title').fill('=Abertura');
  await form.getByLabel('Start (m:ss)').fill('0:00');
  await form.getByLabel('End (m:ss)').fill('0:20');
  await form.getByRole('button', { name: 'Add clip manually' }).click();
  const card = panel.getByRole('article', { name: 'Clip: =Abertura' });
  await card.getByLabel('Notes').fill('usar b-roll aqui');
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(card).toContainText('v2');
  await expect(plan.getByRole('button', { name: 'Edit plan as MD' })).toBeEnabled();

  const fs = await import('node:fs/promises');
  const grab = async (name: string) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), plan.getByRole('button', { name }).click()]);
    return { file: dl.suggestedFilename(), body: await fs.readFile((await dl.path()) as string, 'utf8') };
  };
  const md = await grab('Edit plan as MD');
  expect(md.file).toBe('Plano-edit-plan.md');
  expect(md.body).toContain('# Plano de edição — Plano');
  expect(md.body).toContain('`00:00:00.000`');
  expect(md.body).toContain('`00:00:20.000`');
  expect(md.body).toContain('A energia solar cresceu');
  expect(md.body).toContain('usar b-roll aqui');
  expect(md.body).toMatch(/não contém vídeo/);

  const csv = await grab('Edit plan as CSV');
  expect(csv.file).toBe('Plano-edit-plan.csv');
  const lines = csv.body.trimEnd().split('\r\n');
  expect(lines[0]).toBe('index,clip_id,title,in,out,duration_s,in_ms,out_ms,script,script_source,justification,notes,edited');
  expect(lines[1]).toContain(",'=Abertura,");
  expect(lines[1]).toContain('00:00:00.000,00:00:20.000,20.000,0,20000');
  expect((await grab('Edit plan as TXT')).body).toMatch(/IN 00:00:00\.000\s+OUT 00:00:20\.000/);
  const json = JSON.parse((await grab('Edit plan as JSON')).body);
  expect(json).toMatchObject({ schema: 'contentflow.edit-plan', schemaVersion: 1 });
  expect(json.items[0]).toMatchObject({ title: '=Abertura', inMs: 0, outMs: 20000, scriptSource: 'transcript', notes: 'usar b-roll aqui' });
  // nada de vídeo: não há botão de cortar/renderizar
  await expect(page.getByRole('button', { name: /cortar vídeo|cut video|render/i })).toHaveCount(0);
});

// ---------- Fase 6: equipes, calendário, aprovações e compartilhamento ----------
const apiOf = (page: Page) => {
  const origin = { Origin: new URL(page.url()).origin };
  return {
    get: async (path: string) => page.request.get(path),
    send: async (method: 'post' | 'put' | 'patch' | 'delete', path: string, data?: unknown) =>
      page.request.fetch(path, { method: method.toUpperCase(), data, headers: origin }),
  };
};
const wsOf = async (p: Page, kind: 'personal' | 'agency') =>
  ((await (await p.request.get('/api/auth/me')).json()).workspaces as { id: string; kind: string }[]).find((w) => w.kind === kind)!.id;

/** Cria client, projeto, texto-fonte e dois outputs por API (o que está em teste é a Fase 6, não a Fase 2). */
async function seedContent(page: Page, ws: string, clientName?: string) {
  const a = apiOf(page);
  let clientId: string;
  if (clientName) clientId = (await (await a.send('post', `/api/workspaces/${ws}/clients`, { name: clientName })).json()).id;
  else clientId = (await (await a.get(`/api/workspaces/${ws}/clients`)).json()).clients[0].id;
  const base = `/api/workspaces/${ws}/clients/${clientId}`;
  const projectId = (await (await a.send('post', `${base}/projects`, { name: 'Projeto' })).json()).id;
  await a.send('put', `${base}/projects/${projectId}/source`, { kind: 'paste', text: 'TEXTO-FONTE-PRIVADO que nunca deve vazar.' });
  const outs = (await (await a.send('post', `${base}/projects/${projectId}/outputs`, { outputs: [{ channel: 'generic', kind: 'post', title: 'Título público', body: 'Corpo escolhido para o cliente.' }, { channel: 'generic', kind: 'post', title: 'Título interno', body: 'Rascunho que não será compartilhado.' }] })).json()).outputs as { id: string }[];
  return { clientId, projectId, base, outs };
}

test('equipe: convite por link (uso único), papéis e aprovação de output', async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  const late = await (await browser.newContext()).newPage();
  await register(owner, `own-${uniq()}@example.com`);
  await register(guest, `gst-${uniq()}@example.com`);
  await register(late, `lat-${uniq()}@example.com`);

  // owner cria o workspace de equipe e o conteúdo
  await owner.getByLabel('Team workspace name').fill('Agência Sol');
  await owner.getByRole('button', { name: 'Create team workspace' }).click();
  await expect(owner.getByLabel('Active workspace')).toBeVisible();
  const ws = await wsOf(owner, 'agency');
  const seeded = await seedContent(owner, ws, 'Cliente Praia');

  // convite por link
  await owner.getByRole('link', { name: 'Team, members and invites' }).click();
  await expect(owner.getByRole('heading', { name: 'Team: Agência Sol' })).toBeVisible();
  await owner.getByRole('button', { name: 'Create invite link' }).click();
  const inviteUrl = await owner.getByLabel('Invite link', { exact: true }).inputValue();
  expect(inviteUrl).toMatch(/\/invite\/[\w-]{40,}$/);
  await expect(owner.getByText(/it will not be shown again/)).toBeVisible();

  await guest.goto(inviteUrl);
  await expect(guest.getByText(/invited to join “Agência Sol” as member/)).toBeVisible();
  await guest.getByRole('button', { name: 'Accept invite' }).click();
  await expect(guest).toHaveURL(/\/app$/);
  await guest.getByLabel('Active workspace').selectOption({ label: 'Agência Sol (agency)' });
  await expect(guest.getByRole('region', { name: 'Cliente Praia' })).toBeVisible();

  // uso único: o mesmo link não funciona para outra pessoa
  await late.goto(inviteUrl);
  await expect(late.getByText(/invalid, expired, revoked or already used/)).toBeVisible();

  // membro pede aprovação na página do projeto
  await guest.goto(`/app/w/${ws}/clients/${seeded.clientId}/projects/${seeded.projectId}`);
  const card = guest.getByRole('article', { name: 'Post' }).first();
  await expect(card.getByText('not requested')).toBeVisible();
  await card.getByRole('button', { name: 'Request approval' }).click();
  await card.getByLabel('Note (optional)').fill('pode publicar?');
  await card.getByRole('button', { name: 'Send request' }).click();
  await expect(card.getByText('approval pending')).toBeVisible();

  // membro não decide; owner vê na caixa de entrada e aprova
  await guest.goto('/app');
  await guest.getByLabel('Active workspace').selectOption({ label: 'Agência Sol (agency)' });
  const item = guest.getByRole('listitem', { name: /^Approval:/ });
  await expect(item).toBeVisible();
  await expect(item.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await owner.goto('/app');
  await owner.getByLabel('Active workspace').selectOption({ label: 'Agência Sol (agency)' });
  const ownerItem = owner.getByRole('listitem', { name: /^Approval:/ });
  await expect(ownerItem).toContainText('pode publicar?');
  await ownerItem.getByRole('button', { name: 'Approve' }).click();
  await expect(owner.getByText('Nothing waiting for approval.')).toBeVisible();

  await guest.goto(`/app/w/${ws}/clients/${seeded.clientId}/projects/${seeded.projectId}`);
  await expect(guest.getByRole('article', { name: 'Post' }).first().getByText('approved', { exact: true })).toBeVisible();
  // editar o output invalida a aprovação
  const first = guest.getByRole('article', { name: 'Post' }).first();
  await first.getByRole('textbox').fill('Corpo editado depois da aprovação');
  await first.getByRole('button', { name: 'Save changes' }).click();
  await expect(first.getByText('changed after approval')).toBeVisible();

  // owner troca o papel e o membro sai
  await owner.goto(`/app/w/${ws}/team`);
  await owner.getByLabel(/^Role of gst-/).selectOption('admin');
  await expect(owner.getByLabel(/^Role of gst-/)).toHaveValue('admin');
});

test('calendário editorial: arrastar entre dias, semana/mês, edição e persistência', async ({ page }, info) => {
  await register(page, `cal-${uniq()}@example.com`);
  await page.getByRole("link", { name: /^Calendar and brand kit of/ }).click();
  await expect(page.getByRole('heading', { name: 'Editorial calendar' })).toBeVisible();
  await expect(page.getByText(/nothing is published automatically/)).toBeVisible();

  const now = new Date();
  const ymd = (d: number) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const cell = (d: number) => page.getByTestId(`day:${Date.UTC(now.getFullYear(), now.getMonth(), d)}`);
  const form = page.getByRole('form', { name: 'New calendar item' });
  await form.getByLabel('Title').fill('Post A');
  await form.getByLabel('Date').fill(ymd(15));
  await form.getByRole('button', { name: 'Add to calendar' }).click();
  await form.getByLabel('Title').fill('Ideia solta');
  await form.getByLabel('Date').fill('');
  await form.getByRole('button', { name: 'Add to calendar' }).click();
  const chip = (title: string) => page.getByRole('button', { name: `Calendar item: ${title}` });
  await expect(cell(15).getByRole('button', { name: /Post A/ })).toBeVisible();
  await expect(page.getByTestId('day:none').getByRole('button', { name: /Ideia solta/ })).toBeVisible();

  if (info.project.name === 'desktop') {
    const drag = async (from: ReturnType<typeof chip>, to: ReturnType<typeof cell>) => {
      const a = (await from.boundingBox())!;
      const b = (await to.boundingBox())!;
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
      await page.mouse.up();
    };
    await drag(chip('Post A'), cell(16));
    await expect(cell(16).getByRole('button', { name: /Post A/ })).toBeVisible();
    await expect(cell(15).getByRole('button', { name: /Post A/ })).toHaveCount(0);
    await page.reload();
    await expect(cell(16).getByRole('button', { name: /Post A/ })).toBeVisible(); // persistiu (versão incrementada)
    // na visão semanal a grade é curta: o item sem data e o dia de hoje cabem na tela ao mesmo tempo
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await drag(chip('Ideia solta'), cell(now.getDate()));
    await expect(cell(now.getDate()).getByRole('button', { name: /Ideia solta/ })).toBeVisible();
    await drag(chip('Ideia solta'), page.getByTestId('day:none'));
    await expect(page.getByTestId('day:none').getByRole('button', { name: /Ideia solta/ })).toBeVisible();
    await page.getByRole('button', { name: 'Month', exact: true }).click();
  } else {
    // no celular o caminho é o formulário (acessível, sem arrastar)
    await chip('Post A').click();
    await page.getByRole('form', { name: 'Edit calendar item' }).getByLabel('Date').fill(ymd(16));
    await page.getByRole('form', { name: 'Edit calendar item' }).getByRole('button', { name: 'Save changes' }).click();
    await expect(cell(16).getByRole('button', { name: /Post A/ })).toBeVisible();
  }

  // edição por formulário: status
  await chip('Post A').click();
  const edit = page.getByRole('form', { name: 'Edit calendar item' });
  await edit.getByLabel('Status').selectOption('review');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(chip('Post A')).toContainText('review');

  // semana
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Week', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect(cell(16).getByRole('button', { name: /Post A/ })).toBeVisible();
});

test('brand kit e compartilhamento: confirmação, página pública só com o escolhido, log e revogação', async ({ page, browser }) => {
  await register(page, `shr-${uniq()}@example.com`);
  const ws = await wsOf(page, 'personal');
  const seeded = await seedContent(page, ws);

  await page.getByRole("link", { name: /^Calendar and brand kit of/ }).click();
  await page.getByRole('tab', { name: 'Brand kit' }).click();
  await page.getByLabel('Logo URL (https)').fill('http://inseguro.example.com/logo.png');
  await page.getByLabel('Brand name').fill('Marca Solar');
  await page.getByLabel('Primary color (#rrggbb)').fill('#1a73e8');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert')).toContainText(/check the data/); // http é recusado (400)
  await page.getByLabel('Logo URL (https)').fill('');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.getByRole('tab', { name: 'Sharing' }).click();
  await page.getByLabel(/Título público/).check();
  await page.getByRole('button', { name: 'Review and create link' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Anyone with this link can read the items below without signing in');
  await expect(dialog).toContainText('Título público');
  await expect(dialog).not.toContainText('Título interno');
  await expect(dialog).toContainText('never shows the source text');
  await dialog.getByRole('button', { name: 'I understand, create the link' }).click();
  const url = await page.getByLabel('Shared link', { exact: true }).inputValue();
  expect(url).toMatch(/\/s\/[\w-]{40,}$/);

  // visitante anônimo (sem cookies)
  const anon = await (await browser.newContext()).newPage();
  const res = await anon.goto(url);
  expect(res?.headers()['x-robots-tag']).toMatch(/noindex/);
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(anon.getByRole('heading', { level: 1, name: 'Marca Solar' })).toBeVisible();
  await expect(anon.getByText('Corpo escolhido para o cliente.')).toBeVisible();
  const text = await anon.locator('body').innerText();
  expect(text).not.toContain('TEXTO-FONTE-PRIVADO');
  expect(text).not.toContain('Rascunho que não será compartilhado');
  expect(text).not.toContain('Título interno');

  // log de acesso e revogação
  await page.getByRole('button', { name: 'Access log' }).click();
  await expect(page.getByRole('list', { name: 'Access log' }).getByRole('listitem')).toHaveCount(1);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByText('revoked').first()).toBeVisible();
  await anon.reload();
  await expect(anon.getByText(/does not exist, expired or was revoked/)).toBeVisible();
  expect(seeded.outs).toHaveLength(2);
});

test('isolamento Fase 6: B não acessa membros, convites, calendário, brand kit nem links de A (404)', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await register(a, `ia-${uniq()}@example.com`);
  await register(b, `ib-${uniq()}@example.com`);
  const ws = await wsOf(a, 'personal');
  const s = await seedContent(a, ws);
  const link = await (await apiOf(a).send('post', `${s.base}/shared-links`, { outputIds: [s.outs[0]!.id] })).json();
  const entry = await (await apiOf(a).send('post', `${s.base}/calendar`, { title: 'x' })).json();
  for (const path of [`/api/workspaces/${ws}/members`, `/api/workspaces/${ws}/invites`, `/api/workspaces/${ws}/approvals`, `${s.base}/calendar`, `${s.base}/brand-kit`, `${s.base}/shared-links`, `${s.base}/outputs`, `${s.base}/shared-links/${link.id}/access-logs`]) {
    expect((await b.request.get(path)).status(), path).toBe(404);
  }
  expect((await apiOf(b).send('patch', `${s.base}/calendar/${entry.id}`, { title: 'invadido', version: 1 })).status()).toBe(404);
  expect((await apiOf(b).send('delete', `${s.base}/shared-links/${link.id}`)).status()).toBe(404);
  expect((await apiOf(b).send('put', `${s.base}/brand-kit`, { name: 'hack' })).status()).toBe(404);
  // o link público de A continua funcionando para quem tem o token (é o propósito), mas só mostra o escolhido
  const pub = await (await b.request.get(`/api/shared/${link.path.split('/s/')[1]}`)).json();
  expect(pub.outputs).toHaveLength(1);
});
