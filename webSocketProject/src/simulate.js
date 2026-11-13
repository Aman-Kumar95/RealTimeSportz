import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { matches, commentary } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { WebSocket } from "ws";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
const db = drizzle(pool);

const WS_URL = `ws://localhost:${process.env.PORT ?? 8000}/ws`;

const batsmen = [
  "Virat Kohli", "Rohit Sharma", "KL Rahul", "Shubman Gill", "Hardik Pandya",
  "Steve Smith", "David Warner", "Marnus Labuschagne", "Travis Head",
  "Joe Root", "Ben Stokes", "Harry Brook", "Babar Azam", "Fakhar Zaman",
  "Kane Williamson", "Devon Conway", "MS Dhoni", "Suryakumar Yadav",
];

const bowlers = [
  "Jasprit Bumrah", "Mohammed Shami", "Mohammed Siraj",
  "Pat Cummins", "Mitchell Starc", "Josh Hazlewood",
  "Shaheen Afridi", "Trent Boult", "Tim Southee",
  "James Anderson", "Mark Wood", "Kagiso Rabada",
];

const ballOutcomes = [
  { runs: 0, description: "Dot ball. Good line and length.", weight: 30 },
  { runs: 1, description: "Single taken. Quick running.", weight: 25 },
  { runs: 2, description: "Two runs. Well placed into the gap.", weight: 15 },
  { runs: 3, description: "Three runs! Quick between the wickets.", weight: 3 },
  { runs: 4, description: "FOUR! Beautiful shot to the boundary!", weight: 15 },
  { runs: 6, description: "SIX! Massive hit over the boundary!", weight: 7 },
  { runs: 0, description: "WICKET! Outstanding delivery!", isWicket: true, weight: 5 },
];

function weightedRandom(outcomes) {
  const totalWeight = outcomes.reduce((sum, o) => sum + o.weight, 0);
  let random = Math.random() * totalWeight;
  for (const outcome of outcomes) {
    random -= outcome.weight;
    if (random <= 0) return outcome;
  }
  return outcomes[0];
}

function pick(array) {
  return array[Math.floor(Math.random() * array.length)];
}

let overCounter = 0;
let ballCounter = 0;

function nextBall() {
  ballCounter++;
  if (ballCounter > 6) {
    ballCounter = 1;
    overCounter++;
  }
  return `${overCounter}.${ballCounter}`;
}

async function simulateLiveUpdates() {
  console.log("🏏 Live Score Simulator started!\n");
  console.log("Sending real-time score updates every 3-8 seconds...\n");

  // Get all live matches
  const liveMatches = await db
    .select()
    .from(matches)
    .where(eq(matches.status, "live"));

  if (liveMatches.length === 0) {
    console.log("❌ No live matches found. Run the seed script first:");
    console.log("   node src/seed.js");
    await pool.end();
    return;
  }

  console.log(`Found ${liveMatches.length} live matches:\n`);
  liveMatches.forEach((m) =>
    console.log(`  🏏 ${m.homeTeam} (${m.homeScore}) vs ${m.awayTeam} (${m.awayScore})`)
  );
  console.log("");

  // Track scores in memory
  const scores = new Map(
    liveMatches.map((m) => [m.id, { home: m.homeScore, away: m.awayScore }])
  );

  async function tick() {
    const match = pick(liveMatches);
    const score = scores.get(match.id);
    const outcome = weightedRandom(ballOutcomes);
    const batsman = pick(batsmen);
    const bowler = pick(bowlers);
    const over = nextBall();
    const isHomeBatting = Math.random() > 0.5;

    // Update score
    if (isHomeBatting) {
      score.home += outcome.runs;
    } else {
      score.away += outcome.runs;
    }

    // Update DB
    await db
      .update(matches)
      .set({ homeScore: score.home, awayScore: score.away })
      .where(eq(matches.id, match.id));

    // Create commentary entry
    const commentaryMessage = `Over ${over}: ${outcome.description}${
      !outcome.isWicket ? ` ${batsman} facing ${bowler}.` : ` ${bowler} strikes! ${batsman} departs.`
    }`;

    const [commentaryEntry] = await db
      .insert(commentary)
      .values({
        matchId: match.id,
        minute: 0,
        sequence: Date.now() % 2147483647,
        period: "live",
        eventType: outcome.isWicket ? "wicket" : "ball",
        actor: outcome.isWicket ? bowler : batsman,
        team: isHomeBatting ? match.homeTeam : match.awayTeam,
        message: commentaryMessage,
        metadata: { source: "simulator", runs: outcome.runs },
        tags: ["simulator", "live"],
      })
      .returning();

    console.log(
      `  [${match.homeTeam} ${score.home} vs ${match.awayTeam} ${score.away}] ${commentaryMessage}`
    );

    // Schedule next tick (3-8 seconds)
    const delay = 3000 + Math.random() * 5000;
    setTimeout(tick, delay);
  }

  // Start the simulation
  tick();
}

simulateLiveUpdates().catch((error) => {
  console.error("❌ Simulator error:", error);
  process.exit(1);
});
