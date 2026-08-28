export const DEFAULT_RELEASE_REPOSITORY = "different-ai/openwork";

export function normalizeReleaseRepository(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_RELEASE_REPOSITORY;
  }
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.trim())) {
    throw new Error("Release repository must be an exact GitHub owner/repository identity.");
  }
  return value.trim();
}

export function githubReleaseBaseUrl(repository, suffix = "latest/download") {
  return `https://github.com/${normalizeReleaseRepository(repository)}/releases/${suffix}`;
}
