import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { matches, commentary } from "./db/schema.js";
import { eq } from "drizzle-orm";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
const db = drizzle(pool);

async function setup() {
  console.log("🏏 Setting up LIVE International Cricket Matches...\n");

  const now = new Date();

  // Define the prime Live International matches
  const primeMatches = [
    {
      externalId: "sm_intl_live_1",
      sport: "International Cricket",
      homeTeam: "India",
      awayTeam: "Australia",
      status: "live",
      startTime: new Date(now.getTime() - 90 * 60000), // started 90 mins ago
      endTime: null,
      homeScore: 174,
      awayScore: 162,
    },
    {
      externalId: "sm_intl_live_2",
      sport: "International Cricket",
      homeTeam: "New Zealand",
      awayTeam: "India",
      status: "live",
      startTime: new Date(now.getTime() - 60 * 60000), // started 60 mins ago
      endTime: null,
      homeScore: 189,
      awayScore: 185,
    },
    {
      externalId: "sm_intl_live_3",
      sport: "International Cricket",
      homeTeam: "Australia",
      awayTeam: "England",
      status: "live",
      startTime: new Date(now.getTime() - 45 * 60000),
      endTime: null,
      homeScore: 156,
      awayScore: 148,
    },
  ];

  for (const m of primeMatches) {
    const existing = await db
      .select()
      .from(matches)
      .where(eq(matches.externalId, m.externalId))
      .limit(1);

    let matchId;
    if (existing.length > 0) {
      const [updated] = await db
        .update(matches)
        .set(m)
        .where(eq(matches.id, existing[0].id))
        .returning();
      matchId = updated.id;
      console.log(`  Updated live match: ${m.homeTeam} vs ${m.awayTeam} (ID: ${matchId})`);
    } else {
      const [created] = await db.insert(matches).values(m).returning();
      matchId = created.id;
      console.log(`  Created live match: ${m.homeTeam} vs ${m.awayTeam} (ID: ${matchId})`);
    }

    // Add initial commentary
    const existingCommentary = await db
      .select({ id: commentary.id })
      .from(commentary)
      .where(eq(commentary.matchId, matchId))
      .limit(1);

    if (existingCommentary.length === 0) {
      const initialComments = [
        {
          matchId,
          minute: 0,
          sequence: 1,
          period: "live",
          eventType: "ball",
          actor: "Rohit Sharma",
          team: m.homeTeam,
          message: "Over 16.1: Single taken into the covers. Rohit Sharma rotates strike.",
          metadata: { over: "16.1", runs: 1, batsman: "Rohit Sharma", bowler: "Mitchell Starc" },
          tags: ["international", "live", "t20i"],
        },
        {
          matchId,
          minute: 0,
          sequence: 2,
          period: "live",
          eventType: "ball",
          actor: "Virat Kohli",
          team: m.homeTeam,
          message: "Over 16.2: FOUR! Magnificent inside-out loft over extra cover by Virat Kohli!",
          metadata: { over: "16.2", runs: 4, batsman: "Virat Kohli", bowler: "Mitchell Starc" },
          tags: ["international", "live", "boundary"],
        },
        {
          matchId,
          minute: 0,
          sequence: 3,
          period: "live",
          eventType: "ball",
          actor: "Virat Kohli",
          team: m.homeTeam,
          message: "Over 16.3: SIX! High into the night sky, clears the long-on boundary easily!",
          metadata: { over: "16.3", runs: 6, batsman: "Virat Kohli", bowler: "Mitchell Starc" },
          tags: ["international", "live", "six"],
        },
      ];

      await db.insert(commentary).values(initialComments);
      console.log(`     Added initial commentary for ${m.homeTeam} vs ${m.awayTeam}`);
    }
  }

  console.log("\n✅ LIVE International matches initialized successfully!\n");
  await pool.end();
}

setup().catch(console.error);
