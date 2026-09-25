import { afterEach, describe, expect, it } from "vitest";

import { loadStoredProfileCompletion, PROFILE_STORAGE_KEY } from "../lib/profileCompletion";

describe("loadStoredProfileCompletion", () => {
  afterEach(() => localStorage.clear());

  it("reports 0% with all 8 fields missing for an empty profile (same as Account)", () => {
    const result = loadStoredProfileCompletion();
    expect(result.value).toBe(0);
    expect(result.missingFields).toHaveLength(8);
  });

  it("counts saved Account profile fields", () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ firstName: "A", lastName: "B", bio: "x", avatarDataUrl: "" }));
    const result = loadStoredProfileCompletion();
    expect(result.completed).toBe(3);
    expect(result.value).toBe(38);
  });
});
