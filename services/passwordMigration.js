// One-time bridge for accounts that were created under Firebase Auth and have
// no password hash. Only the demo accounts listed on the sign-in page get a
// default password (email === password); every other account must register or
// reset, so we never invent credentials for real users.
import bcrypt from "bcrypt";

const DEMO_PASSWORDS = {
  "admin@manager.com": "admin@manager.com",
  "diptesemon@gmail.com": "diptesemon@gmail.com",
  "dipteskundu6@gmail.com": "dipteskundu6@gmail.com",
};

let migrated = false;

export async function migrateDemoPasswords(db) {
  if (migrated) return;
  migrated = true;

  const users = db.collection("users");
  for (const [email, password] of Object.entries(DEMO_PASSWORDS)) {
    const user = await users.findOne({ email });
    if (!user) continue;
    if (typeof user.password === "string" && user.password.startsWith("$2")) continue;
    const hash = await bcrypt.hash(password, 10);
    await users.updateOne({ _id: user._id }, { $set: { password: hash } });
    console.log(`Seeded demo password for ${email}`);
  }
}
