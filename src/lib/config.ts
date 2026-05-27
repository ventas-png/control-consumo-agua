export const APP_CONFIG = {
  SESSION_TIMEOUT: 8 * 60 * 60 * 1000, // 8 hours
  TOKEN_REFRESH_INTERVAL: 30 * 60 * 1000, // Refresh token every 30 minutes
  SESSION_WARNING_BEFORE_EXPIRY: 5 * 60 * 1000, // Show warning 5 minutes before expiry
  COUNTRY_CODE: import.meta.env.VITE_COUNTRY_CODE ?? '502',
} as const
