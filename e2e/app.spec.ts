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
