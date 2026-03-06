import { expect, test } from "@playwright/test";

const TEST_TENANT_ID = "test-brf";

function visibleByTestId(page, testId) {
  return page.locator(`[data-testid="${testId}"]:visible`).first();
}

function bookingUrl(mode) {
  return `/?mode=${mode}&brf=${TEST_TENANT_ID}`;
}

async function resetMocks(page) {
  await page.goto(bookingUrl("desktop"));
  await page.evaluate(async () => {
    const mockApi = await import("/src/mockApi.js");
    mockApi.resetMockState();
  });
}

test("POS-login kan ändra mobil-lösenord", async ({ page }) => {
  await resetMocks(page);
  await page.goto(bookingUrl("pos"));

  await expect(page.locator("p:visible", { hasText: "Visa bricka" })).toBeVisible();
  await page.keyboard.type("UID123");
  await page.keyboard.press("Enter");

  await expect(visibleByTestId(page, "booking-setup")).toBeVisible();
  await expect(visibleByTestId(page, "password-change-toggle")).toBeVisible();

  await visibleByTestId(page, "password-change-toggle").click();
  await visibleByTestId(page, "password-change-new").fill("test1234");
  await visibleByTestId(page, "password-change-confirm").fill("test1234");
  await visibleByTestId(page, "password-change-submit").click();
  await expect(visibleByTestId(page, "password-change-success")).toContainText("uppdaterat");
  await expect(visibleByTestId(page, "logout")).toBeVisible();
});

test("Desktop-login fungerar", async ({ page }) => {
  await resetMocks(page);
  await page.goto(bookingUrl("desktop"));
  await visibleByTestId(page, "login-userid").fill("1001");
  await visibleByTestId(page, "login-password").fill("1234");
  await visibleByTestId(page, "desktop-login").click();
  await expect(visibleByTestId(page, "booking-setup")).toBeVisible();
  await visibleByTestId(page, "resource-card").click();
  await expect(visibleByTestId(page, "schedule-view")).toBeVisible();
  await expect(visibleByTestId(page, "selected-booking-object-title")).toContainText(
    "Bokningsobjekt"
  );
});

test("Boka och avboka", async ({ page }) => {
  await resetMocks(page);
  await page.goto(bookingUrl("desktop"));
  await visibleByTestId(page, "login-userid").fill("1001");
  await visibleByTestId(page, "login-password").fill("1234");
  await visibleByTestId(page, "desktop-login").click();
  await visibleByTestId(page, "resource-card").click();
  await expect(visibleByTestId(page, "schedule-view")).toBeVisible();

  const bookButton = page.locator('[data-testid="book-slot"]:not([disabled])').first();
  await bookButton.click();
  await expect(visibleByTestId(page, "confirm-modal")).toBeVisible();
  await visibleByTestId(page, "confirm-ok").click();

  await visibleByTestId(page, "step-back").click();
  await expect(visibleByTestId(page, "booking-setup")).toBeVisible();
  await expect(visibleByTestId(page, "booking-list")).toContainText("Tvättstuga");

  await visibleByTestId(page, "cancel-booking").click();
  await visibleByTestId(page, "confirm-ok").click();
  await expect(page.locator('[data-testid="confirm-modal"]:visible')).toHaveCount(0);
});
