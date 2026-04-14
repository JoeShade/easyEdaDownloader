# Firefox SamacSys Proxy for Cloudflare Workers

This document provides a minimal Cloudflare Worker relay for the Firefox SamacSys proxy setting added in the extension.

Use it only for testing or for your own self-managed setup. The extension does not host or operate this relay.

## Worker contract

The extension sends a `POST` request to the Worker. The Worker request itself can include a relay-only `Authorization` header, while the JSON payload continues to carry upstream SamacSys headers separately:

```json
{
  "url": "https://ms.componentsearchengine.com/entry_u_newDesign.php?...",
  "method": "GET",
  "headers": {
    "Accept": "text/html",
    "Cookie": "PHPSESSID=example-session; partner=mouser",
    "Authorization": "Basic ..."
  },
  "credentials": "include",
  "bodyText": null,
  "bodyBase64": null
}
```

The Worker request headers look like:

```http
Authorization: Bearer your-relay-secret
Content-Type: application/json
Accept: */*
```

The Worker:

- optionally validates the relay request `Authorization` header before doing any upstream work
- fetches the upstream SamacSys URL server-side
- forwards the provided upstream cookie header when present
- forwards the provided upstream `Authorization` header when present
- returns the upstream response body and status
- adds permissive CORS headers
- adds `x-upstream-url` so the extension can preserve the final upstream URL after redirects

## Cloudflare Worker source

```js
const ALLOWED_HOST_PATTERN = /(^|\\.)componentsearchengine\\.com$/i;
const RELAY_AUTHORIZATION = "Bearer replace-me";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
};

function withCorsHeaders(headers = new Headers()) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return headers;
}

function decodeBase64ToUint8Array(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizeForwardHeaders(headers = {}) {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers || {})) {
    if (!value) {
      continue;
    }
    const normalizedKey = String(key).toLowerCase();
    if (
      normalizedKey === "host" ||
      normalizedKey === "content-length" ||
      normalizedKey.startsWith("cf-")
    ) {
      continue;
    }
    result.set(key, value);
  }
  return result;
}

function buildUpstreamRequest(body) {
  const requestInit = {
    method: body.method || "GET",
    headers: normalizeForwardHeaders(body.headers)
  };

  if (body.bodyText !== null && body.bodyText !== undefined) {
    requestInit.body = body.bodyText;
  } else if (body.bodyBase64) {
    requestInit.body = decodeBase64ToUint8Array(body.bodyBase64);
  }

  return requestInit;
}

function validateTargetUrl(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(url || ""));
  } catch {
    throw new Error("Invalid upstream URL.");
  }

  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    throw new Error("Unsupported upstream protocol.");
  }
  if (!ALLOWED_HOST_PATTERN.test(parsedUrl.hostname)) {
    throw new Error("Upstream host is not allowed.");
  }

  return parsedUrl.toString();
}

function isAuthorizedRelayRequest(request) {
  if (!RELAY_AUTHORIZATION) {
    return true;
  }
  return request.headers.get("Authorization") === RELAY_AUTHORIZATION;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: withCorsHeaders()
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed.", {
        status: 405,
        headers: withCorsHeaders()
      });
    }

    if (!isAuthorizedRelayRequest(request)) {
      return new Response("Unauthorized.", {
        status: 401,
        headers: withCorsHeaders()
      });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response("Invalid JSON payload.", {
        status: 400,
        headers: withCorsHeaders()
      });
    }

    let upstreamUrl;
    try {
      upstreamUrl = validateTargetUrl(payload.url);
    } catch (error) {
      return new Response(error.message || "Bad upstream URL.", {
        status: 400,
        headers: withCorsHeaders()
      });
    }

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        ...buildUpstreamRequest(payload),
        redirect: "follow"
      });
    } catch (error) {
      return new Response(`Upstream fetch failed: ${error.message || "network error"}`, {
        status: 502,
        headers: withCorsHeaders()
      });
    }

    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.set("x-upstream-url", upstreamResponse.url || upstreamUrl);
    withCorsHeaders(responseHeaders);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders
    });
  }
};
```

## Deploy quickly

1. Go to [Cloudflare Workers](https://workers.cloudflare.com/).
2. Create a new Worker.
3. Replace the default Worker code with the script above.
4. Deploy it.
5. Copy the Worker URL, for example:
   `https://your-samacsys-relay.your-subdomain.workers.dev`
6. In the extension popup:
   - open `Advanced`
   - paste the Worker URL into `Firefox SamacSys proxy URL`
   - if the Worker validates relay auth, paste the matching value into `Firefox SamacSys proxy Authorization header`
7. Reload the target Mouser or Farnell page and test previews in Firefox first.
8. If previews work, try ZIP export.

## Troubleshooting order

1. If previews fail:
   - check the relay URL
   - confirm the Worker is deployed
   - confirm the Worker still allows `*.componentsearchengine.com`
2. If previews work but ZIP export says sign-in is required:
   - visit the upstream Mouser or Farnell ECAD flow first so Firefox has fresh `componentsearchengine.com` cookies for the extension to forward
3. If previews work and ZIP export still says sign-in is required:
   - prefer filling in `SamacSys username` and `SamacSys password` so the extension can generate the upstream HTTP Basic auth header locally
   - or let Firefox load a successful upstream SamacSys request first so the extension can auto-capture the latest upstream `Authorization` header
   - confirm the popup now shows `Auto-captured SamacSys Authorization` as available
   - if ZIP export still fails, copy the fallback value into `Manual SamacSys Authorization override`
4. Retry ZIP export after updating either cookies or the auth header. The extension will also do one automatic refresh-and-retry cycle after a ZIP `401` in Firefox relay mode.

## Notes

- This Worker is intentionally restricted to `*.componentsearchengine.com` targets so it does not become a generic open proxy.
- The current extension relay contract expects the Worker to expose the final upstream URL through `x-upstream-url`.
- The extension now forwards matching upstream SamacSys cookies in `headers.Cookie`, so the Worker does not need to manage its own login state.
- The extension can send relay auth separately in the Worker request `Authorization` header.
- The extension can also forward an explicit upstream SamacSys `Authorization` header in `headers.Authorization`, sourced from the popup's manual override, from locally generated Basic auth using stored SamacSys credentials, or from the latest Firefox-captured request.
- Upstream SamacSys auth capture is Firefox-oriented and depends on the extension's `webRequest` permission.
- If you want to relay more than SamacSys traffic, change the allowed-host validation deliberately rather than removing it entirely.
