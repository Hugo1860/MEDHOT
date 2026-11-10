// Failure mode: WeChat's in-app browser cannot save downloads, so the article offers "复制 Markdown" there
// instead; it copied with the async clipboard, which that browser does not have, and always failed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium, expect, webkit } from "@playwright/test";
import { SITE } from "@aihot/site";
import { fakeApi, itemDetail, startWebServer, visit, type WebServer } from "./web-server.ts";

const markdown = "# 复制检查\n\n固定正文";
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3MxZ5wAAAABJRU5ErkJggg==", "base64");

test("article actions support keyboard navigation and return focus on Escape", async () => {
  const api = fakeApi((url, res) => {
    if (url.pathname === "/api/site/items/keyboard-menu") return itemDetail({ id: "keyboard-menu", title: "键盘菜单检查" });
    if (url.pathname === "/items/keyboard-menu/markdown") {
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      return res.end(markdown);
    }
  });
  const browser = await chromium.launch({ channel: "chromium" });
  let web: WebServer | undefined;
  try {
    web = await startWebServer(api);
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await visit(page, web.origin + "/items/keyboard-menu");
    const trigger = page.getByRole("button", { name: "更多操作", exact: true }).filter({ visible: true });
    const first = page.getByRole("menuitem", { name: "分享链接", exact: true });
    const second = page.getByRole("menuitem", { name: "生成分享海报", exact: true });
    const last = page.getByRole("menuitem", { name: "导出 Markdown", exact: true });
    await trigger.press("Enter");
    await expect(first).toBeFocused();
    await first.press("ArrowDown");
    await expect(second).toBeFocused();
    await second.press("End");
    await expect(last).toBeFocused();
    await last.press("ArrowDown");
    await expect(first).toBeFocused();
    await first.press("ArrowUp");
    await expect(last).toBeFocused();
    await last.press("Home");
    await expect(first).toBeFocused();
    await first.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press("ArrowUp");
    await expect(last).toBeFocused();
    await last.press("Shift+Tab");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press("Space");
    await expect(first).toBeFocused();
    await first.press("Tab");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(trigger).not.toBeFocused();
    await trigger.click();
    await expect(first).toBeFocused();
    await page.getByRole("heading", { name: "键盘菜单检查", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await trigger.press("ArrowDown");
    await expect(first).toBeFocused();
    await first.press("ArrowUp");
    await expect(last).toBeFocused();
    const download = page.waitForEvent("download");
    await last.press("Enter");
    assert.equal(await readFile((await (await download).path())!, "utf8"), markdown);
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await first.press("ArrowDown");
    await second.press("Enter");
    const poster = page.getByRole("dialog", { name: "分享海报", exact: true });
    await expect(poster).toBeVisible();
    await poster.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(poster).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } finally {
    await browser.close();
    await web?.stop();
  }
});

test("phone share opens an immersive poster with useful and honest actions", async () => {
  const api = fakeApi((url, res) => {
    if (url.pathname === "/api/site/items/mobile-share") return itemDetail({ id: "mobile-share", title: "移动端分享检查" });
    if (url.pathname === "/og/posters/mobile-share.png") {
      res.setHeader("Content-Type", "image/png");
      return res.end(tinyPng);
    }
  });
  const browser = await chromium.launch({ channel: "chromium" });
  let web: WebServer | undefined;
  try {
    web = await startWebServer(api);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: ShareData) => { (window as typeof window & { __sharedData?: ShareData }).__sharedData = data; },
      });
    });
    await visit(page, web.origin + "/items/mobile-share");
    await page.getByRole("button", { name: "分享", exact: true }).click();
    const poster = page.getByRole("dialog", { name: "分享海报", exact: true });
    await expect(poster).toBeVisible();
    await expect(poster.getByRole("img", { name: "移动端分享检查 · 分享海报", exact: true })).toBeVisible();
    await expect(poster.getByRole("button", { name: "发给朋友", exact: true })).toBeVisible();
    await expect(poster.getByRole("button", { name: "朋友圈", exact: true })).toBeVisible();
    await expect(poster.getByRole("button", { name: "收藏", exact: true })).toBeVisible();
    const save = poster.getByRole("link", { name: "保存图片", exact: true });
    await expect(save).toBeVisible();
    await expect(save).toHaveAttribute("href", "/og/posters/mobile-share.png?download=1");
    await expect(poster.getByRole("button", { name: "复制链接", exact: true })).toBeVisible();

    await poster.getByRole("button", { name: "发给朋友", exact: true }).click();
    const shared = await page.evaluate(() => (window as typeof window & { __sharedData?: ShareData }).__sharedData);
    assert.deepEqual(shared, {
      title: "移动端分享检查",
      text: "医护知新：移动端分享检查",
      url: `${web.origin}/items/mobile-share`,
    });
    assert.equal("files" in shared!, false);
    await expect(poster.getByRole("status")).toHaveText("已调起系统分享，请在微信中选择好友");

    await poster.getByRole("button", { name: "朋友圈", exact: true }).click();
    await expect(poster.getByRole("status")).toHaveText("请长按海报保存，再从朋友圈选择图片发布");
    await poster.getByRole("button", { name: "收藏", exact: true }).click();
    await expect(poster.getByRole("button", { name: "已收藏", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(poster.getByRole("status")).toHaveText("已收藏到本机");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await poster.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(poster).toHaveCount(0);
  } finally {
    await browser.close();
    await web?.stop();
  }
});

