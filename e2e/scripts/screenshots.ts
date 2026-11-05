/**
 * Regenerates the README screenshots in docs/screenshots/.
 *
 *   JWT_SECRET=... docker compose up -d --build --wait    (or run the dev servers)
 *   node e2e/scripts/screenshots.ts [base URL, default http://localhost:8080]
 *
 * It signs up three demo people with addresses on example.com, so it is safe
 * to run against a local copy only. Delete them afterwards with:
 *   DELETE FROM users WHERE email LIKE 'readme-%@example.com';
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:8080";
const OUT = fileURLToPath(new URL("../../docs/screenshots/", import.meta.url));
const PASSWORD = "readme-demo-password";

type Person = { name: string; email: string };
const ana: Person = { name: "Ana Santos", email: "readme-ana@example.com" };
const ben: Person = { name: "Ben Cruz", email: "readme-ben@example.com" };
const cara: Person = { name: "Cara Reyes", email: "readme-cara@example.com" };

async function api(request: APIRequestContext, method: "GET" | "POST", path: string, data?: unknown) {
  const response = await request.fetch(`${BASE}/api${path}`, { method, data });
  if (!response.ok()) throw new Error(`${method} ${path} → ${response.status()} ${await response.text()}`);
  return response.status() === 204 ? undefined : response.json();
}

type Session = Awaited<ReturnType<BrowserContext["storageState"]>>;

/** Signs `person` up once and keeps their login cookies, so screenshots don't log in again (login is rate limited). */
async function signUp(browser: Browser, person: Person): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE });
  await api(context.request, "POST", "/auth/register", { ...person, password: PASSWORD });
  return context;
}

/** A browser window using an existing login, with the chosen theme and screen size. */
async function window(browser: Browser, session: Session, colorScheme: "light" | "dark", mobile = false) {
  const context = await browser.newContext({
    baseURL: BASE,
    storageState: session,
    colorScheme,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 },
    deviceScaleFactor: mobile ? 2 : 1,
  });
  return context.newPage();
}

async function setUpTrip(browser: Browser): Promise<{ groupId: string; sessions: Record<string, Session> }> {
  const [a, b, c] = await Promise.all([ana, ben, cara].map((p) => signUp(browser, p)));
  const ids = await Promise.all([a, b, c].map(async (ctx) => (await api(ctx!.request, "GET", "/auth/me")).user.id));
  const [anaId, benId, caraId] = ids as [string, string, string];

  const { group } = await api(a!.request, "POST", "/groups", { name: "Baguio trip" });
  for (const person of [ben, cara]) await api(a!.request, "POST", `/groups/${group.id}/invitations`, { email: person.email });
  for (const ctx of [b!, c!]) {
    const { invitations } = await api(ctx.request, "GET", "/invitations");
    await api(ctx.request, "POST", `/invitations/${invitations[0].id}/accept`);
  }

  await api(a!.request, "POST", `/groups/${group.id}/expenses`, { description: "Hotel (2 nights)", amount: 900_000, split: { type: "EQUAL" } });
  await api(b!.request, "POST", `/groups/${group.id}/expenses`, { description: "Strawberry taho", amount: 15_000, split: { type: "EQUAL" } });
  await api(c!.request, "POST", `/groups/${group.id}/expenses`, {
    description: "Gas and toll",
    amount: 240_000,
    split: { type: "PERCENTAGE", shares: [{ userId: anaId, percent: 50 }, { userId: benId, percent: 25 }, { userId: caraId, percent: 25 }] },
  });
  await api(c!.request, "POST", `/groups/${group.id}/settlements`, { toUserId: anaId, amount: 50_000 });

  // A second group where Ana has a pending invitation, so the groups page shows one.
  const { group: office } = await api(b!.request, "POST", "/groups", { name: "Office lunches" });
  await api(b!.request, "POST", `/groups/${office.id}/invitations`, { email: ana.email });
  await api(a!.request, "POST", "/groups", { name: "Condo utilities" });

  const sessions = {
    ana: await a!.storageState(),
    ben: await b!.storageState(),
    cara: await c!.storageState(),
  };
  await Promise.all([a, b, c].map((ctx) => ctx!.close()));
  return { groupId: group.id as string, sessions };
}

async function shoot(page: Page, file: string, fullPage = false) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: join(OUT, file), fullPage, animations: "disabled" });
  console.log(`saved docs/screenshots/${file}`);
}

const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });
const { groupId, sessions } = await setUpTrip(browser);

// 1. Groups page (light): invitation, new group form, group cards.
{
  const page = await window(browser, sessions.ana!, "light");
  await page.goto("/groups");
  await page.getByRole("region", { name: "Invitations" }).waitFor();
  await shoot(page, "groups-light.png");
}

// 2. Group page (dark), from Ben's side: balances, who pays whom with Mark as paid.
{
  const page = await window(browser, sessions.ben!, "dark");
  await page.goto(`/groups/${groupId}`);
  await page.getByRole("region", { name: "Who pays whom" }).waitFor();
  await shoot(page, "balances-dark.png");
}

// 3. Adding an expense by percentage (light), with the live "Adds up to 100%".
{
  const page = await window(browser, sessions.ana!, "light");
  await page.goto(`/groups/${groupId}`);
  const form = page.getByRole("region", { name: "Add an expense" });
  await form.getByLabel("Description").fill("Dinner at Café by the Ruins");
  await form.getByLabel("Amount (₱)").fill("1,800");
  await form.getByText("Percentages").click();
  await form.getByLabel("Percentage for Ana Santos").fill("40");
  await form.getByLabel("Percentage for Ben Cruz").fill("30");
  await form.getByLabel("Percentage for Cara Reyes").fill("30");
  await form.getByText("Adds up to 100%.").waitFor();
  await form.screenshot({ path: join(OUT, "add-expense-light.png"), animations: "disabled" });
  console.log("saved docs/screenshots/add-expense-light.png");
}

// 4. The same group on a phone (dark), from Cara's side: header, balances and her payment.
{
  const page = await window(browser, sessions.cara!, "dark", true);
  await page.goto(`/groups/${groupId}`);
  await page.getByRole("region", { name: "Who pays whom" }).waitFor();
  await shoot(page, "mobile-dark.png");
}

await browser.close();
