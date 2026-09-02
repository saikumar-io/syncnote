/**
 * Safe API Client for SyncNote
 * Handles JSON parsing, 204 No Content, empty responses, HTTP status errors, and offline network failures.
 */

export async function request(url, options = {}) {
  const defaultHeaders = {
    'Accept': 'application/json'
  };

  if (options.body && typeof options.body === 'string' && !options.headers?.['Content-Type']) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  const config = {
    ...options,
    credentials: 'include',
    headers: {
      ...defaultHeaders,
      ...options.headers
    }
  };

  let response;
  try {
    response = await fetch(url, config);
  } catch (netErr) {
    const error = new Error('Network error or server unreachable');
    error.isNetworkError = true;
    error.status = 0;
    throw error;
  }

  // Handle HTTP 204 No Content
  if (response.status === 204) {
    return { ok: true, status: 204, data: null };
  }

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  let data = null;

  try {
    const text = await response.text();
    if (text && text.trim().length > 0) {
      if (isJson) {
        data = JSON.parse(text);
      } else {
        // Plain text or non-JSON body
        data = { message: text };
      }
    }
  } catch (parseErr) {
    console.warn(`[apiClient] Safe JSON parse warning for ${url}:`, parseErr.message);
    data = null;
  }

  if (!response.ok) {
    const errorMessage =
      (data && (data.error || data.message)) ||
      `HTTP Error ${response.status}: ${response.statusText}`;

    const error = new Error(errorMessage);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export const apiClient = {
  get: (url, options) => request(url, { ...options, method: 'GET' }),
  post: (url, body, options) => request(url, { ...options, method: 'POST', body: JSON.stringify(body) }),
  put: (url, body, options) => request(url, { ...options, method: 'PUT', body: JSON.stringify(body) }),
  patch: (url, body, options) => request(url, { ...options, method: 'PATCH', body: JSON.stringify(body) }),
  delete: (url, options) => request(url, { ...options, method: 'DELETE' })
};
