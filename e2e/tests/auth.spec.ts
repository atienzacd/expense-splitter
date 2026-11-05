import { expect, test } from "@playwright/test";
import { PASSWORD, signUp, uniqueEmail } from "./helpers.ts";

test("protected pages send you to log in, then back", async ({ page }) => {
  const email = uniqueEmail("visitor");
  // Create the account, then log out, so we start as a visitor with an account.
  await signUp(page, "Visitor", email);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Log in" })).toBeVisible();

  await page.goto("/groups");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Email or password is incorrect.");

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByRole("heading", { name: "Your groups" })).toBeVisible();
});

test("login lives in cookies that page scripts can't read", async ({ page, context }) => {
  await signUp(page, "Cookie", uniqueEmail("cookie"));

  const cookies = await context.cookies();
  const access = cookies.find((c) => c.name === "access_token");
  const refresh = cookies.find((c) => c.name === "refresh_token");
  expect(access).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/api" });
  expect(refresh).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/api/auth" });

  // An injected script (XSS) would see nothing.
  expect(await page.evaluate(() => document.cookie)).toBe("");
});

test("logging out ends the session on the server, not just in the browser", async ({ page, context }) => {
  await signUp(page, "Leaver", uniqueEmail("leaver"));
  const before = await context.cookies();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/$/);

  // Put the old cookies back, as an attacker who copied them would.
  await context.addCookies(before);
  await page.goto("/groups");
  await expect(page).toHaveURL(/\/login$/);
});
