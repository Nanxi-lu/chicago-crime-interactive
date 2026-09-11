// Pulls the aggregates behind the analysis panels from the City of Chicago
// open-data API (same endpoint as fetch_data.mjs). Run with `node fetch_analysis.mjs`.
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const endpoint = "https://data.cityofchicago.org/resource/ijzp-q8t2.json";
const YEARS = [2022, 2023, 2024];

function query(params) {
  const args = ["--max-time", "90", "--retry", "6", "--retry-delay", "3", "--retry-all-errors",
    "--fail", "--silent", "--show-error", "--get", endpoint];
  for (const [key, value] of Object.entries(params)) {
    args.push("--data-urlencode", `${key}=${value}`);
  }
  return JSON.parse(execFileSync("curl", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
}

const yearWhere = (year) =>
  `date >= '${year}-01-01T00:00:00' AND date < '${year + 1}-01-01T00:00:00' AND district IS NOT NULL`;

// 1. Hour x weekday counts per district and year. dow: 0 = Sunday.
const hourWeekday = {};
for (const year of YEARS) {
  const rows = query({
    $select: "district,date_extract_dow(date) as dow,date_extract_hh(date) as hour,count(*) as n",
    $where: yearWhere(year),
    $group: "district,dow,hour",
    $limit: "20000",
  });
  for (const row of rows) {
    const district = String(Number(row.district));
    hourWeekday[district] ??= {};
    hourWeekday[district][year] ??= Array.from({ length: 7 }, () => Array(24).fill(0));
    hourWeekday[district][year][Number(row.dow)][Number(row.hour)] += Number(row.n);
  }
  console.log(`hour x weekday ${year}: ${rows.length} rows`);
}

// 2. Primary crime type per district and year.
const types = [];
for (const year of YEARS) {
  const rows = query({
    $select: "district,primary_type,count(*) as n",
    $where: yearWhere(year),
    $group: "district,primary_type",
    $limit: "20000",
  });
  for (const row of rows) {
    types.push({
      district: String(Number(row.district)),
      year,
      type: row.primary_type,
      incidents: Number(row.n),
    });
  }
  console.log(`types ${year}: ${rows.length} rows`);
}

// 3. Daily citywide counts, rolled up to ISO-style Monday weeks for the forecasting panel.
const daily = [];
for (const year of YEARS) {
  const rows = query({
    $select: "date_trunc_ymd(date) as day,count(*) as n",
    $where: yearWhere(year),
    $group: "day",
    $order: "day",
    $limit: "1000",
  });
  daily.push(...rows.map((row) => ({ day: row.day.slice(0, 10), n: Number(row.n) })));
  console.log(`daily ${year}: ${rows.length} rows`);
}
const weekly = new Map();
for (const { day, n } of daily) {
  const date = new Date(`${day}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7; // days since Monday
  date.setUTCDate(date.getUTCDate() - offset);
  const key = date.toISOString().slice(0, 10);
  weekly.set(key, (weekly.get(key) ?? 0) + n);
}
const weeklyRows = [...weekly.entries()]
  .map(([week, incidents]) => ({ week, incidents }))
  .sort((a, b) => a.week.localeCompare(b.week));

await writeFile("data/district_hour_weekday.json", JSON.stringify(hourWeekday));
await writeFile("data/district_types.json", JSON.stringify(types));
await writeFile("data/weekly_city.json", JSON.stringify(weeklyRows, null, 2));
console.log(`Saved ${Object.keys(hourWeekday).length} districts, ${types.length} type rows, ${weeklyRows.length} weeks.`);
