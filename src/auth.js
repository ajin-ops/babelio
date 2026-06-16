import crypto from "node:crypto";

const SESSION_COOKIE = "babelio_session";
const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right || "");

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSessionCookie(email, config) {
  const payload = base64Url(JSON.stringify({
    email,
    expiresAt: Date.now() + ONE_WEEK_SECONDS * 1000
  }));
  const signature = sign(payload, config.sessionSecret);

  return cookieHeader(SESSION_COOKIE, `${payload}.${signature}`, config, ONE_WEEK_SECONDS);
}

export function clearSessionCookie(config) {
  return cookieHeader(SESSION_COOKIE, "", config, 0);
}

export function cookieHeader(name, value, config, maxAgeSeconds) {
  const secure = config.appUrl.startsWith("https://") ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function readCookie(req, name) {
  const cookies = req.headers.cookie?.split(";").map((part) => part.trim()) || [];
  const found = cookies.find((part) => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

export function getSession(req, config) {
  const raw = readCookie(req, SESSION_COOKIE);
  if (!raw) return null;

  const [payload, signature] = raw.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload, config.sessionSecret))) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function requireSession(req, res, config) {
  const session = getSession(req, config);

  if (!session) {
    res.writeHead(302, { "Location": "/login" });
    res.end();
    return null;
  }

  return session;
}

export function credentialsMatch(email, password, config) {
  return email === config.adminEmail && password === config.adminPassword;
}
