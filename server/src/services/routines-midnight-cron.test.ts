import { afterEach, describe, expect, it, vi } from "vitest";
import { nextCronTickInTimeZone } from "./routines.js";

// STA-7731: on h24-cycle ICU builds (node 20 with `hour12: false`), midnight
// formats as hour "24", so any cron whose hour field resolves to 0 never
// matches and schedule triggers are persisted with nextRunAt=null — enabled,
// active, and permanently invisible to the dispatcher's isNotNull(nextRunAt)
// due-query. These tests pin the fixed behavior.
describe("nextCronTickInTimeZone midnight-hour crons (STA-7731)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves a 00:30 UTC daily cron to the next 00:30 UTC", () => {
    const next = nextCronTickInTimeZone("30 0 * * *", "UTC", new Date("2026-10-04T12:00:00Z"));
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe("2026-10-05T00:30:00.000Z");
  });

  it("resolves local midnight in a non-UTC zone", () => {
    const next = nextCronTickInTimeZone(
      "0 0 * * *",
      "America/New_York",
      new Date("2026-10-04T12:00:00Z"),
    );
    expect(next).not.toBeNull();
    // Midnight America/New_York on Oct 5 is 04:00 UTC (EDT, UTC-4).
    expect(next!.toISOString()).toBe("2026-10-05T04:00:00.000Z");
  });

  it("fires the midnight half of a 0,12 schedule, not just noon", () => {
    const next = nextCronTickInTimeZone("0 0,12 * * *", "UTC", new Date("2026-10-04T13:00:00Z"));
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("survives an h24-cycle formatter that renders midnight as hour 24", () => {
    const RealDateTimeFormat = Intl.DateTimeFormat;
    // Simulate node 20 ICU: wrap formatToParts so midnight comes back as
    // "24" (the h24 hour cycle), the exact behavior that produced the bug.
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
      ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
    ) {
      const real = new RealDateTimeFormat(...args);
      return {
        format: real.format.bind(real),
        resolvedOptions: real.resolvedOptions.bind(real),
        formatToParts: (date?: Date | number) =>
          real.formatToParts(date).map((part) =>
            part.type === "hour" && Number(part.value) === 0
              ? { ...part, value: "24" }
              : part,
          ),
      } as unknown as Intl.DateTimeFormat;
    } as unknown as typeof Intl.DateTimeFormat);

    // Use a timezone no other test has warmed: the per-timezone formatter
    // cache would otherwise hand back an unmocked instance.
    const next = nextCronTickInTimeZone(
      "30 0 * * *",
      "Etc/GMT+1",
      new Date("2026-10-04T12:00:00Z"),
    );
    expect(next).not.toBeNull();
    // 00:30 at UTC-1 is 01:30 UTC.
    expect(next!.toISOString()).toBe("2026-10-05T01:30:00.000Z");
  });
});
