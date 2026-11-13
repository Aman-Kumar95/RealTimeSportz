import "dotenv/config";

const apiUrl = process.env.CRICAPI_URL ?? "https://api.cricapi.com/v1/currentMatches";
const apiKey = process.env.CRICAPI_KEY;

function getStatus(match) {
  const status = String(match.status ?? "").toLowerCase();

  if (match.matchStarted && !match.matchEnded) return "live";
  if (
    match.matchEnded ||
    /won|draw|tie|abandoned|no result|cancelled|complete/.test(status)
  ) {
    return "finished";
  }
  return "scheduled";
}

function getScores(match) {
  const scores = Array.isArray(match.score) ? match.score : [];
  return (match.teams ?? []).map((team) => {
    const entry = scores.find((score) =>
      String(score.inning ?? "").toLowerCase().startsWith(String(team).toLowerCase())
    );
    return Number(entry?.r ?? 0);
  });
}

async function fetchApiJson(endpoint, params = {}) {
  const url = new URL(`https://api.cricapi.com/v1/${endpoint}`);
  url.searchParams.set("apikey", apiKey);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || payload.status !== "success") {
    const info = typeof payload.info === "string"
      ? payload.info
      : JSON.stringify(payload.info ?? {});
    throw new Error(info || `CricAPI request failed with ${response.status}`);
  }
  return payload.data;
}

export function normalizeCricApiMatch(match) {
  const teams = Array.isArray(match.teams) ? match.teams : [];
  const [homeScore, awayScore] = getScores(match);
  const startTime = new Date(match.dateTimeGMT ?? match.date ?? Date.now());
  const status = getStatus(match);

  return {
    externalId: String(match.id),
    sport: "Cricket",
    homeTeam: teams[0] ?? "Unknown",
    awayTeam: teams[1] ?? "Unknown",
    status,
    startTime: Number.isNaN(startTime.getTime()) ? new Date() : startTime,
    endTime: status === "finished" ? new Date() : null,
    homeScore,
    awayScore,
  };
}

export async function fetchCurrentMatches() {
  if (!apiKey) {
    throw new Error("CRICAPI_KEY is not configured");
  }

  const url = new URL(apiUrl);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("offset", "0");
  url.searchParams.set("_ts", String(Date.now()));

  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || payload.status !== "success") {
    const info = typeof payload.info === "string"
      ? payload.info
      : JSON.stringify(payload.info ?? {});
    throw new Error(info || `CricAPI request failed with ${response.status}`);
  }

  const currentMatches = Array.isArray(payload.data) ? payload.data : [];
  const liveMatches = currentMatches.filter((match) => match.matchStarted && !match.matchEnded);
  const liveDetails = await Promise.all(
    liveMatches.map(async (match) => {
      try {
        return await fetchApiJson("match_info", { id: match.id, _ts: String(Date.now()) });
      } catch (error) {
        console.error(`[CricAPI] Live detail refresh failed for ${match.id}: ${error.message}`);
        return match;
      }
    })
  );
  const detailsById = new Map(liveDetails.map((match) => [String(match.id), match]));

  return currentMatches.map((match) =>
    normalizeCricApiMatch(detailsById.get(String(match.id)) ?? match)
  );
}
