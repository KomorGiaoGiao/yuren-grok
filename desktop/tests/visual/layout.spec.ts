import { expect, test } from "@playwright/test";
import { assertNoOverflow, installTauriMocks } from "./mock-tauri";

test.beforeEach(async ({ page }) => {
  await installTauriMocks(page);
  await page.goto("/");
  await expect(page.getByTestId("app")).toBeVisible();
  await expect(page.getByTestId("composer-box")).toBeVisible();
  await expect(page.getByTestId("composer-plus")).toBeVisible();
  await expect(page.getByTestId("composer-permission")).toBeVisible();
});

test("chat shell stays aligned and inside the viewport", async ({ page }) => {
  const metrics = await assertNoOverflow(page);
  expect(metrics.sidebar?.width).toBeGreaterThan(200);
  expect(metrics.sidebar?.width).toBeLessThan(320);
  const newChat = page.getByTestId("nav-new");
  await expect(newChat).toHaveText(/新会话/);
  const bg = await newChat.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg === "rgba(0, 0, 0, 0)" || bg === "transparent").toBeTruthy();
  await expect(page.getByTestId("sidebar-toggle")).toBeVisible();
  await expect(page.getByText("项目", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "app", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fix login flow" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Claude Docker" })).toBeVisible();
  const group = page.locator(".session-group").first();
  const [folderBox, firstBox, secondBox] = await Promise.all([
    group.locator(".project-row").boundingBox(),
    group.locator(".session").nth(0).boundingBox(),
    group.locator(".session").nth(1).boundingBox(),
  ]);
  expect(folderBox && firstBox && secondBox).toBeTruthy();
  const folderToFirst = firstBox!.y - (folderBox!.y + folderBox!.height);
  const firstToSecond = secondBox!.y - (firstBox!.y + firstBox!.height);
  expect(folderToFirst).toBeGreaterThanOrEqual(3);
  expect(Math.abs(folderToFirst - firstToSecond)).toBeLessThan(1);
  const folderBg = await page.getByRole("button", { name: "app", exact: true }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(folderBg === "rgba(0, 0, 0, 0)" || folderBg === "transparent").toBeTruthy();
  await expect(page).toHaveScreenshot("chat-empty.png", { fullPage: false });
  await page.getByRole("button", { name: "app", exact: true }).click();
  await expect(page.getByRole("button", { name: "Fix login flow" })).toHaveCount(0);
  await page.getByRole("button", { name: "app", exact: true }).click();
  await expect(page.getByRole("button", { name: "Fix login flow" })).toBeVisible();
  await page.getByTestId("sidebar-toggle").click();
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  await page.getByTestId("sidebar-toggle").click();
  await expect(page.getByTestId("sidebar")).toBeVisible();
});

test("transcript keeps user bubbles and streams grok without boxes", async ({ page }) => {
  await page.getByRole("button", { name: /Fix login flow/ }).click();
  const transcript = page.getByTestId("chat-transcript");
  await expect(transcript).toBeVisible();
  await expect(page.getByTestId("thought-block")).toBeVisible();
  await expect(page.getByTestId("assistant-block")).toBeVisible();
  await expect(page.locator(".user-bubble")).toHaveCount(1);
  const [bubbleBox, transcriptBox] = await Promise.all([
    page.locator(".user-bubble").boundingBox(),
    transcript.boundingBox(),
  ]);
  expect(bubbleBox).toBeTruthy();
  expect(transcriptBox).toBeTruthy();
  expect(bubbleBox!.x).toBeGreaterThan(transcriptBox!.x + transcriptBox!.width * 0.2);
  expect(bubbleBox!.x + bubbleBox!.width).toBeGreaterThan(transcriptBox!.x + transcriptBox!.width * 0.7);
  await expect(page.locator(".code-block")).toBeVisible();
  await expect(page.locator(".code-lang")).toHaveText("ts");
  await expect(transcript.locator(".bubble")).toHaveCount(0);
  await expect(page.getByTestId("edit-diff")).toHaveCount(2);
  await expect(page.locator(".edit-src", { hasText: 'if (!user) throw new Error("missing user");' }).first()).toBeVisible();
  await expect(page.locator(".edit-line.add", { hasText: "toHaveCount(3)" })).toBeVisible();
  await expect(page.getByTestId("tool-block")).toHaveCount(4);
  await expect(page.locator(".spinner")).toHaveCount(0);
  await expect(page.locator(".tool-block.live")).toHaveCount(0);
  await assertNoOverflow(page);
  await expect(page).toHaveScreenshot("chat-transcript.png", { fullPage: false });
});

