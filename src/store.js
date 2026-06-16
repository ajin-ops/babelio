import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const SHOP_FILE = path.join(DATA_DIR, "shops.json");

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonFile(file, value) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function upsertShopSession(session) {
  const shops = await readJsonFile(SHOP_FILE, {});
  shops[session.shop] = {
    ...shops[session.shop],
    ...session,
    updatedAt: new Date().toISOString()
  };

  await writeJsonFile(SHOP_FILE, shops);
  return shops[session.shop];
}

export async function getShopSession(shop) {
  const shops = await readJsonFile(SHOP_FILE, {});
  return shops[shop] || null;
}

export async function listShopSessions() {
  const shops = await readJsonFile(SHOP_FILE, {});
  return Object.values(shops).map(({ accessToken, ...safeShop }) => safeShop);
}
