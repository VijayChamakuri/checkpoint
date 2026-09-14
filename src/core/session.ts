import type { Page } from "playwright";

/**
 * Session establishment is common to every capability, so it happens once,
 * outside the recorded artifact -- capabilities start from an authenticated
 * state (target.entryUrl), not from the login form.
 */
export async function establishSession(
  page: Page,
  baseUrl: string,
  username = "demo-operator",
  password = "demo",
): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
