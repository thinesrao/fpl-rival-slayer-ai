import { describe, expect, it } from "vitest";
import { FplAuthError, activeChipOf, sanitizeFplCookie } from "./my-team";

describe("sanitizeFplCookie", () => {
  it("keeps only the cookies FPL needs", () => {
    const out = sanitizeFplCookie("pl_profile=abc; _ga=GA1.2.9; sessionid=xyz; ajs_user=zz");
    expect(out).toBe("pl_profile=abc; sessionid=xyz");
  });

  it("accepts a pasted Cookie: header", () => {
    expect(sanitizeFplCookie("Cookie: sessionid=xyz")).toBe("sessionid=xyz");
  });

  it("accepts a single pl_profile pair", () => {
    expect(sanitizeFplCookie("pl_profile=abc")).toBe("pl_profile=abc");
  });

  it("preserves base64 values that contain '='", () => {
    expect(sanitizeFplCookie("pl_profile=eyJhbGciOi==")).toBe("pl_profile=eyJhbGciOi==");
  });

  it("rejects a paste with no login cookie in it", () => {
    expect(() => sanitizeFplCookie("_ga=GA1.2.9; csrftoken=tok")).toThrow(FplAuthError);
  });

  it("rejects an empty paste", () => {
    expect(() => sanitizeFplCookie("")).toThrow(FplAuthError);
  });

  it("ignores a login cookie with an empty value", () => {
    expect(() => sanitizeFplCookie("sessionid=")).toThrow(FplAuthError);
  });
});

describe("activeChipOf", () => {
  const picks = [{ element: 1, position: 1 }];

  it("names the chip active on the pending squad", () => {
    const chip = activeChipOf({
      picks,
      chips: [
        { name: "bboost", status_for_entry: "available" },
        { name: "wildcard", status_for_entry: "active" },
      ],
    });
    expect(chip).toBe("wildcard");
  });

  it("is null when no chip is active", () => {
    expect(activeChipOf({ picks, chips: [{ name: "wildcard", status_for_entry: "available" }] })).toBeNull();
  });

  it("is null when FPL omits chips entirely", () => {
    expect(activeChipOf({ picks })).toBeNull();
  });
});
