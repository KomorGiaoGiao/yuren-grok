import { test, expect, type Page } from '@playwright/test';
import { installTauriMocks } from '../visual/mock-tauri';

// Isolated IPC fixture: records calls and supplies controlled errors/events. Never touches real Grok data.
async function boot(page: Page, scenario = '') {
  await installTauriMocks(page);
  await page.addInitScript(({ scenario }) => {
    const w = window as any;
    const original = w.__TAURI_INTERNALS__;
    const callbacks = new Map(); const listeners = new Map(); let serial = 0;
    w.auditCalls = []; w.auditErrors = [];
    window.addEventListener('unhandledrejection', e => { w.auditErrors.push(String(e.reason)); e.preventDefault(); });
    w.auditEmit = (event: string, payload: unknown) => { const cb = callbacks.get(listeners.get(event)); cb?.({ event, id: 1, payload }); };
    w.__TAURI_INTERNALS__ = { ...original,
      transformCallback: (callback: any) => { const id = ++serial; callbacks.set(id, callback); return id; },
      unregisterCallback: (id: number) => callbacks.delete(id),
      invoke: async (cmd: string, args: any) => {
        w.auditCalls.push({ cmd, args });
        if (cmd === 'plugin:event|listen') { listeners.set(args.event, args.handler); return serial; }
        if (scenario === 'settings-error' && cmd === 'save_settings') throw 'AUDIT: disk is read-only';
        if (scenario === 'plugins-error' && cmd === 'list_plugins') throw 'AUDIT: plugin command timed out';
        if (scenario === 'connect-error' && cmd === 'start_session') throw 'AUDIT: authentication failed';
        if (cmd === 'prepare_workspace') return '/tmp/grok-audit-workspace';
        if (cmd === 'start_session') {
          if (scenario === 'slow-connect') await new Promise(r => setTimeout(r, 300));
          return { sessionId: args.request.sessionId || 'audit-new', grokPath: '/tmp/mock-grok' };
        }
        if (cmd === 'send_prompt') {
          if (scenario === 'prompt-error') throw 'AUDIT: network unavailable';
          if (scenario === 'pending') return new Promise(() => {});
          w.auditEmit('agent-update', { sessionId: args.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'AUDIT response' } } });
          return {};
        }
        return original.invoke(cmd, args);
      }
    };
  }, { scenario });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Fix login flow', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).auditCalls.some((c: any) => c.cmd === 'plugin:event|listen' && c.args.event === 'agent-permission'))).toBeTruthy();
}
const calls = (page: Page, cmd: string) => page.evaluate(cmd => (window as any).auditCalls.filter((c: any) => c.cmd === cmd), cmd);
async function openHistory(page: Page) {
  await page.getByRole('button', { name: 'Fix login flow', exact: true }).click();
  await expect(page.getByTestId('assistant-block')).toBeVisible();
  await expect(page.getByText('正在连接 Grok…')).toHaveCount(0);
}
async function permission(page: Page, options: any[]) {
  await page.evaluate(options => (window as any).auditEmit('agent-permission', { rpcId: 99, params: { title: 'AUDIT permission', options } }), options);
  await expect(page.getByText('AUDIT permission')).toBeVisible();
}

