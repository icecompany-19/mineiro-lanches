import { defineConfig, devices } from '@playwright/test';

// Os testes rodam contra o build (vite preview) apontando para o Supabase local
// (bash scripts/supabase-local/iniciar.sh + supabase/setup.sql aplicado; o tests/e2e.spec.js recria o banco sozinho).
// Porta própria (PORTA_TESTE, padrão 4180): a 4173 do "vite preview" costuma estar ocupada por outros servidores.
// Um worker só: o e2e recria o banco local e os outros testes não podem cair no meio disso.
const PORTA = Number(process.env.PORTA_TESTE || 4180);
const E2E = /e2e\.spec\.js$/;

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORTA}`, launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined } },
  projects: [
    { name: 'celular', use: { ...devices['Pixel 7'] }, testIgnore: E2E },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } }, testIgnore: E2E },
    // Chrome e Safari no iPhone usam WebKit; o Chromium do Android não reproduz o layout do dialog.
    {
      name: 'iphone',
      testMatch: /(?:ficha|cotacao-entrega|usuarios|mercado-pago|produtos|despacho)\.spec\.js$/,
      use: { ...devices['iPhone 13'], browserName: 'webkit', launchOptions: { executablePath: undefined } }
    },
    // fluxo completo com dois aparelhos ao mesmo tempo (celular do cliente + computador do painel): o próprio teste abre os dois
    { name: 'e2e', testMatch: E2E, use: { viewport: { width: 1280, height: 800 } } }
  ],
  webServer: {
    command: `npx vite build --mode development && npx vite preview --mode development --port ${PORTA} --strictPort`,
    url: `http://localhost:${PORTA}`,
    reuseExistingServer: true,
    timeout: 120_000
  }
});
