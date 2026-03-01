import { expect, test } from "@playwright/test";

async function resetMocks(page) {
  await page.goto("/?mode=desktop");
  await page.evaluate(async () => {
    const mockApi = await import("/src/mockApi.js");
    mockApi.resetMockState();
  });
}

test("POS-login kan ändra mobil-lösenord", async ({ page }) => {
  await resetMocks(page);
  await page.goto("/?mode=pos");

  await expect(page.getByText("Visa bricka")).toBeVisible();
  await page.keyboard.type("UID123");
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("booking-setup")).toBeVisible();
  await expect(page.getByTestId("password-change-toggle")).toBeVisible();

  await page.getByTestId("password-change-toggle").click();
  await page.getByTestId("password-change-new").fill("test1234");
  await page.getByTestId("password-change-confirm").fill("test1234");
  await page.getByTestId("password-change-submit").click();
  await expect(page.getByTestId("password-change-success")).toContainText("uppdaterat");
  await expect(page.getByTestId("logout")).toBeVisible();
});

test("Desktop-login fungerar", async ({ page }) => {
  await resetMocks(page);
  await page.goto("/?mode=desktop");
  await page.getByTestId("login-userid").fill("1001");
  await page.getByTestId("login-password").fill("1234");
  await page.getByTestId("desktop-login").click();
  await expect(page.getByTestId("booking-setup")).toBeVisible();
  await page.getByTestId("resource-card").first().click();
  await expect(page.getByTestId("schedule-view")).toBeVisible();
  await expect(page.getByTestId("selected-booking-object-title")).toContainText("Bokningsobjekt");
});

test("Boka och avboka", async ({ page }) => {
  await resetMocks(page);
  await page.goto("/?mode=desktop");
  await page.getByTestId("login-userid").fill("1001");
  await page.getByTestId("login-password").fill("1234");
  await page.getByTestId("desktop-login").click();
  await page.getByTestId("resource-card").first().click();
  await expect(page.getByTestId("schedule-view")).toBeVisible();

  const bookButton = page.locator('[data-testid="book-slot"]:not([disabled])').first();
  await bookButton.click();
  await expect(page.getByTestId("confirm-modal")).toBeVisible();
  await page.getByTestId("confirm-ok").click();

  await expect(page.getByTestId("booking-list")).toContainText("Tvättstuga");
  await page.getByTestId("booking-list").locator("summary").click();

  await page.getByTestId("cancel-booking").first().click();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("confirm-modal")).toBeHidden();
});
