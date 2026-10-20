// Shared authentication configuration must not initialize the audited API-key service.
export const DEN_API_KEY_HEADER = "x-api-key"
export const DEN_API_KEY_DEFAULT_PREFIX = "den_"
export const DEN_API_KEY_RATE_LIMIT_MAX = 600
export const DEN_API_KEY_RATE_LIMIT_TIME_WINDOW_MS = 60_000
export const DEN_API_KEY_EXPIRES_IN_DAYS = 90
export const DEN_API_KEY_EXPIRES_IN_SECONDS = DEN_API_KEY_EXPIRES_IN_DAYS * 24 * 60 * 60
