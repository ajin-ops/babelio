import { readFileSync } from "node:fs";

function loadDotEnv() {
  try {
    const lines = readFileSync(".env", "utf8").split(/\r?\n/);

    for (const line of lines) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);

      if (!match || process.env[match[1]]) continue;

      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function getConfig() {
  loadDotEnv();

  const required = [
    "SHOPIFY_CLIENT_ID",
    "SHOPIFY_CLIENT_SECRET",
    "APP_URL",
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD",
    "SESSION_SECRET"
  ];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    appUrl: process.env.APP_URL.replace(/\/$/, ""),
    clientId: process.env.SHOPIFY_CLIENT_ID,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
    scopes: process.env.SHOPIFY_SCOPES || "read_products,read_orders",
    apiVersion: process.env.SHOPIFY_API_VERSION || "2026-04",
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD,
    sessionSecret: process.env.SESSION_SECRET,
    port: Number(process.env.PORT || 3000)
  };
}
