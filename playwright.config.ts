import { defineConfig, devices } from '@playwright/test';

// Usa o Chrome instalado no sistema (channel: 'chrome'); em CI, instale com `playwright install chrome`.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:8787', locale: 'en-US', trace: 'retain-on-failure' },
  webServer: {
    command: 'bash e2e/start.sh',
    url: 'http://localhost:8787/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chrome' } },
  ],
});
