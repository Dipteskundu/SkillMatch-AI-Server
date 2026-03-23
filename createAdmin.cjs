const admin = require("firebase-admin");
const path = require("path");

const serviceAccountPath = path.join(
  __dirname,
  "jobmatching-firebase-adminsdk-.json",
);
let serviceAccount;
try {
  serviceAccount = require(serviceAccountPath);
} catch (err) {
  console.error("Could not load service account JSON at", serviceAccountPath);
  console.error(err.message);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const email = process.env.ADMIN_EMAIL || "admin@admin.com";
const password = process.env.ADMIN_PASSWORD || "admin";

async function ensureAdmin(email, password) {
  try {
    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
      console.log("User exists:", user.uid);
    } catch (e) {
      console.log("User not found, creating:", email);
      user = await admin.auth().createUser({ email, password });
      console.log("Created user:", user.uid);
    }

    const currentClaims =
      (await admin.auth().getUser(user.uid)).customClaims || {};
    if (currentClaims.role === "admin") {
      console.log("User already has admin role.");
    } else {
      await admin.auth().setCustomUserClaims(user.uid, { role: "admin" });
      console.log("Set admin claim for", email);
    }

    console.log("Done. You can now sign in as", email);
    process.exit(0);
  } catch (err) {
    console.error("Error ensuring admin:", err);
    process.exit(1);
  }
}

ensureAdmin(email, password);
