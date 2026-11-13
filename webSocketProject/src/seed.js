import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { matches, commentary } from "./db/schema.js";
import { eq } from "drizzle-orm";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
const db = drizzle(pool);

const now = new Date();

// Realistic cricket match data
const seedMatches = [
  {
    externalId: "sm_seed_1",
    sport: "Cricket",
    homeTeam: "India",
    awayTeam: "Australia",
    status: "live",
    startTime: new Date(now.getTime() - 3 * 3600000), // started 3 hours ago
    endTime: null,
    homeScore: 287,
    awayScore: 194,
  },
  {
    externalId: "sm_seed_2",
    sport: "Cricket",
    homeTeam: "England",
    awayTeam: "South Africa",
    status: "live",
    startTime: new Date(now.getTime() - 2 * 3600000),
    endTime: null,
    homeScore: 156,
    awayScore: 142,
  },
  {
    externalId: "sm_seed_3",
    sport: "Cricket",
    homeTeam: "Pakistan",
    awayTeam: "New Zealand",
    status: "live",
    startTime: new Date(now.getTime() - 1.5 * 3600000),
    endTime: null,
    homeScore: 203,
    awayScore: 89,
  },
  {
    externalId: "sm_seed_4",
    sport: "Cricket",
    homeTeam: "West Indies",
    awayTeam: "Sri Lanka",
    status: "scheduled",
    startTime: new Date(now.getTime() + 2 * 3600000), // 2 hours from now
    endTime: null,
    homeScore: 0,
    awayScore: 0,
  },
  {
    externalId: "sm_seed_5",
    sport: "Cricket",
    homeTeam: "Bangladesh",
    awayTeam: "Afghanistan",
    status: "scheduled",
    startTime: new Date(now.getTime() + 5 * 3600000),
    endTime: null,
    homeScore: 0,
    awayScore: 0,
  },
  {
    externalId: "sm_seed_6",
    sport: "Cricket",
    homeTeam: "Mumbai Indians",
    awayTeam: "Chennai Super Kings",
    status: "live",
    startTime: new Date(now.getTime() - 1 * 3600000),
    endTime: null,
    homeScore: 145,
    awayScore: 112,
  },
  {
    externalId: "sm_seed_7",
    sport: "Cricket",
    homeTeam: "Royal Challengers",
    awayTeam: "Kolkata Knight Riders",
    status: "finished",
    startTime: new Date(now.getTime() - 24 * 3600000),
    endTime: new Date(now.getTime() - 20 * 3600000),
    homeScore: 189,
    awayScore: 176,
  },
  {
    externalId: "sm_seed_8",
    sport: "Cricket",
    homeTeam: "Delhi Capitals",
    awayTeam: "Rajasthan Royals",
    status: "finished",
    startTime: new Date(now.getTime() - 48 * 3600000),
    endTime: new Date(now.getTime() - 44 * 3600000),
    homeScore: 167,
    awayScore: 171,
  },
];

const commentaryTemplates = [
  { eventType: "ball", message: "Over 12.3: FOUR! Brilliant cover drive.", actor: "Virat Kohli", team: "India" },
  { eventType: "wicket", message: "Over 15.1: WICKET! Caught at slip. Excellent delivery.", actor: "Pat Cummins", team: "Australia" },
  { eventType: "ball", message: "Over 8.5: SIX! Massive hit over long-on!", actor: "Rohit Sharma", team: "India" },
  { eventType: "ball", message: "Over 20.0: Dot ball. Tight bowling.", actor: "Mitchell Starc", team: "Australia" },
  { eventType: "ball", message: "Over 3.2: Single taken. Good running between wickets.", actor: "KL Rahul", team: "India" },
  { eventType: "score_update", message: "India 287/4 - Australia 194/6. India leading by 93 runs.", actor: null, team: null },
  { eventType: "ball", message: "Over 18.4: FOUR! Swept fine. Racing to the boundary.", actor: "Joe Root", team: "England" },
  { eventType: "wicket", message: "Over 11.2: WICKET! Bowled through the gate! Timber!", actor: "Jasprit Bumrah", team: "India" },
  { eventType: "ball", message: "Over 6.1: Two runs. Well placed into the gap.", actor: "Steve Smith", team: "Australia" },
  { eventType: "ball", message: "Over 14.5: THREE! Quick running for three.", actor: "Babar Azam", team: "Pakistan" },
];

async function seed() {
  console.log("🏏 Seeding cricket match data...\n");

  for (const matchData of seedMatches) {
    // Check if match already exists
    const existing = await db
      .select()
      .from(matches)
      .where(eq(matches.externalId, matchData.externalId))
      .limit(1);

    let matchId;

    if (existing.length > 0) {
      // Update existing
      const [updated] = await db
        .update(matches)
        .set(matchData)
        .where(eq(matches.externalId, matchData.externalId))
        .returning();
      matchId = updated.id;
      console.log(`  ✏️  Updated: ${matchData.homeTeam} vs ${matchData.awayTeam} [${matchData.status}]`);
    } else {
      // Insert new
      const [created] = await db.insert(matches).values(matchData).returning();
      matchId = created.id;
      console.log(`  ✅ Created: ${matchData.homeTeam} vs ${matchData.awayTeam} [${matchData.status}]`);
    }

    // Add commentary for live matches
    if (matchData.status === "live") {
      const existingCommentary = await db
        .select({ id: commentary.id })
        .from(commentary)
        .where(eq(commentary.matchId, matchId))
        .limit(1);

      if (existingCommentary.length === 0) {
        const matchCommentaries = commentaryTemplates
          .slice(0, 4 + Math.floor(Math.random() * 4))
          .map((template, index) => ({
            matchId,
            minute: 0,
            sequence: index + 1,
            period: "live",
            eventType: template.eventType,
            actor: template.actor,
            team: template.team,
            message: template.message,
            metadata: { source: "seed" },
            tags: ["seed", "live"],
          }));

        await db.insert(commentary).values(matchCommentaries);
        console.log(`     📝 Added ${matchCommentaries.length} commentary entries`);
      }
    }
  }

  console.log("\n✅ Seeding complete! You can now run the app.\n");
  await pool.end();
}

seed().catch((error) => {
  console.error("❌ Seeding failed:", error);
  process.exit(1);
});
