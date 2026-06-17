# Babelio Shopify API Starter

Minimaler OAuth- und Read-only-Connector fuer eine SaaS-App, die Shopify-Shops verbinden und erste Admin-Daten auslesen soll.

## Was enthalten ist

- `GET /login` schuetzt das Dashboard mit E-Mail/Passwort aus Environment Variables.
- `GET /dashboard` zeigt die Overview mit MVP-Kennzahlen.
- `GET /dashboard/integrations` verwaltet Shopify-Shops und spaetere Integrationen.
- `GET /dashboard/orders` zeigt Bestellungen aus dem verbundenen Shop.
- `GET /dashboard/products` zeigt Produkte aus dem verbundenen Shop.
- `GET /dashboard/knowledge` bereitet FAQ- und Wissensverwaltung fuer Agenten vor.
- `GET /dashboard/agents` enthaelt die erste Konfigurationsmaske fuer Sprachassistenten.
- `GET /dashboard/conversations` bereitet die Gespraechsuebersicht vor.
- `GET /dashboard/tasks` bereitet Follow-ups, Rueckrufe und Eskalationen vor.
- `POST /shops/delete` entfernt einen verbundenen Shop aus dem lokalen Dashboard-Speicher.
- `GET /auth/shopify?shop=dein-shop.myshopify.com` startet den Shopify-OAuth-Flow.
- `GET /auth/shopify/callback` validiert `state` und Shopify-HMAC, tauscht den Code gegen ein Access Token.
- `GET /shop?shop=dein-shop.myshopify.com` zeigt erste Shop- und Produktdaten im Dashboard.
- `GET /api/shopify/shop?shop=dein-shop.myshopify.com` liest Shop- und Produktdaten per Admin GraphQL API.
- `GET /api/shopify/orders?shop=dein-shop.myshopify.com` liest die letzten Bestellungen per Admin GraphQL API.
- `GET /api/shops` listet verbundene Shops ohne Access Tokens.

## Shopify App konfigurieren

1. Erstelle im Shopify Partner Dashboard eine App.
2. Setze die App URL auf deine oeffentliche URL, zum Beispiel eine ngrok/cloudflared URL.
3. Fuege als Allowed redirection URL hinzu:

   ```text
   https://deine-url.example.com/auth/shopify/callback
   ```

4. Kopiere `.env.example` nach `.env` und setze:

   ```text
   SHOPIFY_CLIENT_ID=...
   SHOPIFY_CLIENT_SECRET=...
   APP_URL=https://deine-url.example.com
   ADMIN_EMAIL=du@example.com
   ADMIN_PASSWORD=ein-sicheres-passwort
   SESSION_SECRET=ein-langer-zufaelliger-string
   ```

## Lokal starten

```bash
npm run dev
```

Danach oeffnest du `http://localhost:3000` und gibst deinen Shop ein.

## Online auf Render hosten

1. Push dieses Repository zu GitHub.
2. Oeffne Render und erstelle einen neuen **Web Service** aus dem GitHub-Repository.
3. Nutze:

   ```text
   Build Command:
   Start Command: npm start
   ```

   Das Build Command kann leer bleiben, weil keine Dependencies installiert werden muessen.

4. Setze in Render diese Environment Variables:

   ```text
   SHOPIFY_CLIENT_ID=...
   SHOPIFY_CLIENT_SECRET=...
   SHOPIFY_SCOPES=read_products,read_orders
   SHOPIFY_API_VERSION=2026-04
   APP_URL=https://deine-render-app.onrender.com
   ADMIN_EMAIL=du@example.com
   ADMIN_PASSWORD=ein-sicheres-passwort
   SESSION_SECRET=ein-langer-zufaelliger-string
   ```

5. Trage im Shopify Dev Dashboard diese URLs ein:

   ```text
   App URL:
   https://deine-render-app.onrender.com

   Allowed redirection URL:
   https://deine-render-app.onrender.com/auth/shopify/callback
   ```

6. Nach dem Deploy oeffnest du:

   ```text
   https://deine-render-app.onrender.com/login
   ```

## Hinweise fuer Produktion

- Die Datei `data/shops.json` ist nur fuer lokale Entwicklung gedacht. In Produktion gehoeren Access Tokens verschluesselt in eine Datenbank.
- Auf Render Free ist das Dateisystem nicht dauerhaft. Fuer echte Nutzung brauchen wir als naechsten Schritt eine Datenbank, z. B. Supabase Postgres.
- `read_orders` liefert standardmaessig Bestellungen der letzten 60 Tage. Fuer aeltere Bestellungen braucht eine Shopify-App zusaetzliche Freigaben.
- Fordere nur die Scopes an, die du wirklich brauchst. Der Starter nutzt `read_products,read_orders`.
- Die Admin API-Version steht bewusst fest auf `2026-04`, weil das im Juni 2026 die stabile Version ist. Aktualisiere sie quartalsweise.
- Wenn die App eingebettet im Shopify Admin laufen soll, ist Shopifys Managed Installation/Token Exchange Flow der modernere Weg. Dieser Starter ist fuer einen standalone SaaS-Connect-Flow gedacht.
