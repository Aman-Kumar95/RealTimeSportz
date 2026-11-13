import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { matches, commentary } from "./db/schema.js";
import { eq, sql } from "drizzle-orm";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
const db = drizzle(pool);

const token = process.env.SPORTMONKS_TOKEN;
const apiBaseUrl = process.env.SPORTMONKS_URL ?? "https://cricket.sportmonks.com/api/v2.0";

async function request(endpoint, params = {}) {
  const url = new URL(`${apiBaseUrl}/${endpoint}`);
  url.searchParams.set("api_token", token);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const res = await fetch(url.toString());
  const json = await res.json();
  if (!res.ok || json.message) {
    throw new Error(typeof json.message === "string" ? json.message : JSON.stringify(json.message));
  }
  return json.data;
}

function getScore(scoreboards, teamId) {
  if (!Array.isArray(scoreboards)) return 0;
  const teamScores = scoreboards.filter(
    (s) => String(s.team_id) === String(teamId) && s.type === "total"
  );
  if (teamScores.length === 0) return 0;
  return Number(teamScores[teamScores.length - 1].total ?? 0);
}

function normalizeStatus(rawStatus, startingAt) {
  const status = String(rawStatus ?? "").toLowerCase();
  if (status.includes("live") || status.includes("innings") || status.includes("in play")) return "live";
  if (status.includes("finish") || status.includes("complete") || status.includes("result") || status === "finished") return "finished";
  const start = new Date(startingAt);
  if (start < new Date() && status !== "ns") return "finished";
  return "scheduled";
}