test("WeChat friend sharing uses the native menu guidance instead of an unsupported file share", async () => {
  const api = fakeApi((url, res) => {
    if (url.pathname === "/api/site/items/wechat-share") return itemDetail({ id: "wechat-share", title: "微信分享检查" });
    if (url.pathname === "/og/posters/wechat-share.png") {
      res.setHeader("Content-Type", "image/png");
      return res.end(tinyPng);
    }
  });
  const browser = await chromium.launch({ channel: "chromium" });
  let web: WebServer | undefined;
  try {
    web = await startWebServer(api);
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.50",
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async () => { (window as typeof window & { __shareCalled?: boolean }).__shareCalled = true; },
      });
    });
    await visit(page, `${web.origin}/items/wechat-share`);
    await page.getByRole("button", { name: "分享", exact: true }).click();
    const poster = page.getByRole("dialog", { name: "分享海报", exact: true });
    await poster.getByRole("button", { name: "发给朋友", exact: true }).click();
    await expect(poster.getByRole("status")).toHaveText("请点击右上角 ···，选择“发送给朋友”");
    assert.equal(await page.evaluate(() => (window as typeof window & { __shareCalled?: boolean }).__shareCalled ?? false), false);
    await poster.getByRole("button", { name: "长按保存", exact: true }).click();
    await expect(poster.getByText("长按海报，选择“保存图片”", { exact: true }).first()).toBeVisible();
    await expect(poster.getByRole("status")).toContainText("请长按上方海报，选择“保存图片”");
    await expect(poster.getByRole("link", { name: "打开原图", exact: true })).toHaveAttribute("href", "/og/posters/wechat-share.png");
  } finally {
    await browser.close();
    await web?.stop();
  }
});

test("iPhone save hands the poster file to the system image actions", async () => {
  const api = fakeApi((url, res) => {
    if (url.pathname === "/api/site/items/iphone-save") return itemDetail({ id: "iphone-save", title: "iPhone保存检查" });
    if (url.pathname === "/og/posters/iphone-save.png") {
      res.setHeader("Content-Type", "image/png");
      return res.end(tinyPng);
    }
  });
  const browser = await chromium.launch({ channel: "chromium" });
  let web: WebServer | undefined;
  try {
    web = await startWebServer(api);
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: ShareData) => {
          const file = data.files?.[0];
          (window as typeof window & { __savedPoster?: unknown }).__savedPoster = file && { name: file.name, type: file.type, size: file.size };
        },
      });
    });
    await visit(page, `${web.origin}/items/iphone-save`);
    await page.getByRole("button", { name: "分享", exact: true }).click();
    const poster = page.getByRole("dialog", { name: "分享海报", exact: true });
    await poster.getByRole("button", { name: "保存图片", exact: true }).click();
    await expect(poster.getByRole("status")).toHaveText("请在系统菜单中选择“存储图像”");
    assert.deepEqual(await page.evaluate(() => (window as typeof window & { __savedPoster?: unknown }).__savedPoster), {
      name: `${SITE.mcpPrefix}-iphone-save.png`,
      type: "image/png",
      size: tinyPng.length,
    });
  } finally {
    await browser.close();
    await web?.stop();
  }
});

// Safari does not focus a button when it is pressed, so pressing the open menu's trigger takes focus to nothing.
test("in Safari, pressing the trigger of an open menu closes it", async () => {
  const api = fakeApi((url) => {
    if (url.pathname === "/api/site/items/safari-menu") return itemDetail({ id: "safari-menu", title: "菜单检查" });
  });
  const browser = await webkit.launch();
  let web: WebServer | undefined;
  try {
    web = await startWebServer(api);
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await visit(page, web.origin + "/items/safari-menu");
    const trigger = page.getByRole("button", { name: "更多操作", exact: true }).filter({ visible: true });
    await trigger.click();
    await expect(page.getByRole("menuitem", { name: "分享链接", exact: true })).toBeFocused();
    await trigger.click();
    await expect(page.getByRole("menu")).toHaveCount(0);
  } finally {
    await browser.close();
    await web?.stop();
  }
});

test("in WeChat, 复制 Markdown copies the article without the async clipboard", async () => {
  const api = fakeApi((url, res) => {
    if (url.pathname === "/api/site/items/wechat-copy") return itemDetail({ id: "wechat-copy", title: "复制检查" });
    if (url.pathname === "/items/wechat-copy/markdown") {
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      return res.end(markdown);
    }
  });
  const browser = await chromium.launch({ channel: "chromium" });
  let web: WebServer | undefined;
  try {
    web = await startWebServer(api);
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50",
    });
    // As in WeChat: no async clipboard; a selection copy works, and what it copied is kept for the test.
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "clipboard", { get: () => undefined });
      document.execCommand = (command: string) => {
        if (command !== "copy") return false;
        (window as { copied?: string }).copied = (document.activeElement as HTMLTextAreaElement | null)?.value;
        return true;
      };
    });
    const page = await context.newPage();
    await visit(page, web.origin + "/items/wechat-copy");
    await page.getByRole("button", { name: "更多操作" }).filter({ visible: true }).click();
    await page.getByRole("menuitem", { name: "复制 Markdown" }).click();
    await expect(page.getByRole("status")).toHaveText("Markdown 已复制");
    assert.equal(await page.evaluate(() => (window as { copied?: string }).copied), markdown);
  } finally {
    await browser.close();
    await web?.stop();
  }
});
