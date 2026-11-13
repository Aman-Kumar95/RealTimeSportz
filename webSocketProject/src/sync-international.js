import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { matches, commentary } from "./db/schema.js";

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

// Top international cricket teams to prioritize
const topInternationalTeams = new Set([
  "India", "Australia", "England", "New Zealand", "Pakistan",
  "South Africa", "West Indies", "Sri Lanka", "Bangladesh", "Afghanistan"
]);

async function syncInternationalCricketOnly() {
  console.log("🌍 Syncing ONLY 100% REAL International Cricket Matches from SportMonks...\n");

  // Step 1: Wipe database
  console.log("🧹 Clearing old domestic matches from database...");
  await db.delete(commentary);
  await db.delete(matches);
  console.log("✅ Cleared.\n");

  // Step 2: Fetch international seasons (1715 for 2026, 1846 for 2027)
  console.log("📥 Fetching official Twenty20 International matches (Season 1715 & 1846)...");
  const s1715 = await request("seasons/1715", {
    include: "fixtures.localteam,fixtures.visitorteam",
  });
  const s1846 = await request("seasons/1846", {
    include: "fixtures.localteam,fixtures.visitorteam",
  });

  const allFixtures = [
    ...(s1715?.fixtures ?? []),
    ...(s1846?.fixtures ?? []),
  ];

  console.log(`   Found ${allFixtures.length} total international fixtures.\n`);

  // Step 3: Filter strictly to international matches involving top international teams
  const validInternational = allFixtures.filter((f) => {
    const home = f.localteam?.name;
    const away = f.visitorteam?.name;
    if (!home || !away) return false;
    // At least one team must be a major international team, or both national teams
    return (
      (topInternationalTeams.has(home) || f.localteam?.national_team) &&
      (topInternationalTeams.has(away) || f.visitorteam?.national_team)
    );
  });

  // Sort by date closest to today
  const now = Date.now();
  const sorted = validInternational
    .sort((a, b) => {
      const diffA = Math.abs(new Date(a.starting_at).getTime() - now);
      const diffB = Math.abs(new Date(b.starting_at).getTime() - now);
      return diffA - diffB;
    })
    .slice(0, 16); // Top 16 international matches

  console.log(`🏏 Inserting ${sorted.length} REAL INTERNATIONAL matches into database:\n`);

  for (const f of sorted) {
    const homeTeam = f.localteam.name;
    const awayTeam = f.visitorteam.name;
    const startTime = new Date(f.starting_at);
    const status = normalizeStatus(f.status, f.starting_at);

    // Fetch detailed score and real balls from SportMonks
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
      // Proceed if detailed endpoint has rate limit
    }

    const [inserted] = await db
      .insert(matches)
      .values({
        externalId: `sm_${f.id}`,
        sport: "International Cricket",
        homeTeam,
        awayTeam,
        status,
        startTime,
        endTime: status === "finished" ? new Date(startTime.getTime() + 4 * 3600000) : null,
        homeScore,
        awayScore,
      })
      .returning();

    console.log(`  🌟 [${status.toUpperCase()}] ${homeTeam} vs ${awayTeam} (T20I)`);
    if (homeScore > 0 || awayScore > 0) {
      console.log(`     Score: ${homeTeam} ${homeScore} - ${awayTeam} ${awayScore}`);
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
            source: "sportmonks-international",
            fixtureId: f.id,
            ballId: b.id,
            batsman,
            bowler,
          },
          tags: ["international", "t20i", isWicket ? "wicket" : "ball"],
        };
      });

      if (realCommentary.length > 0) {
        await db.insert(commentary).values(realCommentary);
        console.log(`     📝 Added ${realCommentary.length} official international ball deliveries`);
      }
    }
  }

  console.log("\n✅ ONLY 100% Real International Cricket Matches are now active in the app!\n");
  await pool.end();
}

syncInternationalCricketOnly().catch((err) => {
  console.error("❌ Sync error:", err);
  process.exit(1);
});