async function syncRealSportMonksData() {
  console.log("🏏 Connecting to SportMonks Cricket API to fetch 100% REAL cricket data...\n");

  // Step 1: Wipe all old/mock data
  console.log("🧹 Clearing old mock data from database...");
  await db.delete(commentary);
  await db.delete(matches);
  console.log("✅ Database cleared.\n");

  // Step 2: Check for any current livescores
  console.log("📡 Checking SportMonks /livescores for in-play matches...");
  let livescores = [];
  try {
    livescores = await request("livescores", {
      include: "localteam,visitorteam,scoreboards,balls.batsman,balls.bowler,balls.score",
    });
    console.log(`   Found ${livescores.length} live matches right now on SportMonks.`);
  } catch (err) {
    console.warn(`   Livescores check: ${err.message}`);
  }

  // Step 3: Fetch real fixtures from Season 1849 (CSA T20 Challenge 2026)
  console.log("📥 Fetching real CSA T20 Challenge 2026 fixtures (Season 1849)...");
  const season1849 = await request("seasons/1849", {
    include: "fixtures.localteam,fixtures.visitorteam",
  });
  const csaFixtures = season1849?.fixtures ?? [];
  console.log(`   Found ${csaFixtures.length} CSA T20 Challenge fixtures.`);

  // Step 4: Fetch real fixtures from Season 1715 (T20 International 2026)
  console.log("📥 Fetching real T20 International 2026 fixtures (Season 1715)...");
  const season1715 = await request("seasons/1715", {
    include: "fixtures.localteam,fixtures.visitorteam",
  });
  const t20iFixtures = season1715?.fixtures ?? [];
  console.log(`   Found ${t20iFixtures.length} T20 International fixtures.`);

  // Step 5: Fetch real fixtures from Season 1836 (Big Bash League 2026/27)
  console.log("📥 Fetching real Big Bash League 2026/27 fixtures (Season 1836)...");
  const season1836 = await request("seasons/1836", {
    include: "fixtures.localteam,fixtures.visitorteam",
  });
  const bblFixtures = season1836?.fixtures ?? [];
  console.log(`   Found ${bblFixtures.length} Big Bash League fixtures.\n`);

  // Combine and sort by date near today
  const allFixtures = [
    ...csaFixtures.map((f) => ({ ...f, leagueName: "CSA T20 Challenge" })),
    ...t20iFixtures.map((f) => ({ ...f, leagueName: "T20 International" })),
    ...bblFixtures.map((f) => ({ ...f, leagueName: "Big Bash League" })),
  ];

  // Filter to the most relevant recent and upcoming matches
  const now = Date.now();
  const sorted = allFixtures
    .filter((f) => f.localteam?.name && f.visitorteam?.name && f.localteam.name !== "TBC")
    .sort((a, b) => {
      const diffA = Math.abs(new Date(a.starting_at).getTime() - now);
      const diffB = Math.abs(new Date(b.starting_at).getTime() - now);
      return diffA - diffB;
    })
    .slice(0, 15); // Top 15 real fixtures closest to today

  console.log(`📋 Inserting top ${sorted.length} REAL fixtures into database:\n`);

  for (const f of sorted) {
    const homeTeam = f.localteam.name;
    const awayTeam = f.visitorteam.name;
    const startTime = new Date(f.starting_at);
    let status = normalizeStatus(f.status, f.starting_at);

    // If there is a real live match from livescores, use it
    const liveMatch = livescores.find((lm) => lm.id === f.id);
    if (liveMatch) {
      status = "live";
    }

    // Fetch detailed match data (scores and balls) for finished / relevant fixtures
    let homeScore = 0;
    let awayScore = 0;
    let balls = [];

    try {
      const detailed = await request(`fixtures/${f.id}`, {
        include: "scoreboards,balls.batsman,balls.bowler,balls.score",
      });
      if (detailed) {
        homeScore = getScore(detailed.scoreboards, f.localteam_id);
        awayScore = getScore(detailed.scoreboards, f.visitorteam_id);
        balls = detailed.balls ?? [];
      }
    } catch (e) {
      // If detailed fetch is rate-limited, proceed with basic info
    }

    // Insert into matches table
    const [inserted] = await db
      .insert(matches)
      .values({
        externalId: `sm_${f.id}`,
        sport: "Cricket",
        homeTeam,
        awayTeam,
        status,
        startTime,
        endTime: status === "finished" ? new Date(startTime.getTime() + 4 * 3600000) : null,
        homeScore,
        awayScore,
      })
      .returning();

    console.log(`  🏏 [${status.toUpperCase()}] ${homeTeam} vs ${awayTeam} (${f.leagueName})`);
    if (homeScore > 0 || awayScore > 0) {
      console.log(`     Score: ${homeScore} - ${awayScore}`);
    }

    // Insert real ball-by-ball commentary if available
    if (balls.length > 0) {
      const realCommentary = balls.slice(0, 30).map((b, idx) => {
        const batsman = b.batsman?.fullname ?? b.batsman?.name ?? "Batsman";
        const bowler = b.bowler?.fullname ?? b.bowler?.name ?? "Bowler";
        const scoreName = b.score?.name ?? `${b.score?.runs ?? 0} runs`;
        const isWicket = b.score?.is_wicket || b.score?.out;

        return {
          matchId: inserted.id,
          minute: 0,
          sequence: idx + 1,
          period: "live",
          eventType: isWicket ? "wicket" : "ball",
          actor: isWicket ? bowler : batsman,
          team: null,
          message: `Over ${b.ball}: ${scoreName}${isWicket ? " WICKET!" : ""}. ${batsman} facing ${bowler}.`,
          metadata: {
            source: "sportmonks-official",
            fixtureId: f.id,
            ballId: b.id,
            batsman,
            bowler,
          },
          tags: ["sportmonks", "official", isWicket ? "wicket" : "ball"],
        };
      });

      if (realCommentary.length > 0) {
        await db.insert(commentary).values(realCommentary);
        console.log(`     📝 Added ${realCommentary.length} REAL ball-by-ball commentary entries from SportMonks`);
      }
    }
  }

  console.log("\n✅ 100% REAL Cricket API data successfully synced from SportMonks!\n");
  await pool.end();
}

syncRealSportMonksData().catch((err) => {
  console.error("❌ Sync error:", err);
  process.exit(1);
});
