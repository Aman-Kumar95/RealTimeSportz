import { eq } from "drizzle-orm";
import { db } from "../db/db.js";
import { commentary, matches } from "../db/schema.js";
import { fetchLiveMatches } from "./sportmonks.js";

// Realistic international player profiles per team
const internationalPlayers = {
  India: {
    batsmen: ["Rohit Sharma", "Virat Kohli", "Suryakumar Yadav", "Hardik Pandya", "Sanju Samson", "Abhishek Sharma", "Rinku Singh"],
    bowlers: ["Jasprit Bumrah", "Mohammed Siraj", "Arshdeep Singh", "Kuldeep Yadav", "Axar Patel"],
  },
  Australia: {
    batsmen: ["Travis Head", "Mitchell Marsh", "Glenn Maxwell", "Josh Inglis", "Tim David", "Marcus Stoinis"],
    bowlers: ["Pat Cummins", "Mitchell Starc", "Josh Hazlewood", "Adam Zampa", "Nathan Ellis"],
  },
  "New Zealand": {
    batsmen: ["Devon Conway", "Finn Allen", "Kane Williamson", "Glenn Phillips", "Daryl Mitchell", "Mark Chapman"],
    bowlers: ["Trent Boult", "Tim Southee", "Mitchell Santner", "Lockie Ferguson", "Ish Sodhi"],
  },
  England: {
    batsmen: ["Jos Buttler", "Phil Salt", "Harry Brook", "Liam Livingstone", "Will Jacks", "Sam Curran"],
    bowlers: ["Jofra Archer", "Mark Wood", "Adil Rashid", "Reece Topley", "Chris Jordan"],
  },
  Default: {
    batsmen: ["Opening Batsman", "Top-order Batsman", "Middle-order Batsman", "Power Hitter"],
    bowlers: ["Strike Bowler", "Fast Bowler", "Spin Specialist", "Death Bowler"],
  },
};

const ballOutcomes = [
  { runs: 0, text: "Dot ball. Good length delivery, defended solidly.", eventType: "ball", weight: 26 },
  { runs: 1, text: "Single taken! Worked away into the gap, quick running between wickets.", eventType: "ball", weight: 28 },
  { runs: 2, text: "Two runs! Driven through extra cover, good running.", eventType: "ball", weight: 14 },
  { runs: 3, text: "Three runs! Pierces the infield, great fielding at the boundary ropes.", eventType: "ball", weight: 3 },
  { runs: 4, text: "FOUR! Glorious cover drive! Races away to the fence in no time!", eventType: "ball", weight: 16 },
  { runs: 6, text: "SIX! Stand and deliver! High and handsome over long-on!", eventType: "ball", weight: 7 },
  { runs: 0, text: "WICKET! Bowled him! Clean through the gate, stumps shattered!", eventType: "wicket", weight: 3 },
  { runs: 0, text: "WICKET! High in the air... and CAUGHT in the deep! Big breakthrough!", eventType: "wicket", weight: 3 },
];

function pickOutcome() {
  const total = ballOutcomes.reduce((acc, o) => acc + o.weight, 0);
  let rand = Math.random() * total;
  for (const outcome of ballOutcomes) {
    rand -= outcome.weight;
    if (rand <= 0) return outcome;
  }
  return ballOutcomes[0];
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return "Player";
  return arr[Math.floor(Math.random() * arr.length)];
}

const matchStates = new Map();

function getMatchState(matchId, initialOver = 16) {
  if (!matchStates.has(matchId)) {
    matchStates.set(matchId, {
      over: initialOver,
      ball: 1,
      battingHome: true,
    });
  }
  const state = matchStates.get(matchId);
  const notation = `${state.over}.${state.ball}`;

  state.ball += 1;
  if (state.ball > 6) {
    state.ball = 1;
    state.over += 1;
    // Over ends, alternate strike occasionally
    if (state.over > 20) {
      state.over = 1;
      state.battingHome = !state.battingHome;
    }
  }
  return { notation, isHomeBatting: state.battingHome };
}

/**
 * Real-time International Match Engine (runs every 3.5 seconds)
 */
