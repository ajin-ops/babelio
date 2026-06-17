import http from "node:http";
import { clearSessionCookie, cookieHeader, createSessionCookie, credentialsMatch, readCookie, requireSession } from "./auth.js";
import { getConfig } from "./config.js";
import {
  buildAuthorizeUrl,
  createNonce,
  exchangeCodeForToken,
  normalizeShop,
  shopifyGraphql,
  verifyShopifyHmac
} from "./shopify.js";
import { getShopSession, listShopSessions, upsertShopSession } from "./store.js";

const config = getConfig();

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body, null, 2));
}

function redirect(res, location, cookies = []) {
  res.writeHead(302, {
    "Location": location,
    "Set-Cookie": cookies
  });
  res.end();
}

async function readForm(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function htmlPage(body, { wide = false } = {}) {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Babelio Shopify Connect</title>
  <style>
    :root { color-scheme: light; --border: #d8dee8; --muted: #617085; --bg: #f7f9fc; --ink: #172033; --brand: #136f63; --brand-dark: #0d5148; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(${wide ? "1120px" : "760px"}, calc(100% - 32px)); margin: 40px auto; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 28px; line-height: 1.2; }
    h2 { margin: 0 0 14px; font-size: 18px; }
    p { color: var(--muted); line-height: 1.5; }
    .panel, .shop-row { background: white; border: 1px solid var(--border); border-radius: 8px; }
    .panel { padding: 22px; margin-bottom: 18px; }
    .stack { display: grid; gap: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
    label { display: grid; gap: 7px; color: #344054; font-size: 14px; font-weight: 600; }
    input { width: 100%; padding: 12px; border: 1px solid #b8c0cc; border-radius: 6px; font: inherit; background: white; }
    button, a.button { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 10px 14px; border: 0; border-radius: 6px; background: var(--brand); color: white; font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
    button:hover, a.button:hover { background: var(--brand-dark); }
    .ghost { background: transparent !important; color: var(--ink) !important; border: 1px solid var(--border) !important; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .shop-list { display: grid; gap: 10px; }
    .shop-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px; }
    .meta { color: var(--muted); font-size: 13px; margin-top: 4px; }
    code { background: #eef2f7; padding: 2px 5px; border-radius: 4px; }
    pre { overflow: auto; background: #101828; color: #eef6ff; border-radius: 8px; padding: 18px; }
    .error { color: #b42318; background: #fff3f0; border: 1px solid #ffcbc2; border-radius: 6px; padding: 10px 12px; }
    @media (max-width: 780px) { main { margin: 24px auto; } header, .shop-row { align-items: stretch; flex-direction: column; } .grid { grid-template-columns: 1fr; } .actions { width: 100%; } button, a.button { width: 100%; } }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function renderLogin(res, error = "") {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(htmlPage(`
    <header><h1>Babelio Dashboard</h1></header>
    <section class="panel">
      <h2>Einloggen</h2>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <form class="stack" action="/login" method="post">
        <label>E-Mail <input name="email" type="email" autocomplete="username" required></label>
        <label>Passwort <input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit">Einloggen</button>
      </form>
    </section>
  `));
}

async function handleHome(req, res) {
  if (requireSession(req, res, config)) {
    redirect(res, "/dashboard");
  }
}

async function handleLoginGet(_req, res) {
  renderLogin(res);
}

async function handleLoginPost(req, res) {
  const form = await readForm(req);
  const email = form.get("email")?.trim() || "";
  const password = form.get("password") || "";

  if (!credentialsMatch(email, password, config)) {
    return renderLogin(res, "Login ist nicht korrekt.");
  }

  redirect(res, "/dashboard", [createSessionCookie(email, config)]);
}

async function handleLogout(_req, res) {
  redirect(res, "/login", [clearSessionCookie(config)]);
}

async function handleDashboard(req, res) {
  const session = requireSession(req, res, config);
  if (!session) return;

  const shops = await listShopSessions();
  const shopRows = shops.length > 0
    ? shops.map((shop) => `
      <div class="shop-row">
        <div>
          <strong>${escapeHtml(shop.shop)}</strong>
          <div class="meta">Scopes: ${escapeHtml(shop.scope || "unbekannt")} · Aktualisiert: ${escapeHtml(shop.updatedAt || "-")}</div>
        </div>
        <div class="actions">
          <a class="button ghost" href="/shop?shop=${encodeURIComponent(shop.shop)}">Details</a>
          <a class="button" href="/api/shopify/shop?shop=${encodeURIComponent(shop.shop)}">JSON</a>
        </div>
      </div>
    `).join("")
    : `<p>Noch kein Shop verbunden.</p>`;

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(htmlPage(`
    <header>
      <div>
        <h1>Shopify Shops</h1>
        <div class="meta">Eingeloggt als ${escapeHtml(session.email)}</div>
      </div>
      <a class="button ghost" href="/logout">Logout</a>
    </header>
    <div class="grid">
      <section class="panel">
        <h2>Shop hinzufügen</h2>
        <form class="stack" action="/auth/shopify" method="get">
          <label>Shop-Domain <input name="shop" placeholder="dein-shop.myshopify.com" autocomplete="off" required></label>
          <button type="submit">Mit Shopify verbinden</button>
        </form>
      </section>
      <section class="panel">
        <h2>Setup</h2>
        <p>Callback URL in Shopify:</p>
        <p><code>${escapeHtml(config.appUrl)}/auth/shopify/callback</code></p>
      </section>
    </div>
    <section class="panel">
      <h2>Verbundene Shops</h2>
      <div class="shop-list">${shopRows}</div>
    </section>
  `, { wide: true }));
}

async function handleAuth(req, res, url) {
  if (!requireSession(req, res, config)) return;

  const shop = normalizeShop(url.searchParams.get("shop"));

  if (!shop) {
    return sendJson(res, 400, { error: "Invalid shop. Use dein-shop.myshopify.com." });
  }

  const state = createNonce();
  const redirectUri = `${config.appUrl}/auth/shopify/callback`;
  const authorizeUrl = buildAuthorizeUrl({
    shop,
    clientId: config.clientId,
    scopes: config.scopes,
    redirectUri,
    state
  });

  redirect(res, authorizeUrl, [
    cookieHeader("shopify_oauth_state", state, config, 600)
  ]);
}

async function handleCallback(req, res, url) {
  const shop = normalizeShop(url.searchParams.get("shop"));
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const expectedState = readCookie(req, "shopify_oauth_state");

  if (!shop || !state || !code) {
    return sendJson(res, 400, { error: "Missing required Shopify callback parameters." });
  }

  if (state !== expectedState) {
    return sendJson(res, 403, { error: "Invalid OAuth state." });
  }

  if (!verifyShopifyHmac(url.searchParams, config.clientSecret)) {
    return sendJson(res, 403, { error: "Invalid Shopify HMAC." });
  }

  const tokenResponse = await exchangeCodeForToken({
    shop,
    code,
    clientId: config.clientId,
    clientSecret: config.clientSecret
  });

  await upsertShopSession({
    shop,
    accessToken: tokenResponse.access_token,
    scope: tokenResponse.scope
  });

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Set-Cookie": cookieHeader("shopify_oauth_state", "", config, 0)
  });
  res.end(htmlPage(`
    <h1>Shop verbunden</h1>
    <p><code>${shop}</code> ist verbunden. Erste Lesedaten kannst du jetzt abrufen.</p>
    <div class="actions">
      <a class="button" href="/dashboard">Zurueck zum Dashboard</a>
      <a class="button ghost" href="/shop?shop=${encodeURIComponent(shop)}">Shopdaten anzeigen</a>
    </div>
  `));
}

async function loadShopData(url) {
  const shop = normalizeShop(url.searchParams.get("shop"));

  if (!shop) {
    const error = new Error("Invalid shop.");
    error.status = 400;
    throw error;
  }

  const session = await getShopSession(shop);

  if (!session?.accessToken) {
    const error = new Error("Shop is not connected yet.");
    error.status = 404;
    throw error;
  }

  const data = await shopifyGraphql({
    shop,
    accessToken: session.accessToken,
    apiVersion: config.apiVersion,
    query: `#graphql
      query ReadInitialShopData {
        shop {
          id
          name
          email
          myshopifyDomain
          plan {
            displayName
          }
        }
        products(first: 10) {
          edges {
            node {
              id
              title
              status
              createdAt
              updatedAt
            }
          }
        }
      }
    `
  });

  return { shop, data };
}

async function handleShopData(req, res, url) {
  if (!requireSession(req, res, config)) return;

  const { data } = await loadShopData(url);
  sendJson(res, 200, data);
}

async function handleShopDetails(req, res, url) {
  if (!requireSession(req, res, config)) return;

  const { shop, data } = await loadShopData(url);

  const products = data.products.edges.map(({ node }) => `
    <div class="shop-row">
      <div>
        <strong>${escapeHtml(node.title)}</strong>
        <div class="meta">${escapeHtml(node.status)} · Aktualisiert: ${escapeHtml(node.updatedAt)}</div>
      </div>
      <code>${escapeHtml(node.id)}</code>
    </div>
  `).join("");

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(htmlPage(`
    <header>
      <div>
        <h1>${escapeHtml(data.shop.name)}</h1>
        <div class="meta">${escapeHtml(shop)} · ${escapeHtml(data.shop.plan?.displayName || "Plan unbekannt")}</div>
      </div>
      <a class="button ghost" href="/dashboard">Dashboard</a>
    </header>
    <section class="panel">
      <h2>Shop</h2>
      <p>E-Mail: <code>${escapeHtml(data.shop.email || "-")}</code></p>
      <p>Shopify Domain: <code>${escapeHtml(data.shop.myshopifyDomain)}</code></p>
    </section>
    <section class="panel">
      <h2>Produkte</h2>
      <div class="shop-list">${products || "<p>Keine Produkte gefunden.</p>"}</div>
    </section>
  `, { wide: true }));
}

async function handleShops(req, res) {
  if (!requireSession(req, res, config)) return;

  sendJson(res, 200, { shops: await listShopSessions() });
}

async function route(req, res) {
  const url = new URL(req.url, config.appUrl);

  try {
    if (req.method === "GET" && url.pathname === "/") return await handleHome(req, res);
    if (req.method === "GET" && url.pathname === "/login") return await handleLoginGet(req, res);
    if (req.method === "POST" && url.pathname === "/login") return await handleLoginPost(req, res);
    if (req.method === "GET" && url.pathname === "/logout") return await handleLogout(req, res);
    if (req.method === "GET" && url.pathname === "/dashboard") return await handleDashboard(req, res);
    if (req.method === "GET" && url.pathname === "/auth/shopify") return await handleAuth(req, res, url);
    if (req.method === "GET" && url.pathname === "/auth/shopify/callback") return await handleCallback(req, res, url);
    if (req.method === "GET" && url.pathname === "/api/shopify/shop") return await handleShopData(req, res, url);
    if (req.method === "GET" && url.pathname === "/shop") return await handleShopDetails(req, res, url);
    if (req.method === "GET" && url.pathname === "/api/shops") return await handleShops(req, res);
    if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { ok: true });

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

http.createServer(route).listen(config.port, () => {
  console.log(`Shopify connector running on http://localhost:${config.port}`);
});
