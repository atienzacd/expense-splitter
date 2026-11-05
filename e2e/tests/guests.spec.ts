import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers.ts";

/**
 * Only Ana has an account. She adds two relatives by name, records what one of
 * them paid for, and records the payments that settle everyone up.
 */
test("one person keeps the books for friends without accounts", async ({ page }) => {
  await signUp(page, "Ana", uniqueEmail("ana"));
  await page.getByLabel("Group name").fill("Family reunion");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { name: "Family reunion", level: 1 })).toBeVisible();

  await test.step("Ana adds Lola and Tito by name", async () => {
    for (const name of ["Lola", "Tito"]) {
      await page.getByLabel("Their name").fill(name);
      await page.getByRole("button", { name: "Add to group" }).click();
      await expect(page.getByText(`${name} was added to the group.`)).toBeVisible();
    }
    const members = page.getByRole("region", { name: "Members (3)" });
    await expect(members.getByText("Guest")).toHaveCount(2);
  });

  await test.step("Lola paid for the lechon, split three ways", async () => {
    await page.getByLabel("Description").fill("Lechon");
    await page.getByLabel("Amount (₱)").fill("3,000");
    await page.getByLabel("Paid by").selectOption({ label: "Lola" });
    await page.getByRole("button", { name: "Add expense" }).click();

    const whoPaysWhom = page.getByRole("region", { name: "Who pays whom" });
    await expect(whoPaysWhom).toContainText("Tito pays Lola ₱1,000.00");
    await expect(whoPaysWhom).toContainText("You pay Lola ₱1,000.00");
  });

  await test.step("Ana records Tito's payment and her own", async () => {
    const whoPaysWhom = page.getByRole("region", { name: "Who pays whom" });
    const tito = whoPaysWhom.getByRole("listitem").filter({ hasText: "Tito pays Lola" });
    await tito.getByRole("button", { name: "Mark as paid" }).click();
    await tito.getByRole("button", { name: "Yes, it's paid" }).click();
    await expect(whoPaysWhom).not.toContainText("Tito pays Lola");

    await whoPaysWhom.getByRole("button", { name: "Mark as paid" }).click();
    await whoPaysWhom.getByRole("button", { name: "Yes, I've paid" }).click();
    await expect(whoPaysWhom).toContainText("Everyone is settled up.");

    const payments = page.getByRole("region", { name: "Payments" });
    await expect(payments).toContainText("Tito paid Lola");
    await expect(payments).toContainText("You paid Lola");
  });

  await test.step("a settled-up guest can be removed", async () => {
    await page.getByRole("button", { name: "Remove Tito" }).click();
    await expect(page.getByRole("region", { name: "Members (2)" })).toBeVisible();
  });
});