test('dropped files send as @path references', async ({ page }) => {
  await boot(page);
  await page.getByTestId('composer-box').evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/uri-list', 'file:///Users/demo/clip.mp4');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: data });
    el.dispatchEvent(event);
  });
  await expect(page.getByText('clip.mp4')).toBeVisible();
  await page.locator('textarea').fill('看看这个视频');
  await page.locator('textarea').press('Enter');
  const sent = await calls(page, 'send_prompt');
  expect(sent).toHaveLength(1);
  expect(sent[0].args.text).toContain('@/Users/demo/clip.mp4');
  expect(sent[0].args.text).toContain('看看这个视频');
});
test('normal prompt renders response and exits busy state', async ({ page }) => {
  await boot(page); await page.locator('textarea').fill('audit hello'); await page.locator('textarea').press('Enter');
  await expect(page.getByText('AUDIT response', { exact: true })).toBeVisible();
  expect((await calls(page, 'send_prompt')).length).toBe(1);
  await expect(page.getByTestId('turn-wait')).toHaveCount(0);
});
test('Shift+Enter inserts newline without sending', async ({ page }) => {
  await boot(page); await page.locator('textarea').fill('line'); await page.locator('textarea').press('Shift+Enter');
  await expect(page.locator('textarea')).toHaveValue('line\n'); expect(await calls(page, 'send_prompt')).toHaveLength(0);
});
test('IME composing Enter must not send', async ({ page }) => {
  await boot(page); await openHistory(page); await page.locator('textarea').fill('中文候选');
  await page.locator('textarea').dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
  await expect(page.locator('textarea')).toHaveValue('中文候选'); expect(await calls(page, 'send_prompt')).toHaveLength(0);
});
test('failed initial connection preserves draft and real error', async ({ page }) => {
  await boot(page, 'connect-error'); await page.locator('textarea').fill('important unsent draft'); await page.locator('textarea').press('Enter');
  await expect(page.locator('textarea')).toHaveValue('important unsent draft');
  await expect(page.locator('.banner')).toContainText('authentication failed');
});
test('failed prompt offers retry or restores draft', async ({ page }) => {
  await boot(page, 'prompt-error'); await openHistory(page); await page.locator('textarea').fill('retry me'); await page.locator('textarea').press('Enter');
  await expect(page.locator('.banner')).toContainText('network unavailable');
  expect(await page.locator('textarea').inputValue() === 'retry me' || await page.getByRole('button', { name: /重试|retry/i }).count() > 0).toBeTruthy();
});
test('connecting prevents duplicate sends', async ({ page }) => {
  await boot(page, 'slow-connect'); await page.locator('textarea').fill('first'); await page.locator('textarea').press('Enter');
  await page.locator('textarea').fill('second'); await page.locator('textarea').press('Enter');
  await expect(page.getByText('AUDIT response', { exact: true }).first()).toBeVisible();
  expect(await calls(page, 'start_session')).toHaveLength(1);
});
test('new conversation ignores stale session updates', async ({ page }) => {
  await boot(page); await openHistory(page); await page.getByTestId('nav-new').click();
  await page.evaluate(() => (window as any).auditEmit('agent-update', { sessionId: '01visual-session', update: { sessionUpdate: 'agent_message_chunk', content: { text: 'STALE OLD SESSION' } } }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByText('STALE OLD SESSION')).toHaveCount(0);
});
test('normal rejection sends reject option', async ({ page }) => {
  await boot(page); await permission(page, [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }]);
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  expect((await calls(page, 'respond_permission'))[0].args.optionId).toBe('no');
});
test('reject must not fall back to allow when rejection option is absent', async ({ page }) => {
  await boot(page); await permission(page, [{ optionId: 'yes', kind: 'allow_once' }]);
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  expect((await calls(page, 'respond_permission')).some((c: any) => c.args.optionId === 'yes')).toBeFalsy();
});
test('permission dialog has accessible dialog semantics and initial focus', async ({ page }) => {
  await boot(page); await permission(page, [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }]);
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.locator('.modal').evaluate(el => el.contains(document.activeElement))).toBeTruthy();
});
test('starting new conversation clears pending permission', async ({ page }) => {
  await boot(page); await permission(page, [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }]);
  // Programmatic click intentionally tests lifecycle cleanup beneath an overlay.
  await page.getByTestId('nav-new').dispatchEvent('click');
  await expect(page.getByText('AUDIT permission')).toHaveCount(0);
});
test('settings save failure is visible to the user', async ({ page }) => {
  await boot(page, 'settings-error'); await page.getByTestId('nav-settings').click(); await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByTestId('main')).toContainText('disk is read-only');
});
test('plugin load failure is visible instead of empty success', async ({ page }) => {
  await boot(page, 'plugins-error'); await page.getByTestId('nav-plugins').click();
  await expect(page.getByTestId('main')).toContainText('timed out');
});
test('rename persists and search finds new title', async ({ page }) => {
  await boot(page); await page.getByRole('button', { name: 'Fix login flow', exact: true }).click({ button: 'right' });
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await page.locator('.session-rename').fill('Renamed audit conversation'); await page.locator('.session-rename').press('Enter');
  await expect(page.getByRole('button', { name: 'Renamed audit conversation', exact: true })).toBeVisible();
  await page.getByTestId('nav-search').click(); await page.getByRole('textbox', { name: '搜索对话' }).fill('Renamed audit conversation');
  await expect(page.getByTestId('search-palette').getByRole('button', { name: /Renamed audit conversation/ })).toBeVisible();
});
test('search keyboard selects conversation and Escape dismisses', async ({ page }) => {
  await boot(page); await page.keyboard.press('ControlOrMeta+k'); await page.getByRole('textbox', { name: '搜索对话' }).fill('Reset');
  await page.keyboard.press('Enter'); await expect(page.getByTestId('search-palette')).toHaveCount(0);
  await expect(page.locator('.crumb')).toContainText('Reset password');
  await page.keyboard.press('ControlOrMeta+k'); await page.keyboard.press('Escape'); await expect(page.getByTestId('search-palette')).toHaveCount(0);
});
test('stop sends cancellation and recovers composer', async ({ page }) => {
  await boot(page, 'pending'); await openHistory(page); await page.locator('textarea').fill('long task'); await page.locator('textarea').press('Enter');
  await page.getByRole('button', { name: '停止', exact: true }).click();
  expect(await calls(page, 'cancel_prompt')).toHaveLength(1); await expect(page.getByTestId('turn-wait')).toHaveCount(0);
});
test('agent exit recovers from busy state', async ({ page }) => {
  await boot(page, 'pending'); await openHistory(page); await page.locator('textarea').fill('crash task'); await page.locator('textarea').press('Enter');
  await expect(page.getByTestId('turn-wait')).toBeVisible();
  await page.evaluate(() => (window as any).auditEmit('agent-exit', { reason: 'stdout-closed' }));
  await expect(page.getByTestId('turn-wait')).toHaveCount(0);
});
for (const locale of ['zh-CN', 'zh-TW', 'en']) {
  for (const size of [{ width: 960, height: 640 }, { width: 1320, height: 860 }]) {
    test(`layout ${locale} ${size.width}x${size.height}`, async ({ page }, info) => {
      await page.setViewportSize(size); await boot(page); await page.getByTestId('nav-settings').click();
      await page.locator('.field select').first().selectOption(locale);
      for (const section of ['settings', 'skills', 'plugins', 'new']) {
        await page.getByTestId(`nav-${section}`).click();
        await page.screenshot({ path: info.outputPath(`${section}.png`), animations: 'disabled' });
        const clipped = await page.locator('button:visible,input:visible,select:visible,textarea:visible').evaluateAll(els => els.filter(el => {
          const r = el.getBoundingClientRect();
          const scrollParent = el.closest('.page');
          return r.left < -1 || r.right > innerWidth + 1 || (!scrollParent && r.bottom > innerHeight + 1);
        }).map(el => ({ text: el.textContent?.slice(0, 70), rect: el.getBoundingClientRect().toJSON() })));
        expect.soft(clipped, section).toEqual([]);
      }
    });
  }
}
for (const shot of ['chat-empty', 'skills', 'plugins']) {
  test(`independent original baseline ${shot}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 }); await boot(page);
    if (shot !== 'chat-empty') await page.getByTestId(`nav-${shot}`).click();
    await expect(page).toHaveScreenshot(`${shot}-chrome-darwin.png`, {
      maxDiffPixelRatio: 0.008,
    });
  });
}
