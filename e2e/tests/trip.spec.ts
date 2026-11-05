import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers.ts";

/**
 * The whole story, with two people in two separate browsers (separate
 * cookies), exactly as they'd use it: create a group, invite, accept, add an
 * expense, see who owes whom, pay, and end up settled.
 */
test("two friends split a hotel and settle up", async ({ browser }) => {
  const anaEmail = uniqueEmail("ana");
  const benEmail = uniqueEmail("ben");
  const ana = await (await browser.newContext()).newPage();
  const ben = await (await browser.newContext()).newPage();

  await test.step("Ana signs up, creates a group and invites Ben", async () => {
    await signUp(ana, "Ana", anaEmail);
    await ana.getByLabel("Group name").fill("Baguio trip");
    await ana.getByRole("button", { name: "Create group" }).click();
    await expect(ana.getByRole("heading", { name: "Baguio trip", level: 1 })).toBeVisible();

    await ana.getByLabel("Their email").fill(benEmail);
    await ana.getByRole("button", { name: "Send invite" }).click();
    await expect(ana.getByText(`Invitation sent to ${benEmail}`)).toBeVisible();
    await expect(ana.getByRole("button", { name: `Cancel invitation for ${benEmail}` })).toBeVisible();
  });

  await test.step("Ben signs up after being invited and accepts", async () => {
    await signUp(ben, "Ben", benEmail);
    const invitations = ben.getByRole("region", { name: "Invitations" });
    await expect(invitations).toContainText("Ana invited you to Baguio trip");
    await invitations.getByRole("button", { name: "Accept" }).click();

    await expect(ben.getByRole("heading", { name: "Baguio trip", level: 1 })).toBeVisible();
    await expect(ben.getByRole("region", { name: "Members (2)" })).toBeVisible();
  });

  await test.step("Ana adds the hotel, split equally", async () => {
    await ana.reload();
    await ana.getByLabel("Description").fill("Hotel");
    await ana.getByLabel("Amount (₱)").fill("9,000");
    await expect(ana.getByText("₱4,500.00")).toHaveCount(2);
    await ana.getByRole("button", { name: "Add expense" }).click();

    const expenses = ana.getByRole("region", { name: "Expenses" });
    await expect(expenses.getByRole("heading", { name: "Hotel" })).toBeVisible();
    await expect(expenses).toContainText("₱9,000.00");
    await expect(ana.getByRole("region", { name: "Balances" })).toContainText("gets back ₱4,500.00");
  });

  await test.step("Ben sees he owes Ana and marks it as paid", async () => {
    await ben.reload();
    const whoPaysWhom = ben.getByRole("region", { name: "Who pays whom" });
    await expect(whoPaysWhom).toContainText("You pay Ana ₱4,500.00");

    await whoPaysWhom.getByRole("button", { name: "Mark as paid" }).click();
    await whoPaysWhom.getByRole("button", { name: "Yes, I've paid" }).click();

    await expect(whoPaysWhom).toContainText("Everyone is settled up.");
    await expect(ben.getByRole("region", { name: "Payments" })).toContainText("You paid Ana");
  });

  await test.step("Ana sees everyone is settled and the payment", async () => {
    await ana.reload();
    await expect(ana.getByRole("region", { name: "Who pays whom" })).toContainText("Everyone is settled up.");
    await expect(ana.getByRole("region", { name: "Payments" })).toContainText("Ben paid you");
    await expect(ana.getByRole("region", { name: "Payments" })).toContainText("₱4,500.00");
  });

  await test.step("Ben, now settled, can leave the group", async () => {
    await ben.getByRole("button", { name: "Leave group" }).click();
    await ben.getByRole("button", { name: "Yes, leave group" }).click();
    await expect(ben.getByText(/No groups yet/)).toBeVisible();
  });
});
