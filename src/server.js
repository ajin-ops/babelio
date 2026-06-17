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
import { deleteShopSession, getShopSession, listShopSessions, upsertShopSession } from "./store.js";

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

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatMoney(money) {
  if (!money) return "-";
  return `${money.amount} ${money.currencyCode}`;
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
    :root { color-scheme: light; --border: #d8dee8; --muted: #617085; --bg: #f7f9fc; --ink: #172033; --brand: #136f63; --brand-dark: #0d5148; --soft: #edf7f5; --danger: #b42318; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(${wide ? "1180px" : "760px"}, calc(100% - 32px)); margin: 34px auto; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 28px; line-height: 1.2; }
    h2 { margin: 0 0 14px; font-size: 18px; }
    p { color: var(--muted); line-height: 1.5; }
    .panel, .shop-row { background: white; border: 1px solid var(--border); border-radius: 8px; }
    .panel { padding: 22px; margin-bottom: 18px; }
    .stack { display: grid; gap: 12px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }
    .metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
    .metric { background: white; border: 1px solid var(--border); border-radius: 8px; padding: 16px; min-height: 108px; }
    .metric strong { display: block; font-size: 28px; margin-top: 10px; }
    .metric span { color: var(--muted); font-size: 13px; font-weight: 700; }
    nav.tabs { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 22px; }
    nav.tabs a { color: #2e3b4e; border: 1px solid var(--border); background: white; padding: 9px 11px; border-radius: 6px; font-size: 14px; font-weight: 700; text-decoration: none; }
    nav.tabs a.active { background: var(--brand); border-color: var(--brand); color: white; }
    label { display: grid; gap: 7px; color: #344054; font-size: 14px; font-weight: 600; }
    input, textarea, select { width: 100%; padding: 12px; border: 1px solid #b8c0cc; border-radius: 6px; font: inherit; background: white; }
    textarea { min-height: 120px; resize: vertical; }
    button, a.button { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 10px 14px; border: 0; border-radius: 6px; background: var(--brand); color: white; font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
    button:hover, a.button:hover { background: var(--brand-dark); }
    .ghost { background: transparent !important; color: var(--ink) !important; border: 1px solid var(--border) !important; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .actions form { margin: 0; }
    .shop-list { display: grid; gap: 10px; }
    .shop-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px; }
    .table { width: 100%; border-collapse: collapse; background: white; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .table th, .table td { border-bottom: 1px solid var(--border); padding: 12px; text-align: left; vertical-align: top; }
    .table th { color: #344054; background: #f4f7fb; font-size: 13px; }
    .table tr:last-child td { border-bottom: 0; }
    .badge { display: inline-flex; padding: 4px 8px; border-radius: 999px; background: var(--soft); color: var(--brand-dark); font-size: 12px; font-weight: 800; }
    .meta { color: var(--muted); font-size: 13px; margin-top: 4px; }
    code { background: #eef2f7; padding: 2px 5px; border-radius: 4px; }
    pre { overflow: auto; background: #101828; color: #eef6ff; border-radius: 8px; padding: 18px; }
    .error { color: #b42318; background: #fff3f0; border: 1px solid #ffcbc2; border-radius: 6px; padding: 10px 12px; }
    .danger { background: var(--danger); }
    .danger:hover { background: #8a1c13; }
    @media (max-width: 980px) { .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 780px) { main { margin: 24px auto; } header, .shop-row { align-items: stretch; flex-direction: column; } .grid, .metrics { grid-template-columns: 1fr; } .actions { width: 100%; } button, a.button { width: 100%; } .table { display: block; overflow-x: auto; } }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

const tabs = [
  ["overview", "Overview"],
  ["integrations", "Integrations"],
  ["orders", "Orders"],
  ["products", "Products"],
  ["knowledge", "Knowledge Base"],
  ["agents", "Agents"],
  ["conversations", "Conversations"],
  ["tasks", "Actions / Tasks"]
];

function dashboardUrl(tab) {
  return tab === "overview" ? "/dashboard" : `/dashboard/${tab}`;
}

function dashboardShell({ active, session, title, content }) {
  const nav = tabs.map(([id, label]) => `
    <a class="${id === active ? "active" : ""}" href="${dashboardUrl(id)}">${escapeHtml(label)}</a>
  `).join("");

  return htmlPage(`
    <header>
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">Eingeloggt als ${escapeHtml(session.email)}</div>
      </div>
      <a class="button ghost" href="/logout">Logout</a>
    </header>
    <nav class="tabs">${nav}</nav>
    ${content}
  `, { wide: true });
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

function renderShopRows(shops) {
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
          <form action="/shops/delete" method="post">
            <input type="hidden" name="shop" value="${escapeHtml(shop.shop)}">
            <button class="danger" type="submit">Entfernen</button>
          </form>
        </div>
      </div>
    `).join("")
    : `<p>Noch kein Shop verbunden.</p>`;

  return `<div class="shop-list">${shopRows}</div>`;
}

async function getFirstConnectedShop() {
  const shops = await listShopSessions();
  return shops[0]?.shop || null;
}

async function loadFirstShopData() {
  const shop = await getFirstConnectedShop();
  if (!shop) return null;

  return loadShopData(new URL(`/shop?shop=${encodeURIComponent(shop)}`, config.appUrl));
}

async function handleDashboardTab(req, res, active = "overview") {
  const session = requireSession(req, res, config);
  if (!session) return;

  if (active === "overview") return renderOverview(res, session);
  if (active === "integrations") return renderIntegrations(res, session);
  if (active === "orders") return renderOrders(res, session);
  if (active === "products") return renderProducts(res, session);
  if (active === "knowledge") return renderKnowledgeBase(res, session);
  if (active === "agents") return renderAgents(res, session);
  if (active === "conversations") return renderConversations(res, session);
  if (active === "tasks") return renderTasks(res, session);

  sendJson(res, 404, { error: "Not found" });
}

async function renderOverview(res, session) {
  const shops = await listShopSessions();
  const connectedShopData = await loadFirstShopData().catch(() => null);
  const orderCount = connectedShopData?.data.orders.edges.length || 0;
  const productCount = connectedShopData?.data.products.edges.length || 0;

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(dashboardShell({
    active: "overview",
    session,
    title: "Overview",
    content: `
      <section class="metrics">
        <div class="metric"><span>Gespräche</span><strong>0</strong><div class="meta">Noch nicht gestartet</div></div>
        <div class="metric"><span>Gelöste Anfragen</span><strong>0</strong><div class="meta">Agenten folgen</div></div>
        <div class="metric"><span>Offene Fälle</span><strong>0</strong><div class="meta">Keine Eskalationen</div></div>
        <div class="metric"><span>Aktive Agenten</span><strong>1</strong><div class="meta">MVP-Agent vorbereitet</div></div>
        <div class="metric"><span>Verb. Shops</span><strong>${shops.length}</strong><div class="meta">${productCount} Produkte · ${orderCount} Orders geladen</div></div>
      </section>
      <div class="grid">
        <section class="panel">
          <h2>Nächster Schritt</h2>
          <p>Verbinde einen Shopify-Shop, hinterlege FAQ-Wissen und konfiguriere dann den ersten Sprachassistenten.</p>
          <div class="actions">
            <a class="button" href="/dashboard/integrations">Shopify verwalten</a>
            <a class="button ghost" href="/dashboard/agents">Agent konfigurieren</a>
          </div>
        </section>
        <section class="panel">
          <h2>Datenbasis</h2>
          <p>Produkte und Bestellungen werden aktuell direkt über die Shopify Admin API gelesen.</p>
          <span class="badge">${shops.length > 0 ? "Shop verbunden" : "Kein Shop verbunden"}</span>
        </section>
      </div>
    `
  }));
}

async function renderIntegrations(res, session) {
  const shops = await listShopSessions();

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(dashboardShell({
    active: "integrations",
    session,
    title: "Integrations",
    content: `
    <div class="grid">
      <section class="panel">
        <h2>Shopify verbinden</h2>
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
      ${renderShopRows(shops)}
    </section>
    `
  }));
}

async function renderOrders(res, session) {
  const result = await loadFirstShopData().catch((error) => ({ error }));
  const rows = result?.data?.orders.edges.map(({ node }) => {
    const money = node.totalPriceSet.shopMoney;
    return `
      <tr>
        <td><strong>${escapeHtml(node.name)}</strong><div class="meta">${escapeHtml(node.id)}</div></td>
        <td>${escapeHtml(formatDate(node.createdAt))}</td>
        <td><span class="badge">${escapeHtml(node.displayFinancialStatus)}</span></td>
        <td>${escapeHtml(node.displayFulfillmentStatus)}</td>
        <td>${escapeHtml(formatMoney(money))}</td>
      </tr>
    `;
  }).join("") || "";

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(dashboardShell({
    active: "orders",
    session,
    title: "Orders",
    content: result?.error ? renderDataError(result.error) : `
      <section class="panel">
        <h2>Bestellungen ${result?.shop ? `· ${escapeHtml(result.shop)}` : ""}</h2>
        ${rows ? `
          <table class="table">
            <thead><tr><th>Bestellung</th><th>Datum</th><th>Zahlung</th><th>Fulfillment</th><th>Summe</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        ` : "<p>Keine Bestellungen gefunden.</p>"}
      </section>
    `
  }));
}

async function renderProducts(res, session) {
  const result = await loadFirstShopData().catch((error) => ({ error }));
  const rows = result?.data?.products.edges.map(({ node }) => `
    <tr>
      <td><strong>${escapeHtml(node.title)}</strong><div class="meta">${escapeHtml(node.id)}</div></td>
      <td><span class="badge">${escapeHtml(node.status)}</span></td>
      <td>${escapeHtml(formatDate(node.createdAt))}</td>
      <td>${escapeHtml(formatDate(node.updatedAt))}</td>
    </tr>
  `).join("") || "";

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(dashboardShell({
    active: "products",
    session,
    title: "Products",
    content: result?.error ? renderDataError(result.error) : `
      <section class="panel">
        <h2>Produkte ${result?.shop ? `· ${escapeHtml(result.shop)}` : ""}</h2>
        ${rows ? `
          <table class="table">
            <thead><tr><th>Produkt</th><th>Status</th><th>Erstellt</th><th>Aktualisiert</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        ` : "<p>Keine Produkte gefunden.</p>"}
      </section>
    `
  }));
}

function renderKnowledgeBase(res, session) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(dashboardShell({
    active: "knowledge",
    session,
    title: "Knowledge Base",
    content: `
      <div class="grid">
        <section class="panel">
          <h2>FAQ hinzufügen</h2>
          <form class="stack">
            <label>Frage <input placeholder="Wie lange dauert der Versand?"></label>
            <label>Antwort <textarea placeholder="Unsere Standardlieferzeit beträgt ..."></textarea></label>
            <button type="button">FAQ speichern</button>
          </form>
        </section>
        <section class="panel">
          <h2>Wissensquellen</h2>
          <p>Hier werden später FAQs, Richtlinien, Rückgabeinformationen und Markenwissen gespeichert.</p>
          <span class="badge">MVP Platzhalter</span>
        </section>
      </div>
    `
  }));
}

async function renderAgents(res, session) {
  const shops = await listShopSessions();
  const shopOptions = shops.map((shop) => `<option>${escapeHtml(shop.shop)}</option>`).join("");

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(dashboardShell({
    active: "agents",
    session,
    title: "Agents",
    content: `
      <div class="grid">
        <section class="panel">
          <h2>Sprachassistent konfigurieren</h2>
          <form class="stack">
            <label>Name <input value="Babelio Support Agent"></label>
            <label>Rolle <input value="Shopify Kundenservice"></label>
            <label>Tonalität
              <select>
                <option>Freundlich und lösungsorientiert</option>
                <option>Professionell und knapp</option>
                <option>Locker und beratend</option>
              </select>
            </label>
            <label>Verknüpfter Shop
              <select>${shopOptions || "<option>Kein Shop verbunden</option>"}</select>
            </label>
            <label>Anweisungen <textarea>Beantworte Fragen zu Bestellungen, Produkten, Versand und Retouren. Wenn du unsicher bist, eskaliere an einen Menschen.</textarea></label>
            <button type="button">Agent speichern</button>
          </form>
        </section>
        <section class="panel">
          <h2>Aktive Agenten</h2>
          <div class="shop-row">
            <div><strong>Babelio Support Agent</strong><div class="meta">Noch nicht mit Voice-Anbieter verbunden</div></div>
            <span class="badge">Draft</span>
          </div>
        </section>
      </div>
    `
  }));
}

function renderConversations(res, session) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(dashboardShell({
    active: "conversations",
    session,
    title: "Conversations",
    content: `
      <section class="panel">
        <h2>Gespräche</h2>
        <table class="table">
          <thead><tr><th>Kunde</th><th>Dauer</th><th>Ergebnis</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td colspan="4"><p>Noch keine Gespräche vorhanden.</p></td></tr>
          </tbody>
        </table>
      </section>
    `
  }));
}

function renderTasks(res, session) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(dashboardShell({
    active: "tasks",
    session,
    title: "Actions / Tasks",
    content: `
      <div class="grid">
        <section class="panel">
          <h2>Offene Aufgaben</h2>
          <p>Hier erscheinen später Rückrufe, Eskalationen, manuelle Prüfungen und Follow-ups.</p>
          <span class="badge">0 offen</span>
        </section>
        <section class="panel">
          <h2>Automationen</h2>
          <p>Folgeaktionen wie Ticket erstellen, Kundenmail senden oder Bestellung prüfen werden hier verwaltet.</p>
        </section>
      </div>
    `
  }));
}

function renderDataError(error) {
  return `
    <section class="panel">
      <h2>Daten konnten nicht geladen werden</h2>
      <p class="error">${escapeHtml(error.message)}</p>
      <p>Prüfe, ob ein Shop verbunden ist und ob die Shopify-App die Scopes <code>read_products,read_orders</code> hat.</p>
      <a class="button" href="/dashboard/integrations">Integrationen prüfen</a>
    </section>
  `;
}

async function handleDeleteShop(req, res) {
  if (!requireSession(req, res, config)) return;

  const form = await readForm(req);
  const shop = normalizeShop(form.get("shop"));

  if (shop) {
    await deleteShopSession(shop);
  }

  redirect(res, "/dashboard");
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
      <a class="button" href="/dashboard/integrations">Zurueck zu Integrations</a>
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
        orders(first: 10, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              displayFulfillmentStatus
              displayFinancialStatus
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
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

async function handleOrdersData(req, res, url) {
  if (!requireSession(req, res, config)) return;

  const { data } = await loadShopData(url);
  sendJson(res, 200, { orders: data.orders });
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

  const orders = data.orders.edges.map(({ node }) => {
    const money = node.totalPriceSet.shopMoney;

    return `
      <div class="shop-row">
        <div>
          <strong>${escapeHtml(node.name)}</strong>
          <div class="meta">${escapeHtml(node.displayFinancialStatus)} · ${escapeHtml(node.displayFulfillmentStatus)} · ${escapeHtml(node.createdAt)}</div>
        </div>
        <code>${escapeHtml(money.amount)} ${escapeHtml(money.currencyCode)}</code>
      </div>
    `;
  }).join("");

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(htmlPage(`
    <header>
      <div>
        <h1>${escapeHtml(data.shop.name)}</h1>
        <div class="meta">${escapeHtml(shop)} · ${escapeHtml(data.shop.plan?.displayName || "Plan unbekannt")}</div>
      </div>
      <a class="button ghost" href="/dashboard/integrations">Integrations</a>
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
    <section class="panel">
      <h2>Bestellungen</h2>
      <div class="shop-list">${orders || "<p>Keine Bestellungen gefunden.</p>"}</div>
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
    if (req.method === "GET" && url.pathname === "/dashboard") return await handleDashboardTab(req, res, "overview");
    if (req.method === "GET" && url.pathname.startsWith("/dashboard/")) {
      return await handleDashboardTab(req, res, url.pathname.replace("/dashboard/", ""));
    }
    if (req.method === "POST" && url.pathname === "/shops/delete") return await handleDeleteShop(req, res);
    if (req.method === "GET" && url.pathname === "/auth/shopify") return await handleAuth(req, res, url);
    if (req.method === "GET" && url.pathname === "/auth/shopify/callback") return await handleCallback(req, res, url);
    if (req.method === "GET" && url.pathname === "/api/shopify/shop") return await handleShopData(req, res, url);
    if (req.method === "GET" && url.pathname === "/api/shopify/orders") return await handleOrdersData(req, res, url);
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
