import type { Server } from "node:http";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { app, store } from "../../src/mock-app/server.js";

export interface TestApp {
  baseUrl: string;
  server: Server;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  loginAndGoto(path: string): Promise<void>;
}

export async function startTestApp(port: number): Promise<TestApp> {
  store.reset();
  const server = app.listen(port);
  const baseUrl = `http://localhost:${port}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  return {
    baseUrl,
    server,
    browser,
    context,
    page,
    async loginAndGoto(path: string) {
      await page.goto(`${baseUrl}/login`);
      await page.getByLabel("Username").fill("tester");
      await page.getByLabel("Password").fill("demo");
      await page.getByRole("button", { name: "Sign in" }).click();
      if (path !== "/search") {
        await page.goto(`${baseUrl}${path}`);
      }
    },
  };
}

export async function stopTestApp(t: TestApp): Promise<void> {
  await t.context.close();
  await t.browser.close();
  await new Promise<void>((resolve) => t.server.close(() => resolve()));
}
