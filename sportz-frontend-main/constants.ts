// In development, use relative URLs so requests go through the Vite proxy
// (no CORS issues). In production, use the full backend URL from env vars.
const isDev = import.meta.env.DEV;

const DEFAULT_API_BASE_URL = "";           // relative → proxied by Vite
const DEFAULT_WS_BASE_URL  = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export const API_BASE_URL =
  isDev ? DEFAULT_API_BASE_URL : (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL);
export const WS_BASE_URL =
  isDev ? DEFAULT_WS_BASE_URL : (import.meta.env.VITE_WS_BASE_URL || DEFAULT_WS_BASE_URL);

// Exponential backoff configuration
export const MAX_RECONNECT_DELAY = 30000; // 30 seconds
export const INITIAL_RECONNECT_DELAY = 1000; // 1 second
