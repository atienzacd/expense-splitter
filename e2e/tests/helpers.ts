import { expect, type Page } from "@playwright/test";

export const PASSWORD = "e2e-password-123";

/** A fresh email for every run, so tests never collide with earlier data. */
export function uniqueEmail(name: string): string {
  return `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Signs up through the real sign-up page and waits for the groups page. */
export async function signUp(page: Page, name: string, email: string): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your groups" })).toBeVisible();
}
