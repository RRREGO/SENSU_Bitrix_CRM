/**

 * Единый browser API client: credentials + CSRF для state-changing.

 */



const STATE = new Set(["POST", "PUT", "PATCH", "DELETE"]);



let csrfToken = null;

let csrfPromise = null;



export function clearCsrfToken() {

  csrfToken = null;

  csrfPromise = null;

}



export function setCsrfToken(token) {

  csrfToken = token || null;

}



export function getCsrfToken() {

  return csrfToken;

}



async function refreshCsrf() {

  if (csrfPromise) return csrfPromise;

  csrfPromise = (async () => {

    const res = await fetch("/auth/csrf", { credentials: "same-origin" });

    if (!res.ok) {

      clearCsrfToken();

      throw Object.assign(new Error("CSRF refresh failed"), { status: res.status });

    }

    const data = await res.json();

    setCsrfToken(data.csrfToken);

    return data.csrfToken;

  })();

  try {

    return await csrfPromise;

  } finally {

    csrfPromise = null;

  }

}



function handleAuthStatus(res, data) {

  const code = data?.error?.code;

  if (res.status === 401 || code === "AUTHENTICATION_REQUIRED" || code === "SESSION_EXPIRED") {

    clearCsrfToken();

    const gate = document.getElementById("loginGate");

    if (gate) gate.classList.remove("hidden");

  }

  return data;

}



async function request(method, url, body, options = {}, retried = false) {

  const headers = { ...(options.headers || {}) };

  const upper = String(method || "GET").toUpperCase();

  if (STATE.has(upper) && !options.skipCsrf) {

    let token = getCsrfToken();

    if (!token && !options.skipCsrfRefresh) {

      try {

        token = await refreshCsrf();

      } catch {

        /* login may not have session yet */

      }

    }

    if (token) headers["X-CSRF-Token"] = token;

  }

  if (body !== undefined && body !== null && !headers["Content-Type"]) {

    headers["Content-Type"] = "application/json";

  }



  const res = await fetch(url, {

    method: upper,

    credentials: "same-origin",

    headers,

    body:

      body === undefined || body === null

        ? undefined

        : typeof body === "string"

          ? body

          : JSON.stringify(body),

    signal: options.signal,

  });



  let data = null;

  const text = await res.text();

  try {

    data = text ? JSON.parse(text) : null;

  } catch {

    data = { raw: text };

  }



  if (

    !retried &&

    STATE.has(upper) &&

    data?.error?.code === "CSRF_VALIDATION_FAILED" &&

    !options.skipCsrf

  ) {

    clearCsrfToken();

    await refreshCsrf();

    return request(method, url, body, options, true);

  }



  handleAuthStatus(res, data);

  if (!res.ok && options.throwOnError !== false) {

    const err = new Error(data?.error?.message || `HTTP ${res.status}`);

    err.status = res.status;

    err.code = data?.error?.code;

    err.data = data;

    if (options.returnResponse) return { ok: false, status: res.status, data, response: res };

    throw err;

  }



  if (options.returnResponse) {

    return { ok: res.ok, status: res.status, data, response: res };

  }

  return data;

}



export function apiGet(url, options = {}) {

  return request("GET", url, null, { ...options, throwOnError: options.throwOnError ?? false });

}



export function apiPost(url, body, options = {}) {

  return request("POST", url, body ?? {}, options);

}



export function apiPatch(url, body, options = {}) {

  return request("PATCH", url, body ?? {}, options);

}



export function apiPut(url, body, options = {}) {

  return request("PUT", url, body ?? {}, options);

}



export function apiDelete(url, body, options = {}) {

  return request("DELETE", url, body ?? undefined, options);

}



/** Low-level: returns { ok, status, data } without throw */

export async function apiFetch(url, options = {}) {

  const method = options.method || "GET";

  let body = options.body;

  if (typeof body === "string") {

    try {

      body = JSON.parse(body);

    } catch {

      /* keep string path via raw */

      return request(method, url, body, {

        ...options,

        throwOnError: false,

        returnResponse: true,

        skipCsrf: options.skipCsrf,

      });

    }

  }

  return request(method, url, body, {

    ...options,

    throwOnError: false,

    returnResponse: true,

    skipCsrf: options.skipCsrf,

  });

}