test("conversation search opens a centered palette", async ({ page }) => {
  await page.getByTestId("nav-search").click();
  const palette = page.getByTestId("search-palette");
  await expect(palette).toBeVisible();
  await expect(palette.getByText("搜索对话")).toBeVisible();
  await expect(palette.getByRole("button", { name: /Fix login flow/ })).toBeVisible();
  await expect(palette.getByText("打开项目")).toHaveCount(0);
  const [paletteBox, appBox] = await Promise.all([
    palette.boundingBox(),
    page.getByTestId("app").boundingBox(),
  ]);
  expect(paletteBox).toBeTruthy();
  expect(appBox).toBeTruthy();
  const paletteCenter = paletteBox!.x + paletteBox!.width / 2;
  const appCenter = appBox!.x + appBox!.width / 2;
  expect(Math.abs(paletteCenter - appCenter)).toBeLessThan(80);
  await assertNoOverflow(page);
  await expect(page).toHaveScreenshot("chat-search-palette.png", { fullPage: false });
});

test("composer shows a drop overlay for files", async ({ page }) => {
  const box = page.getByTestId("composer-box");
  await box.dispatchEvent("dragenter");
  await box.dispatchEvent("dragover");
  await expect(page.getByTestId("drop-overlay")).toBeVisible();
  await expect(page.getByTestId("drop-overlay")).toHaveText("松开以添加文件");
});

test("composer attaches a dropped file path", async ({ page }) => {
  await page.getByTestId("composer-box").evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/uri-list", "file:///Users/demo/photo.png");
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: data });
    el.dispatchEvent(event);
  });
  await expect(page.getByTestId("attach-row")).toBeVisible();
  await expect(page.getByText("photo.png")).toBeVisible();
  await expect(page.locator(".attach-kind")).toHaveText("IMG");
});

test("slash menu sits above the composer without overflowing", async ({ page }) => {
  await page.locator("textarea").fill("/");
  const menu = page.getByTestId("slash-menu");
  await expect(menu).toBeVisible();
  const [menuBox, composerBox] = await Promise.all([
    menu.boundingBox(),
    page.getByTestId("composer-box").boundingBox(),
  ]);
  expect(menuBox).toBeTruthy();
  expect(composerBox).toBeTruthy();
  const menuBottom = menuBox!.y + menuBox!.height;
  const menuRight = menuBox!.x + menuBox!.width;
  const boxRight = composerBox!.x + composerBox!.width;
  expect(menuBottom).toBeLessThanOrEqual(composerBox!.y + 1);
  expect(menuBox!.x).toBeGreaterThanOrEqual(composerBox!.x - 2);
  expect(menuRight).toBeLessThanOrEqual(boxRight + 2);
  await assertNoOverflow(page);
  await expect(page).toHaveScreenshot("chat-slash-menu.png", { fullPage: false });
});

test("settings page keeps fields inside the main column", async ({ page }) => {
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await expect(page.getByTestId("settings-account")).toBeVisible();
  await expect(page.getByTestId("settings-api")).toBeVisible();
  await expect(page.getByTestId("settings-agent")).toBeVisible();
  await expect(page.getByTestId("settings-locale")).toBeVisible();
  await expect(page.getByTestId("settings-engine")).toContainText("1.0.13");
  await expect(page.getByTestId("settings-save")).toBeVisible();
  const pageBox = await page.getByTestId("settings-page").boundingBox();
  const mainBox = await page.getByTestId("main").boundingBox();
  expect(pageBox).toBeTruthy();
  expect(mainBox).toBeTruthy();
  expect(pageBox!.x).toBeGreaterThanOrEqual(mainBox!.x - 1);
  expect(pageBox!.x + pageBox!.width).toBeLessThanOrEqual(mainBox!.x + mainBox!.width + 1);
  await assertNoOverflow(page);
  await expect(page).toHaveScreenshot("settings.png", { fullPage: false });
});

test("settings save bar stays on screen at a compact size", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("settings-page")).toBeVisible();
  const save = page.getByTestId("settings-save");
  await expect(save).toBeVisible();
  const box = await save.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(640 + 1);
  await assertNoOverflow(page);
  await expect(page).toHaveScreenshot("settings-narrow.png", { fullPage: false });
});

test("skills and plugins pages do not overflow", async ({ page }) => {
  await page.getByTestId("nav-skills").click();
  await expect(page.getByTestId("skills-page")).toBeVisible();
  await assertNoOverflow(page);
  await expect(page).toHaveScreenshot("skills.png", { fullPage: false });

  await page.getByTestId("nav-plugins").click();
  await expect(page.getByTestId("plugins-page")).toBeVisible();
  await assertNoOverflow(page);
  await expect(page).toHaveScreenshot("plugins.png", { fullPage: false });
});
