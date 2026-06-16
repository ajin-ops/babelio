import crypto from "node:crypto";

const SHOP_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

export function normalizeShop(shop) {
  if (!shop) return null;

  const normalized = shop
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();

  const withDomain = normalized.endsWith(".myshopify.com")
    ? normalized
    : `${normalized}.myshopify.com`;

  return SHOP_RE.test(withDomain) ? withDomain : null;
}

export function timingSafeEqualHex(left, right) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right || "", "hex");

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyShopifyHmac(query, secret) {
  const params = new URLSearchParams(query);
  const hmac = params.get("hmac");

  if (!hmac) return false;

  params.delete("hmac");
  params.delete("signature");

  const message = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const digest = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  return timingSafeEqualHex(digest, hmac);
}

export function createNonce() {
  return crypto.randomBytes(24).toString("hex");
}

export function buildAuthorizeUrl({ shop, clientId, scopes, redirectUri, state }) {
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeCodeForToken({ shop, code, clientId, clientSecret }) {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code
    })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Shopify token exchange failed: ${response.status} ${JSON.stringify(body)}`);
  }

  return body;
}

export async function shopifyGraphql({ shop, accessToken, apiVersion, query, variables }) {
  const response = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken
    },
    body: JSON.stringify({ query, variables })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok || body.errors) {
    throw new Error(`Shopify GraphQL request failed: ${response.status} ${JSON.stringify(body)}`);
  }

  return body.data;
}
