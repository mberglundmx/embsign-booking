import { expect, test } from "@playwright/test";

test("POS-login visar bokningar", async ({ page }) => {
  await page.goto("/?mode=pos");
  await page.getByTestId("pos-login").click();
  await expect(page.getByTestId("booking-list")).toBeVisible();
  await expect(page.getByTestId("logout")).toBeVisible();
});

test("Desktop-login fungerar", async ({ page }) => {
  await page.goto("/?mode=desktop");
  await page.getByTestId("login-userid").fill("1001");
  await page.getByTestId("login-password").fill("1234");
  await page.getByTestId("desktop-login").click();
  await expect(page.getByTestId("booking-list")).toBeVisible();
});

test("Boka och avboka", async ({ page }) => {
  await page.goto("/?mode=desktop");
  await page.getByTestId("login-userid").fill("1001");
  await page.getByTestId("login-password").fill("1234");
  await page.getByTestId("desktop-login").click();

  const bookButton = page.locator('[data-testid="book-slot"]:not([disabled])').first();
  await bookButton.click();
  await expect(page.getByTestId("confirm-modal")).toBeVisible();
  await page.getByTestId("confirm-ok").click();

  await expect(page.getByTestId("booking-list")).toContainText("Tvättstuga");

  await page.getByTestId("cancel-booking").first().click();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("confirm-modal")).toBeHidden();
});
