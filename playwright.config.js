import { defineConfig, devices } from '@playwright/test';

// Os testes rodam contra o build (vite preview) apontando para o Supabase local
// (bash scripts/supabase-local/iniciar.sh + supabase/setup.sql aplicado).
export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined } },
  projects: [
    { name: 'celular', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } }
  ],
  webServer: {
    command: 'npx vite build --mode development && npx vite preview --mode development',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000
  }
});
