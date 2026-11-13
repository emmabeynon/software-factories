// One-off: introduce every existing user to Notifications. Sends name, email and
// avatar, and writes the default preferences only for users who have none, so it
// is safe to re-run. Needs KNOCK_SECRET_API_KEY in .env; without it, it only logs.
//
//   npm run notifications:backfill
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../app/db/schema";
import {
  defaultNotifications,
  introduceToNotifications,
} from "../app/lib/notifications.server";

const db = drizzle(new Database("data.db"), { schema });
const port = await defaultNotifications();
const everyone = db.select().from(schema.users).all();

console.log(`Syncing ${everyone.length} users via the ${port.adapter} adapter...`);
for (const user of everyone) {
  await introduceToNotifications(user);
}
console.log("Done.");