async function tickLiveInternational(callbacks) {
  try {
    const liveMatches = await db
      .select()
      .from(matches)
      .where(eq(matches.status, "live"));

    if (liveMatches.length === 0) return;

    // Pick one live match to update this tick
    const match = pickRandom(liveMatches);
    const outcome = pickOutcome();
    const { notation, isHomeBatting } = getMatchState(match.id);

    const battingTeam = isHomeBatting ? match.homeTeam : match.awayTeam;
    const bowlingTeam = isHomeBatting ? match.awayTeam : match.homeTeam;

    const battingRoster = internationalPlayers[battingTeam] || internationalPlayers.Default;
    const bowlingRoster = internationalPlayers[bowlingTeam] || internationalPlayers.Default;

    const batsman = pickRandom(battingRoster.batsmen);
    const bowler = pickRandom(bowlingRoster.bowlers);

    const newHomeScore = isHomeBatting ? match.homeScore + outcome.runs : match.homeScore;
    const newAwayScore = !isHomeBatting ? match.awayScore + outcome.runs : match.awayScore;

    // Update match score in database
    const [updatedMatch] = await db
      .update(matches)
      .set({
        homeScore: newHomeScore,
        awayScore: newAwayScore,
      })
      .where(eq(matches.id, match.id))
      .returning();

    // Create realistic international commentary
    const commentaryText = `Over ${notation}: ${outcome.text} (${batsman} facing ${bowler})`;

    const [createdCommentary] = await db
      .insert(commentary)
      .values({
        matchId: match.id,
        minute: 0,
        sequence: Date.now() % 2147483647,
        period: "live",
        eventType: outcome.eventType,
        actor: outcome.eventType === "wicket" ? bowler : batsman,
        team: outcome.eventType === "wicket" ? bowlingTeam : battingTeam,
        message: commentaryText,
        metadata: {
          over: notation,
          runs: outcome.runs,
          batsman,
          bowler,
          source: "international-live-engine",
        },
        tags: ["international", outcome.eventType, "live", "t20i"],
      })
      .returning();

    // Broadcast over WebSocket!
    callbacks.onScoreUpdated?.({
      ...updatedMatch,
      commentary: createdCommentary,
    });
  } catch (err) {
    console.error("[LiveEngine] Error:", err.message);
  }
}

/**
 * SportMonks live match API poller
 */
export async function syncLiveMatches({ onCreated, onScoreUpdated }) {
  try {
    const liveMatches = await fetchLiveMatches();
    if (liveMatches.length === 0) return 0;

    console.log(`[SportMonks] ${liveMatches.length} in-play live match(es) received from API`);

    for (const liveMatch of liveMatches) {
      const existing = await db
        .select()
        .from(matches)
        .where(eq(matches.externalId, liveMatch.externalId))
        .limit(1);

      const matchValues = {
        externalId: liveMatch.externalId,
        sport: "International Cricket",
        homeTeam: liveMatch.homeTeam,
        awayTeam: liveMatch.awayTeam,
        status: liveMatch.status,
        startTime: liveMatch.startTime,
        endTime: liveMatch.endTime,
        homeScore: liveMatch.homeScore,
        awayScore: liveMatch.awayScore,
      };

      if (existing.length === 0) {
        const [created] = await db.insert(matches).values(matchValues).returning();
        onCreated?.(created);
        onScoreUpdated?.(created);
      } else {
        const [updated] = await db
          .update(matches)
          .set(matchValues)
          .where(eq(matches.id, existing[0].id))
          .returning();
        onScoreUpdated?.(updated);
      }
    }
    return liveMatches.length;
  } catch (err) {
    console.warn(`[SportMonks] Live poll: ${err.message}`);
    return 0;
  }
}

/**
 * Start the Live Real-Time Cricket Engine
 */
export function startLiveSync(callbacks) {
  console.log("🏏 International Real-Time Cricket Engine Active! Streaming live updates every 3.5s...");

  // High-speed real-time ticks every 3.5 seconds
  const liveTickInterval = setInterval(() => {
    tickLiveInternational(callbacks);
  }, 3500);

  // SportMonks API poller every 30 seconds
  const apiInterval = setInterval(() => {
    syncLiveMatches(callbacks);
  }, 30000);

  // Initial API check
  syncLiveMatches(callbacks).catch(() => {});

  return () => {
    clearInterval(liveTickInterval);
    clearInterval(apiInterval);
  };
}
