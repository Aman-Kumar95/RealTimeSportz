import "dotenv/config";

const apiBaseUrl = process.env.SPORTMONKS_URL ?? "https://cricket.sportmonks.com/api/v2.0";
const token = process.env.SPORTMONKS_TOKEN;

function request(endpoint, params = {}) {
  if (!token) throw new Error("SPORTMONKS_TOKEN is not configured");

  const url = new URL(`${apiBaseUrl}/${endpoint}`);
  url.searchParams.set("api_token", token);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return fetch(url, { cache: "no-store" }).then(async (response) => {
    const payload = await response.json();
    if (!response.ok || payload.message) {
      const message = typeof payload.message === "string"
        ? payload.message
        : JSON.stringify(payload.message ?? {});
      throw new Error(message || `SportMonks request failed with ${response.status}`);
    }
    return payload.data ?? [];
  });
}

function statusOf(match) {
  const rawStatus = typeof match.status === "object"
    ? match.status?.name ?? match.status?.status
    : match.status;
  const status = String(rawStatus ?? "").toLowerCase();
  if (status.includes("live") || status.includes("innings") || status.includes("in play")) return "live";
  if (status.includes("finished") || status.includes("completed") || status.includes("result")) return "finished";
  if (match.winner_team_id || match.draw_noresult) return "finished";
  return "scheduled";
}

function scoreForTeam(match, teamId, teamName) {
  const scoreboards = Array.isArray(match.scoreboards) ? match.scoreboards : [];
  const candidates = scoreboards.filter((score) =>
    String(score.team_id ?? score.team?.id) === String(teamId) ||
    String(score.team?.name ?? "").toLowerCase() === String(teamName).toLowerCase()
  );
  const score = candidates[candidates.length - 1] ?? {};
  return Number(score.total ?? score.runs ?? score.score ?? 0);
}

function teamName(team, fallback) {
  return team?.name ?? team?.team?.name ?? fallback;
}

function isRelevantFixture(match) {
  const startsAt = new Date(match.starting_at ?? match.etc ?? 0).getTime();
  const now = Date.now();
  const historyWindow = Number(process.env.SPORTMONKS_HISTORY_DAYS ?? 7) * 86400000;
  const upcomingWindow = Number(process.env.SPORTMONKS_UPCOMING_DAYS ?? 3) * 86400000;
  return startsAt >= now - historyWindow && startsAt <= now + upcomingWindow;
}

function ballCommentaries(match) {
  const balls = Array.isArray(match.balls) ? match.balls : [];
  return balls.map((ball) => {
    const score = ball.score ?? {};
    const batsman = ball.batsman?.fullname ?? ball.batsman?.name;
    const bowler = ball.bowler?.fullname ?? ball.bowler?.name;
    const over = ball.ball ?? ball.over ?? 0;
    const scoreName = score.name ?? `${score.runs ?? 0} run${score.runs === 1 ? "" : "s"}`;
    const wicket = score.is_wicket || score.out ? " Wicket." : "";

    return {
      externalBallId: String(ball.id),
      minute: 0,
      sequence: Number(ball.id) % 2147483647,
      period: String(ball.scoreboard ?? "live"),
      eventType: score.is_wicket || score.out ? "wicket" : "ball",
      actor: batsman ?? null,
      team: ball.team?.name ?? null,
      message: `Over ${over}: ${scoreName}${wicket}${bowler ? ` Bowled by ${bowler}.` : ""}`,
      metadata: {
        source: "sportmonks",
        fixtureId: match.id,
        ballId: ball.id,
        batsman,
        bowler,
        score,
      },
      tags: ["sportmonks", "ball-by-ball"],
    };
  });
}

export function normalizeSportMonksMatch(match) {
  const localTeam = match.localteam ?? match.local_team;
  const visitorTeam = match.visitorteam ?? match.visitor_team;
  const homeTeam = teamName(localTeam, "Home Team");
  const awayTeam = teamName(visitorTeam, "Away Team");
  const startTime = new Date(match.starting_at ?? match.etc ?? Date.now());
  const providerStatus = statusOf(match);
  const startedAt = new Date(match.starting_at ?? match.etc ?? Date.now());
  const status = providerStatus === "scheduled" && startedAt < new Date()
    ? "finished"
    : providerStatus;

  return {
    externalId: `sm_${match.id}`,
    sport: "Cricket",
    homeTeam,
    awayTeam,
    status,
    startTime: Number.isNaN(startTime.getTime()) ? new Date() : startTime,
    endTime: status === "finished" ? new Date() : null,
    homeScore: scoreForTeam(match, localTeam?.id, homeTeam),
    awayScore: scoreForTeam(match, visitorTeam?.id, awayTeam),
    balls: ballCommentaries(match),
  };
}

let rateLimitedUntil = 0;

export async function fetchLiveMatches() {
  if (Date.now() < rateLimitedUntil) {
    return [];
  }

  try {
    const data = await request("livescores", {
      include: "localteam,visitorteam,scoreboards,balls.batsman,balls.bowler,balls.score,balls.team",
    });
    return Array.isArray(data) ? data.map(normalizeSportMonksMatch) : [];
  } catch (error) {
    if (error.message?.includes("Too Many Attempts")) {
      console.warn("[SportMonks] Rate limited, backing off for 60s");
      rateLimitedUntil = Date.now() + 60000;
    } else {
      console.warn(`[SportMonks] Live scores check: ${error.message}`);
    }
    return [];
  }
}
