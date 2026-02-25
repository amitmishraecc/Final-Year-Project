const DEFAULT_API_BASE =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : "http://127.0.0.1:8000";

export const API_BASE = import.meta.env.VITE_API_BASE || DEFAULT_API_BASE;
const API_BASE_FALLBACKS = [API_BASE, "http://localhost:8000", "http://127.0.0.1:8000"];

function getAuthHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch(path, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...getAuthHeaders(),
    ...(options.headers || {}),
  };

  let response = null;
  let lastError = null;
  const uniqueBases = [...new Set(API_BASE_FALLBACKS)];

  for (const base of uniqueBases) {
    try {
      response = await fetch(`${base}${path}`, {
        ...options,
        headers,
      });
      if (base !== API_BASE) {
        // eslint-disable-next-line no-console
        console.info(`API fallback in use: ${base}`);
      }
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!response) {
    throw new Error(
      `Cannot connect to backend. Tried: ${uniqueBases.join(", ")}`
    );
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.detail || data?.error || "Request failed";
    throw new Error(message);
  }

  return data;
}
