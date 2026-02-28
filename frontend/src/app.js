import Alpine from "alpinejs";

const DEFAULT_MODE = "desktop";
const FULL_DAY_COUNT = 30;
const TIME_SLOT_DAYS_VISIBLE = 4;
const WEEKDAY_LABELS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const DEMO_RFID_UID = import.meta.env.VITE_RFID_UID || "UID123";
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";

let apiPromise = null;

async function getApi() {
  if (!apiPromise) {
    apiPromise = USE_MOCKS ? import("./mockApi") : import("./api");
  }
  return apiPromise;
}

function detectMode() {
  const params = new URLSearchParams(window.location.search);
  const modeParam = params.get("mode");
  if (modeParam === "pos" || modeParam === "desktop") {
    return modeParam;
  }
  return localStorage.getItem("booking-mode") || DEFAULT_MODE;
}

function persistMode(mode) {
  localStorage.setItem("booking-mode", mode);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getDateString(date) {
  return date.toISOString().slice(0, 10);
}

function getUpcomingDays(count) {
  const today = new Date();
  return Array.from({ length: count }, (_, index) => getDateString(addDays(today, index)));
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("sv-SE", {
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(date);
}

function formatDateLong(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(date);
}

function formatTimeRange(startIso, endIso) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit"
  });
  return `${formatter.format(new Date(startIso))}-${formatter.format(new Date(endIso))}`;
}

function normalizeResources(resources) {
  return resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    bookingType: resource.booking_type ?? resource.bookingType ?? "time-slot",
    maxAdvanceDays:
      typeof resource.max_future_days === "number"
        ? resource.max_future_days
        : resource.maxAdvanceDays ?? FULL_DAY_COUNT,
    price:
      typeof resource.price_cents === "number"
        ? Math.round(resource.price_cents / 100)
        : resource.price ?? 0,
    isBillable: resource.is_billable ?? resource.isBillable ?? false
  }));
}

function normalizeBookings(bookings) {
  return bookings.map((booking) => {
    if (booking.resourceName) {
      return booking;
    }
    const date = booking.start_time.split("T")[0];
    const bookingType = booking.booking_type ?? "time-slot";
    const slotLabel =
      bookingType === "time-slot" ? formatTimeRange(booking.start_time, booking.end_time) : null;
    return {
      id: booking.id,
      resourceId: booking.resource_id,
      resourceName: booking.resource_name,
      date,
      slotLabel,
      bookingType,
      price:
        typeof booking.price_cents === "number"
          ? Math.round(booking.price_cents / 100)
          : 0
    };
  });
}

function normalizeSlots(slots) {
  return slots.map((slot) => {
    if (slot.start_time) {
      const label = formatTimeRange(slot.start_time, slot.end_time);
      return {
        id: label,
        label,
        startTime: slot.start_time,
        endTime: slot.end_time,
        isBooked: Boolean(slot.is_booked),
        isPast: Boolean(slot.is_past)
      };
    }
    return slot;
  });
}

