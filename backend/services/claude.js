import dotenv from "dotenv";
dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export async function generateNarrative({ ticker, companyName, sector, price, pctFromLow, pctDrawdown3m, checklist, news }) {
  if (!ANTHROPIC_API_KEY) {
    return { narrative: null, headline: null };
  }

  const topHeadline = news?.[0]?.title || null;
  const newsContext = (news || [])
    .slice(0, 3)
    .map((n) => `- ${n.title} (${n.publishedDate})`)
    .join("\n");

  const checklistText = Object.entries(checklist)
    .map(([k, v]) => `- ${k}: ${v.flag} (${v.detail})`)
    .join("\n");

  const prompt = `You're writing a terse daily-scanner note for an experienced investor about ${companyName || ticker} (${ticker}), sector: ${sector || "unknown"}.

Current price: $${price}, ${pctFromLow?.toFixed(1)}% from its 52-week low, down ${pctDrawdown3m?.toFixed(1)}% from its 3-month high.

Recent news:
${newsContext || "No recent headlines found."}

Fundamental checklist:
${checklistText}

Write a 3-4 sentence note covering: (1) what's likely driving the drop, in plain terms, (2) whether the fundamentals still look sound or shaky, referencing the checklist, (3) one honest caution or thing to watch. No preamble, no bullet points, no disclaimers about not being financial advice — just the analytical note itself.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[claude] narrative generation failed for ${ticker}: ${res.status} ${body.slice(0, 200)}`);
    return { narrative: null, headline: topHeadline };
  }

  const data = await res.json();
  const text = data?.content?.find((b) => b.type === "text")?.text?.trim() || null;
  return { narrative: text, headline: topHeadline };
}
