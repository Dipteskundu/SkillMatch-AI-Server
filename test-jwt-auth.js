// Self-check for JWT auth + the /api gate. Requires the server to be running:
//   node index.js            (in another terminal)
//   node test-jwt-auth.js
import jwt from "jsonwebtoken";

const BASE = process.env.BASE || "http://localhost:5001";
const SECRET = process.env.JWT_SECRET || "jobmatch-jwt-secret-change-in-production";

const call = async (path, token) => {
  const res = await fetch(BASE + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.status;
};

const login = async (email) => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: email }),
  });
  const json = await res.json();
  return json.token;
};

const checks = [
  ["guest can list jobs", await call("/api/jobs"), 200],
  ["missing token is rejected", await call("/api/admin/users"), 401],
];

const admin = await login("admin@manager.com");
const candidate = await login("dipteskundu6@gmail.com");

checks.push(
  ["admin reaches admin route", await call("/api/admin/users", admin), 200],
  ["candidate is blocked from admin route", await call("/api/admin/users", candidate), 403],
  [
    "token signed with another secret is rejected",
    await call("/api/admin/users", jwt.sign({ uid: "x", role: "admin" }, "wrong")),
    401,
  ],
  [
    "expired token is rejected",
    await call("/api/admin/users", jwt.sign({ uid: "x", role: "admin" }, SECRET, { expiresIn: -10 })),
    401,
  ],
);

let failed = 0;
for (const [name, actual, expected] of checks) {
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} (got ${actual}, want ${expected})`);
}
process.exitCode = failed ? 1 : 0;
