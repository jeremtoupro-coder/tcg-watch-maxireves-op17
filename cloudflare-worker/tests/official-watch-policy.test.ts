import { describe, expect, it } from "vitest";
import {
  computeOfficialWatchWindow,
  oneCalendarMonthAfter
} from "../src/officialWatchPolicy";

describe("politique de surveillance du planning officiel", () => {
  it("active immédiatement un produit dès qu'il est présent dans le planning, sans borne de 4 mois", () => {
    const sixMonthsBefore = computeOfficialWatchWindow(
      "2027-08-28",
      new Date("2027-02-28T12:00:00.000Z")
    );
    const threeMonthsBefore = computeOfficialWatchWindow(
      "2027-08-28",
      new Date("2027-05-28T12:00:00.000Z")
    );

    expect(sixMonthsBefore.active).toBe(true);
    expect(threeMonthsBefore.active).toBe(true);
    expect(threeMonthsBefore.activationPolicy).toBe("official_calendar_presence");
  });

  it("reste actif jusqu'au jour situé exactement un mois calendaire après la sortie", () => {
    expect(oneCalendarMonthAfter("2026-08-28")).toBe("2026-09-28");
    expect(computeOfficialWatchWindow("2026-08-28", new Date("2026-09-28T23:59:00.000Z")).active)
      .toBe(true);
    expect(computeOfficialWatchWindow("2026-08-28", new Date("2026-09-29T00:00:00.000Z")).active)
      .toBe(false);
  });

  it("borne correctement les fins de mois", () => {
    expect(oneCalendarMonthAfter("2027-01-31")).toBe("2027-02-28");
    expect(oneCalendarMonthAfter("2028-01-31")).toBe("2028-02-29");
    expect(oneCalendarMonthAfter("2026-03-31")).toBe("2026-04-30");
  });

  it("refuse une date officielle impossible", () => {
    expect(() => oneCalendarMonthAfter("2026-02-31")).toThrow(/date de sortie invalide/i);
  });
});
