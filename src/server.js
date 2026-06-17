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

function htmlPage(body, { app = false } = {}) {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Babelio AI</title>
  <style>
    :root { color-scheme: dark; --bg: #07090d; --surface: #0f1218; --panel: #11151d; --panel-2: #171b23; --border: #252b36; --muted: #8391a8; --ink: #f4f7fb; --soft: #c3cce0; --blue: #3b82f6; --blue-soft: #10234a; --green: #21d69b; --red: #ef4444; --yellow: #f8c846; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { min-height: 100vh; }
    main.auth { width: min(760px, calc(100% - 32px)); margin: 46px auto; min-height: auto; }
    .app-shell { display: grid; grid-template-columns: 216px minmax(0, 1fr); min-height: 100vh; }
    .sidebar { position: sticky; top: 0; height: 100vh; border-right: 1px solid var(--border); background: #0b0e14; display: flex; flex-direction: column; }
    .brand { display: flex; align-items: center; gap: 10px; height: 58px; padding: 0 16px; border-bottom: 1px solid var(--border); font-weight: 800; }
    .brand-mark { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px; background: var(--blue); color: white; font-weight: 900; }
    .side-nav { display: grid; gap: 7px; padding: 18px 8px; }
    .side-nav a { display: flex; align-items: center; gap: 11px; min-height: 40px; padding: 9px 12px; color: var(--soft); border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 700; }
    .side-nav a.active { color: #60a5fa; background: #111b31; outline: 2px solid #d8e8ff; outline-offset: -2px; }
    .nav-icon { width: 18px; color: #8fa0ba; text-align: center; font-size: 13px; }
    .sidebar-footer { margin-top: auto; padding: 14px; border-top: 1px solid var(--border); }
    .content { min-width: 0; }
    .topbar { height: 58px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 28px; }
    .page { padding: 28px; }
    h1 { margin: 0; font-size: 18px; line-height: 1.2; letter-spacing: 0; }
    h2 { margin: 0 0 14px; font-size: 15px; }
    p { color: var(--muted); line-height: 1.5; margin: 0 0 12px; }
    .subtitle { color: var(--muted); font-size: 12px; margin-top: 6px; }
    .panel, .shop-row, .metric, .agent-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
    .panel { padding: 22px; margin-bottom: 22px; }
    .stack { display: grid; gap: 12px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }
    .metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; margin-bottom: 22px; }
    .metric { padding: 18px; min-height: 114px; }
    .metric strong { display: block; font-size: 25px; margin: 14px 0 6px; }
    .metric span { color: var(--muted); font-size: 12px; font-weight: 700; }
    .delta { color: var(--green); font-size: 12px; font-weight: 800; }
    label { display: grid; gap: 7px; color: var(--soft); font-size: 13px; font-weight: 700; }
    input, textarea, select { width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 7px; color: var(--ink); font: inherit; background: var(--panel-2); }
    textarea { min-height: 120px; resize: vertical; }
    button, a.button { display: inline-flex; align-items: center; justify-content: center; min-height: 38px; padding: 9px 14px; border: 0; border-radius: 7px; background: var(--blue); color: white; font: inherit; font-weight: 800; text-decoration: none; cursor: pointer; }
    button:hover, a.button:hover { background: #2563eb; }
    .ghost { background: transparent !important; color: var(--ink) !important; border: 1px solid var(--border) !important; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .actions form { margin: 0; }
    .shop-list { display: grid; gap: 10px; }
    .shop-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px; }
    .table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .table th, .table td { border-bottom: 1px solid var(--border); padding: 12px; text-align: left; vertical-align: top; }
    .table th { color: var(--muted); background: var(--surface); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
    .table tr:last-child td { border-bottom: 0; }
    .badge { display: inline-flex; padding: 4px 8px; border-radius: 999px; background: rgba(33, 214, 155, .12); color: var(--green); border: 1px solid rgba(33, 214, 155, .25); font-size: 12px; font-weight: 800; }
    .badge.draft { background: #1c2330; color: var(--soft); border-color: var(--border); }
    .badge.red { background: rgba(239, 68, 68, .12); color: #ff8b8b; border-color: rgba(239, 68, 68, .28); }
    .meta { color: var(--muted); font-size: 13px; margin-top: 4px; }
    code { background: var(--panel-2); color: var(--soft); padding: 2px 5px; border-radius: 4px; }
    pre { overflow: auto; background: #101828; color: #eef6ff; border-radius: 8px; padding: 18px; }
    .error { color: #ffb4b4; background: rgba(239, 68, 68, .12); border: 1px solid rgba(239, 68, 68, .32); border-radius: 6px; padding: 10px 12px; }
    .danger { background: #7f1d1d; }
    .danger:hover { background: #991b1b; }
    .chart { height: 250px; border-top: 1px dashed #1e293b; margin-top: 20px; position: relative; background: linear-gradient(180deg, rgba(59,130,246,.08), rgba(33,214,155,.04)); border-radius: 6px; overflow: hidden; }
    .chart svg { width: 100%; height: 100%; display: block; }
    .search { margin-bottom: 20px; }
    .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 86px; }
    .chip { padding: 8px 13px; border-radius: 999px; background: var(--panel-2); color: var(--muted); font-size: 12px; font-weight: 700; }
    .empty-state { display: grid; place-items: center; text-align: center; min-height: 280px; color: var(--muted); }
    .agent-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .agent-card { padding: 18px; min-height: 186px; }
    .agent-head { display: flex; justify-content: space-between; gap: 12px; align-items: start; margin-bottom: 18px; }
    .avatar { width: 38px; height: 38px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; background: #10234a; color: #60a5fa; font-weight: 900; }
    .agent-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; padding-top: 14px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; }
    .billing-plans { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
    .plan { border: 1px solid var(--border); border-radius: 9px; padding: 14px; text-align: center; background: var(--surface); }
    .plan.active { border-color: var(--blue); background: #0f172a; }
    .progress { height: 7px; background: #1a1f2a; border-radius: 999px; overflow: hidden; }
    .progress span { display: block; height: 100%; width: 28%; background: var(--blue); }
    @media (max-width: 980px) { .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 980px) { .app-shell { grid-template-columns: 1fr; } .sidebar { position: static; height: auto; } .side-nav { grid-template-columns: repeat(2, minmax(0, 1fr)); } .sidebar-footer { display: none; } .agent-grid, .billing-plans { grid-template-columns: 1fr; } }
    @media (max-width: 780px) { .page { padding: 18px; } .topbar { padding: 0 18px; } header, .shop-row { align-items: stretch; flex-direction: column; } .grid, .metrics { grid-template-columns: 1fr; } .actions { width: 100%; } button, a.button { width: 100%; } .table { display: block; overflow-x: auto; } }
  </style>
</head>
<body><main class="${app ? "" : "auth"}">${body}</main></body>
</html>`;
}

const tabs = [
  ["overview", "Overview", "grid"],
  ["integrations", "Shop Integrations", "shop"],
  ["knowledge", "Knowledge Base", "book"],
  ["agents", "Agents", "bot"],
  ["conversations", "Conversations", "chat"],
  ["tasks", "Actions", "list"],
  ["billing", "Billing", "card"]
];

function dashboardUrl(tab) {
  return tab === "overview" ? "/dashboard" : `/dashboard/${tab}`;
}

function dashboardShell({ active, session, title, content }) {
  const nav = tabs.map(([id, label, icon]) => `
    <a class="${id === active ? "active" : ""}" href="${dashboardUrl(id)}">${escapeHtml(label)}</a>
  `).join("");

  return htmlPage(`
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">B</span><span>Babelio AI</span></div>
        <nav class="side-nav">${tabs.map(([id, label, icon]) => `
          <a class="${id === active ? "active" : ""}" href="${dashboardUrl(id)}"><span class="nav-icon">${escapeHtml(icon)}</span>${escapeHtml(label)}</a>
        `).join("")}</nav>
        <div class="sidebar-footer"><a class="button ghost" href="/logout">Logout</a></div>
      </aside>
      <section class="content">
        <div class="topbar">
          <div>
            <h1>${escapeHtml(title)}</h1>
            <div class="subtitle">${escapeHtml(session.email)}</div>
          </div>
        </div>
        <div class="page">${content}</div>
      </section>
    </div>
  `, { app: true });
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
  if (active === "billing") return renderBilling(res, session);

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
        <div class="metric"><span>Total Calls Today</span><strong>284</strong><div class="delta">+18.2%</div></div>
        <div class="metric"><span>AI Resolution Rate</span><strong>91.4%</strong><div class="delta">+4.1%</div></div>
        <div class="metric"><span>Human Escalation</span><strong>8.6%</strong><div class="delta">-2.3%</div></div>
        <div class="metric"><span>Active Returns</span><strong>${orderCount}</strong><div class="meta">from Shopify orders</div></div>
        <div class="metric"><span>Connected Shops</span><strong>${shops.length}</strong><div class="meta">${productCount} Produkte geladen</div></div>
      </section>
      <section class="panel">
        <h2>Call Activity</h2>
        <div class="meta">Total calls vs. AI-resolved · last 7 days</div>
        <div class="chart">
          <svg viewBox="0 0 1000 240" preserveAspectRatio="none" aria-label="Call activity chart">
            <path d="M0 165 C120 145 190 140 280 152 C360 164 430 158 520 126 C640 82 730 94 780 92 C845 92 865 168 1000 190" fill="none" stroke="#3b82f6" stroke-width="3"/>
            <path d="M0 180 C120 160 190 158 280 166 C360 176 430 170 520 142 C640 100 730 108 780 106 C845 106 865 182 1000 198" fill="none" stroke="#21d69b" stroke-width="3"/>
            <path d="M0 180 C120 160 190 158 280 166 C360 176 430 170 520 142 C640 100 730 108 780 106 C845 106 865 182 1000 198 L1000 240 L0 240 Z" fill="rgba(33,214,155,.10)"/>
          </svg>
        </div>
      </section>
      <section class="metrics">
        <div class="metric"><span>Avg. Call Duration</span><strong>4:47 min</strong><div class="meta">-8% vs last week</div></div>
        <div class="metric"><span>Customer Satisfaction</span><strong>4.8 / 5.0</strong><div class="meta">+0.2 vs last month</div></div>
        <div class="metric"><span>Active Agents</span><strong>4 of 5</strong><div class="meta">1 agent in draft</div></div>
      </section>
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
    <div class="subtitle">Connect Shopify stores and manage available data sources</div>
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
      <input class="search" placeholder="FAQ durchsuchen...">
      <div class="chips">
        <span class="chip">All</span><span class="chip">Shipping</span><span class="chip">Returns</span><span class="chip">Products</span><span class="chip">Payment</span><span class="chip">General</span>
      </div>
      <section class="empty-state">
        <div>
          <h2>Keine FAQs vorhanden</h2>
          <p>Füge deine erste FAQ hinzu.</p>
          <button type="button">FAQ hinzufügen</button>
        </div>
      </section>
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
      <div class="actions" style="justify-content: space-between; margin-bottom: 22px;">
        <div class="meta">4 active agents · ${shops[0]?.shop || "No shop linked"}</div>
        <button type="button">Create Agent</button>
      </div>
      <div class="agent-grid">
        ${renderAgentCard("M", "Milo", "Support", "Friendly & empathetic", "GPT-4o", "Aria", "German / English", "22 FAQs", "active")}
        ${renderAgentCard("L", "Luna", "Retouren", "Understanding & solution-focused", "GPT-4o", "Rachel", "German", "14 FAQs", "active")}
        ${renderAgentCard("R", "Rex", "Product Advisor", "Knowledgeable & enthusiastic", "GPT-4o mini", "Josh", "German / English", "18 FAQs", "active")}
        ${renderAgentCard("N", "Nova", "FAQ Agent", "Concise & precise", "GPT-4o mini", "Bella", "German / English / French", "30 FAQs", "active")}
        ${renderAgentCard("S", "Scout", "Sales", "Engaging & persuasive", "GPT-4o", "Adam", "German", "0 FAQs", "draft")}
      </div>
    `
  }));
}

function renderAgentCard(initial, name, role, tone, model, voice, language, faqs, status) {
  return `
    <article class="agent-card">
      <div class="agent-head">
        <div class="actions">
          <span class="avatar">${escapeHtml(initial)}</span>
          <div><strong>${escapeHtml(name)}</strong><div class="meta">${escapeHtml(role)}</div></div>
        </div>
        <span class="badge ${status === "draft" ? "draft" : ""}">${status === "draft" ? "Entwurf" : "Aktiv"}</span>
      </div>
      <p><em>"${escapeHtml(tone)}"</em></p>
      <div class="agent-meta">
        <span>${escapeHtml(model)}</span><span>${escapeHtml(voice)}</span>
        <span>${escapeHtml(language)}</span><span>${escapeHtml(faqs)}</span>
        <span>${status === "draft" ? "No shop linked" : "Shop linked"}</span><span></span>
      </div>
    </article>
  `;
}

function renderConversations(res, session) {
  const rows = [
    ["Lena Maier", "Where is my order?", "Milo", "Anruf", "3:12", "Resolved", "Positive"],
    ["Lukas Förster", "Return request - wrong product", "Luna", "Anruf", "5:48", "Resolved", "Neutral"],
    ["Sophie Bauer", "Is this product grain-free?", "Rex", "Anruf", "6:20", "Resolved", "Positive"],
    ["Tom Richter", "Can I change my shipping address?", "Milo", "Anruf", "9:33", "Escalated", "Negative"],
    ["Clara Hoffmann", "Return - package damaged", "Luna", "Anruf", "4:05", "Resolved", "Neutral"],
    ["Hannah Meyer", "Which food for senior Labrador?", "Rex", "Anruf", "7:14", "Resolved", "Positive"],
    ["Kai Becker", "Shipping time to Austria?", "Nova", "Anruf", "2:33", "Resolved", "Positive"],
    ["Emma Lange", "Return status update", "Luna", "Anruf", "4:52", "Resolved", "Neutral"]
  ].map(([customer, topic, agent, type, duration, status, sentiment]) => `
    <tr>
      <td><strong>${customer}</strong><div class="meta">${topic}</div></td>
      <td>${agent}</td>
      <td>${type}</td>
      <td>${duration}</td>
      <td><span class="badge ${status === "Escalated" ? "red" : ""}">${status}</span></td>
      <td>${sentiment}</td>
    </tr>
  `).join("");

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(dashboardShell({
    active: "conversations",
    session,
    title: "Conversations",
    content: `
      <section class="metrics" style="grid-template-columns: repeat(4, minmax(0, 1fr));">
        <div class="metric"><span>Total</span><strong>8</strong></div>
        <div class="metric"><span>Resolved</span><strong>7</strong></div>
        <div class="metric"><span>Escalated</span><strong>1</strong></div>
        <div class="metric"><span>AI Rate</span><strong>88%</strong></div>
      </section>
      <section class="panel">
        <table class="table">
          <thead><tr><th>Customer / Topic</th><th>Agent</th><th>Type</th><th>Duration</th><th>Status</th><th>Sentiment</th></tr></thead>
          <tbody>${rows}</tbody>
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

function renderBilling(res, session) {
  const invoices = [
    ["Token-Kauf: 350.000 Tokens", "02.05.2026 · Manuell", "350.000", "INV-1777724992154", "250.00 €"],
    ["Token-Kauf: 130.000 Tokens", "26.04.2026 · Manuell", "130.000", "INV-1777243591823", "100.00 €"],
    ["Token-Kauf: 60.000 Tokens", "20.04.2026 · Manuell", "60.000", "INV-1776815044421", "50.00 €"]
  ].map(([description, date, tokens, invoice, amount]) => `
    <tr>
      <td><strong>${description}</strong><div class="meta">${date}</div></td>
      <td><strong>${tokens}</strong></td>
      <td><code>${invoice}</code></td>
      <td><strong>${amount}</strong></td>
      <td><span class="badge draft">paid</span></td>
    </tr>
  `).join("");

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(dashboardShell({
    active: "billing",
    session,
    title: "Billing & Tokens",
    content: `
      <div class="grid">
        <section class="panel">
          <div class="meta">TOKEN-GUTHABEN</div>
          <h1 style="font-size: 34px; margin-top: 22px;">1.180.000</h1>
          <p>verfügbare Tokens</p>
          <div style="display:flex; justify-content:space-between; margin-top:80px; font-size:12px;"><span class="meta">Diesen Monat ausgegeben</span><strong>850.00 € / 5000 €</strong></div>
          <div class="progress"><span></span></div>
        </section>
        <section class="panel">
          <h2>Tokens kaufen</h2>
          <div class="billing-plans">
            <div class="plan"><strong>10 €</strong><div class="meta">10k Tokens<br>Starter</div></div>
            <div class="plan"><strong>25 €</strong><div class="meta">28k Tokens<br>Basic</div></div>
            <div class="plan active"><strong>50 €</strong><div class="meta">60k Tokens<br>Pro</div></div>
            <div class="plan"><strong>100 €</strong><div class="meta">130k Tokens<br>Business</div></div>
            <div class="plan"><strong>250 €</strong><div class="meta">350k Tokens<br>Enterprise</div></div>
          </div>
          <div class="actions" style="justify-content: space-between; margin-top: 22px; border-top: 1px solid var(--border); padding-top: 18px;">
            <div><div class="meta">Du erhältst</div><strong>60.000 Tokens für 50.00 €</strong></div>
            <button type="button">50.00 € kaufen</button>
          </div>
        </section>
      </div>
      <section class="panel">
        <h2>Automatisches Nachladen</h2>
        <p>Lade automatisch Tokens nach, wenn dein Guthaben niedrig wird.</p>
        <div class="grid">
          <label>Nachladen wenn unter (€)<input value="100"></label>
          <label>Betrag zum Nachladen (€)<input value="500"></label>
        </div>
      </section>
      <section class="panel">
        <h2>Rechnungen</h2>
        <table class="table">
          <thead><tr><th>Beschreibung</th><th>Tokens</th><th>Rechnungs-Nr.</th><th>Betrag</th><th>Status</th></tr></thead>
          <tbody>${invoices}</tbody>
        </table>
      </section>
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