function getDayWindow(dateString) {
  const start = new Date(`${dateString}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

Alpine.data("bookingApp", () => ({
  mode: DEFAULT_MODE,
  isAuthenticated: false,
  userId: null,
  userIdInput: "",
  passwordInput: "",
  rfidInput: "",
  rfidBuffer: "",
  rfidListenerBound: false,
  resources: [],
  bookings: [],
  days: [],
  selectedResourceId: null,
  timeSlotStartIndex: 0,
  slotsByDate: {},
  fullDayAvailability: {},
  loading: false,
  availabilityLoading: false,
  availabilityRequestToken: 0,
  errorMessage: "",
  confirm: {
    open: false,
    action: null,
    payload: null,
    title: "",
    message: "",
    price: 0
  },
  errorTimeoutId: null,

  async init() {
    this.mode = detectMode();
    persistMode(this.mode);
    this.days = getUpcomingDays(FULL_DAY_COUNT);
    this.bindRfidListener();
    if (!USE_MOCKS) {
      const api = await getApi();
      api.logBackendStatus?.();
    }
  },

  get selectedResource() {
    return this.resources.find((resource) => resource.id === this.selectedResourceId);
  },

  getMaxAdvanceDays() {
    return this.selectedResource?.maxAdvanceDays ?? FULL_DAY_COUNT;
  },

  get isPosMode() {
    return this.mode === "pos";
  },

  get timeSlotDays() {
    return this.days.slice(
      this.timeSlotStartIndex,
      this.timeSlotStartIndex + TIME_SLOT_DAYS_VISIBLE
    );
  },

  get weekdayLabels() {
    return WEEKDAY_LABELS;
  },

  getTimeSlotLabels() {
    const firstDay = this.timeSlotDays[0];
    if (!firstDay) return [];
    return this.slotsByDate[firstDay] ?? [];
  },

  getSlotLabelParts(label) {
    if (!label) return { start: "", end: "" };
    const [start, end] = label.split("-");
    return { start: start?.trim() ?? "", end: end?.trim() ?? "" };
  },

  getDayHeaderParts(dateString) {
    const date = new Date(dateString);
    const dayIndex = date.getDay();
    return {
      weekday: new Intl.DateTimeFormat("sv-SE", { weekday: "long" }).format(date),
      dateLabel: new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long" }).format(date),
      isSaturday: dayIndex === 6,
      isSunday: dayIndex === 0
    };
  },

  formatDay(dateString) {
    return formatDate(dateString);
  },

  formatDayLong(dateString) {
    return formatDateLong(dateString);
  },

  setMode(mode) {
    this.mode = mode;
    persistMode(mode);
    this.bindRfidListener();
  },

  bindRfidListener() {
    if (this.rfidListenerBound) return;
    window.addEventListener("keydown", (event) => {
      if (!this.isPosMode || this.isAuthenticated) return;
      if (event.key === "Enter") {
        const value = this.rfidBuffer.trim() || this.rfidInput.trim();
        this.rfidBuffer = "";
        if (value) {
          this.rfidInput = value;
          this.submitRfidInput();
        }
        return;
      }
      if (event.key.length === 1) {
        this.rfidBuffer += event.key;
      }
    });
    window.addEventListener("paste", (event) => {
      if (!this.isPosMode || this.isAuthenticated) return;
      const text = event.clipboardData?.getData("text")?.trim();
      if (text) {
        this.rfidInput = text;
        this.submitRfidInput();
      }
    });
    this.rfidListenerBound = true;
  },

  async submitRfidInput() {
    const value = this.rfidInput.trim();
    if (!value) return;
    await this.loginPos(value);
  },

  async selectResource(resourceId) {
    this.selectedResourceId = resourceId;
    this.days = getUpcomingDays(this.getMaxAdvanceDays());
    this.timeSlotStartIndex = 0;
    this.resetAvailabilityData();
    await this.refreshSlots();
  },

  get canNavigateTimeSlotsBack() {
    return this.timeSlotStartIndex > 0;
  },

  get canNavigateTimeSlotsForward() {
    return this.timeSlotStartIndex + TIME_SLOT_DAYS_VISIBLE < this.days.length;
  },

  async navigateTimeSlots(step) {
    const nextIndex = this.timeSlotStartIndex + step;
    if (nextIndex < 0) return;
    if (nextIndex + TIME_SLOT_DAYS_VISIBLE > this.days.length) return;
    this.timeSlotStartIndex = nextIndex;
    await this.refreshSlots();
  },

  async loginPos(uidOverride = "") {
    this.loading = true;
    this.clearError();
    try {
      const api = await getApi();
      const uid = uidOverride || DEMO_RFID_UID;
      const result = await api.loginWithRfid(uid);
      this.isAuthenticated = true;
      this.userId = result.apartment_id ?? result.userId ?? null;
      this.rfidInput = "";
      await this.loadResources();
      await this.loadBookings();
      await this.refreshSlots();
    } catch (error) {
      if (error?.status === 401) {
        this.showError("Brickan är inte registrerad eller är inaktiv.");
      } else {
        this.showError("Backend kunde inte nås. Kontrollera anslutningen.");
      }
    }
    this.loading = false;
  },

  async loginPassword() {
    this.loading = true;
    this.clearError();
    try {
      const api = await getApi();
      const result = await api.loginWithPassword(
        this.userIdInput.trim(),
        this.passwordInput.trim()
      );
      this.isAuthenticated = true;
      this.userId = result.apartment_id ?? result.userId ?? null;
      await this.loadResources();
      await this.loadBookings();
      await this.refreshSlots();
    } catch (error) {
      if (error?.status === 401) {
        this.showError(
          "Felaktigt användar-ID eller lösenord. Saknar du lösenord, registrera dig på POS."
        );
      } else {
        this.showError("Backend kunde inte nås. Kontrollera anslutningen.");
      }
    }
    this.loading = false;
  },

  logout() {
    this.isAuthenticated = false;
    this.userId = null;
    this.userIdInput = "";
    this.passwordInput = "";
    this.bookings = [];
    this.resetAvailabilityData();
  },

  async loadBookings() {
    if (!this.userId) return;
    const api = await getApi();
    const bookings =
      api.getBookings.length > 0 ? await api.getBookings(this.userId) : await api.getBookings();
    this.bookings = normalizeBookings(bookings);
  },

  isDayBooked(dateString) {
    return this.fullDayAvailability[dateString] === false;
  },

  isSlotBooked(dateString, slotId) {
    const slots = this.slotsByDate[dateString] ?? [];
    const slot = slots.find((item) => item.id === slotId);
    return slot ? slot.isBooked : true;
  },

  isSlotPast(dateString, slotId) {
    const slots = this.slotsByDate[dateString] ?? [];
    const slot = slots.find((item) => item.id === slotId);
    return slot ? slot.isPast : false;
  },

  openConfirmBooking(payload) {
    const resource = this.resources.find((item) => item.id === payload.resourceId);
    const price = resource?.price ?? 0;
    const isFullDay = payload.type === "full-day";
    this.confirm = {
      open: true,
      action: payload.type,
      payload,
      title: "Bekräfta bokning",
      message: isFullDay
        ? `Boka ${payload.resourceName} den ${this.formatDayLong(payload.date)}?`
        : `Boka ${payload.resourceName} den ${this.formatDayLong(payload.date)} (${payload.slotLabel})?`,
      price
    };
  },

  openConfirmCancel(booking) {
    this.confirm = {
      open: true,
      action: "cancel",
      payload: booking,
      title: "Avboka",
      message: `Avboka ${booking.resourceName} den ${this.formatDayLong(booking.date)}?`,
      price: 0
    };
  },

  closeConfirm() {
    this.confirm.open = false;
  },

  async confirmAction() {
    if (!this.confirm.open) return;
    const { action, payload } = this.confirm;
    this.loading = true;
    this.clearError();
    try {
      const api = await getApi();
      if (action === "full-day") {
        const window = getDayWindow(payload.date);
        await api.bookSlot({
          apartment_id: this.userId,
          resource_id: payload.resourceId,
          start_time: window.start,
          end_time: window.end,
          is_billable: Boolean(this.confirm.price && this.confirm.price > 0)
        });
      }
      if (action === "time-slot") {
        const slot =
          (this.slotsByDate[payload.date] ?? []).find((item) => item.id === payload.slotId) ??
          null;
        if (!slot) {
          throw new Error("Slot saknas.");
        }
        await api.bookSlot({
          apartment_id: this.userId,
          resource_id: payload.resourceId,
          start_time: slot.startTime,
          end_time: slot.endTime,
          is_billable: Boolean(this.confirm.price && this.confirm.price > 0)
        });
      }
      if (action === "cancel") {
        await api.cancelBooking(payload.id);
      }
      await this.loadBookings();
      await this.refreshSlots();
      this.closeConfirm();
    } catch (error) {
      this.showError("Kunde inte slutföra åtgärden.");
    } finally {
      this.loading = false;
    }
  },

  getDayLabel(dateString) {
    return this.formatDay(dateString);
  },

  getFullDayCalendar() {
    const calendarDays = this.days.map((date) => ({
      date,
      label: this.getDayLabel(date),
      booked: this.isDayBooked(date),
      isPadding: false
    }));
    const firstDate = calendarDays[0]?.date;
    if (!firstDate) return [];
    const firstDay = new Date(firstDate);
    const offset = (firstDay.getDay() + 6) % 7;
    const padding = Array.from({ length: offset }, () => ({
      date: null,
      label: "",
      booked: false,
      isPadding: true
    }));
    return [...padding, ...calendarDays];
  },

  getTimeSlotItems(dateString) {
    return this.slotsByDate[dateString] ?? [];
  },

  isTimeSlotBooked(dateString, slotId) {
    if (!this.selectedResourceId) return true;
    return this.isSlotBooked(dateString, slotId);
  },

  isTimeSlotPast(dateString, slotId) {
    if (!this.selectedResourceId) return false;
    return this.isSlotPast(dateString, slotId);
  },

  isTimeSlotDisabled(dateString, slotId) {
    return this.isTimeSlotPast(dateString, slotId) || this.isTimeSlotBooked(dateString, slotId);
  },

  resetAvailabilityData() {
    this.availabilityRequestToken += 1;
    this.availabilityLoading = false;
    this.slotsByDate = {};
    this.fullDayAvailability = {};
  },

  async refreshSlots() {
    if (!this.selectedResourceId) return;
    const requestToken = ++this.availabilityRequestToken;
    const resourceId = this.selectedResourceId;
    const bookingType = this.selectedResource?.bookingType;
    const timeSlotDays = [...this.timeSlotDays];
    const fullDayDays = [...this.days];

    this.availabilityLoading = true;
    if (bookingType === "time-slot") {
      this.slotsByDate = {};
    } else {
      this.fullDayAvailability = {};
    }

    try {
      const api = await getApi();
      if (bookingType === "time-slot") {
        const entries = await Promise.all(
          timeSlotDays.map(async (date) => {
            const slots = await api.getSlots(resourceId, date);
            return [date, normalizeSlots(slots)];
          })
        );
        if (requestToken !== this.availabilityRequestToken || resourceId !== this.selectedResourceId) {
          return;
        }
        this.slotsByDate = Object.fromEntries(entries);
      } else {
        const availabilityEntries = await Promise.all(
          fullDayDays.map(async (date) => {
            const slots = await api.getSlots(resourceId, date);
            const normalized = normalizeSlots(slots);
            const available =
              normalized.length > 0 && !normalized[0].isBooked && !normalized[0].isPast;
            return [date, available];
          })
        );
        if (requestToken !== this.availabilityRequestToken || resourceId !== this.selectedResourceId) {
          return;
        }
        this.fullDayAvailability = Object.fromEntries(availabilityEntries);
      }
    } finally {
      if (requestToken === this.availabilityRequestToken) {
        this.availabilityLoading = false;
      }
    }
  },

  async loadResources() {
    const api = await getApi();
    const resources = await api.getResources();
    this.resources = normalizeResources(resources);
    this.selectedResourceId = this.resources[0]?.id ?? null;
    this.days = getUpcomingDays(this.getMaxAdvanceDays());
    this.timeSlotStartIndex = 0;
    this.resetAvailabilityData();
  },

  showError(message, timeoutMs = 3500) {
    this.errorMessage = message;
    if (this.errorTimeoutId) {
      clearTimeout(this.errorTimeoutId);
    }
    this.errorTimeoutId = window.setTimeout(() => {
      this.errorMessage = "";
      this.errorTimeoutId = null;
    }, timeoutMs);
  },

  clearError() {
    if (this.errorTimeoutId) {
      clearTimeout(this.errorTimeoutId);
      this.errorTimeoutId = null;
    }
    this.errorMessage = "";
  }
}));

Alpine.start();
