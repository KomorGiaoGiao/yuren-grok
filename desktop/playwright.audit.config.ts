import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/audit', workers: 1, timeout: 15000, retries: 0,
  expect: { timeout: 1500 },
  reporter: [['list'], ['json', { outputFile: 'artifacts/audit/results.json' }], ['html', { outputFolder: 'artifacts/audit/html', open: 'never' }]],
  outputDir: 'artifacts/audit/results',
  snapshotPathTemplate: '{testDir}/../visual/layout.spec.ts-snapshots/{arg}{ext}',
  use: { baseURL: 'http://127.0.0.1:1420', channel: 'chrome', viewport: { width: 1320, height: 860 }, locale: 'zh-CN', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npx vite --host 127.0.0.1 --port 1420', url: 'http://127.0.0.1:1420', reuseExistingServer: true },
});
