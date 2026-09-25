import type { AccountProfile } from "../types";

/** localStorage key the Account page persists the profile under. */
export const PROFILE_STORAGE_KEY = "ot.account.profile";

export const PROFILE_COMPLETION_FIELDS: ReadonlyArray<{
  key: keyof AccountProfile;
  label: string;
  isComplete: (profile: AccountProfile) => boolean;
}> = [
  { key: "firstName", label: "First Name", isComplete: (profile) => Boolean(profile.firstName?.trim()) },
  { key: "lastName", label: "Last Name", isComplete: (profile) => Boolean(profile.lastName?.trim()) },
  { key: "displayName", label: "Display Name", isComplete: (profile) => Boolean(profile.displayName?.trim()) },
  { key: "phone", label: "Phone", isComplete: (profile) => Boolean(profile.phone?.trim()) },
  { key: "location", label: "Location", isComplete: (profile) => Boolean(profile.location?.trim()) },
  { key: "deskFocus", label: "Desk Focus", isComplete: (profile) => Boolean(profile.deskFocus?.trim()) },
  { key: "bio", label: "Bio", isComplete: (profile) => Boolean(profile.bio?.trim()) },
  { key: "avatarDataUrl", label: "Avatar", isComplete: (profile) => Boolean(profile.avatarDataUrl) },
] as const;

export function computeProfileCompletion(profile: Partial<AccountProfile>) {
  const total = PROFILE_COMPLETION_FIELDS.length;
  const missingFields = PROFILE_COMPLETION_FIELDS.filter((field) => !field.isComplete(profile as AccountProfile)).map(
    (field) => field.label,
  );
  const completed = total - missingFields.length;
  return { value: Math.round((completed / total) * 100), missingFields, completed, total };
}

/** Completion of the profile saved by the Account page (same computation it shows). */
export function loadStoredProfileCompletion() {
  let stored: Partial<AccountProfile> = {};
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<AccountProfile>;
  } catch {
    stored = {};
  }
  return computeProfileCompletion(stored);
}
