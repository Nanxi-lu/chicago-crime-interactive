import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const endpoint = "https://data.cityofchicago.org/resource/ijzp-q8t2.json";
const months = [];

for (let year = 2022; year <= 2024; year += 1) {
  for (let month = 1; month <= 12; month += 1) {
    const start = `${year}-${String(month).padStart(2, "0")}-01T00:00:00`;
    const nextDate = new Date(Date.UTC(year, month, 1));
    const end = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00`;
    months.push({ year, month, start, end });
  }
}

async function fetchMonth(period, attempt = 1) {
  const where = `date >= '${period.start}' AND date < '${period.end}' AND district IS NOT NULL`;

  let rows;
  try {
    const output = execFileSync(
      "curl",
      [
        "--max-time",
        "30",
        "--retry",
        "8",
        "--retry-delay",
        "2",
        "--retry-all-errors",
        "--fail",
        "--silent",
        "--show-error",
        "--get",
        endpoint,
        "--data-urlencode",
        "$select=district,count(*) as incidents",
        "--data-urlencode",
        `$where=${where}`,
        "--data-urlencode",
        "$group=district",
        "--data-urlencode",
        "$order=district",
        "--data-urlencode",
        "$limit=100",
      ],
      { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
    );
    rows = JSON.parse(output);
  } catch (error) {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
      return fetchMonth(period, attempt + 1);
    }
    throw error;
  }
  return rows.map((row) => ({
    district: String(Number(row.district)),
    year: period.year,
    month: period.month,
    incidents: Number(row.incidents),
  }));
}

const results = [];
for (let index = 0; index < months.length; index += 4) {
  const batch = months.slice(index, index + 4);
  const batchRows = await Promise.all(batch.map((period) => fetchMonth(period)));
  results.push(...batchRows.flat());
}

const normalized = new Map();
for (const row of results) {
  const key = `${row.district}-${row.year}-${row.month}`;
  const existing = normalized.get(key);
  normalized.set(key, {
    ...row,
    incidents: row.incidents + (existing?.incidents ?? 0),
  });
}

const outputRows = [...normalized.values()];
outputRows.sort(
  (a, b) =>
    Number(a.district) - Number(b.district) || a.year - b.year || a.month - b.month,
);

await writeFile("data/district_monthly.json", `${JSON.stringify(outputRows, null, 2)}\n`);
console.log(`Saved ${outputRows.length} district-month records.`);
