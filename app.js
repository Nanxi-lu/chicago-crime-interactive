const DATA_URL = "data/district_monthly.json";
const BOUNDARIES_URL = "data/police_districts.geojson";
const HOUR_WEEKDAY_URL = "data/district_hour_weekday.json";
const TYPES_URL = "data/district_types.json";
const WEEKLY_URL = "data/weekly_city.json";
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YEARS = [2022, 2023, 2024];

// Official Chicago Police Department district names (CPD annual report).
const DISTRICT_NAMES = {
  1: "Central",
  2: "Wentworth",
  3: "Grand Crossing",
  4: "South Chicago",
  5: "Calumet",
  6: "Gresham",
  7: "Englewood",
  8: "Chicago Lawn",
  9: "Deering",
  10: "Ogden",
  11: "Harrison",
  12: "Near West",
  14: "Shakespeare",
  15: "Austin",
  16: "Jefferson Park",
  17: "Albany Park",
  18: "Near North",
  19: "Town Hall",
  20: "Lincoln",
  22: "Morgan Park",
  24: "Rogers Park",
  25: "Grand Central",
};

const MAP_RAMP = ["#15334a", "#1a8d8b", "#4be1c9", "#ffb454"];
const DIVERGING_RAMP = ["#38d6c6", "#173049", "#ffb454"]; // below city · like city · above city
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first; the data uses 0 = Sunday
const TOP_TYPES = 12;
const TRAIN_SHARE = 0.8;

// Out-of-sample errors on weekly citywide counts, from the accompanying report (Table 1).
const MODELS = [
  { id: "naive", name: "Same as last week", detail: "Assumes next week will match this week", rmse: 737, mae: 660 },
  { id: "arima", name: "Recent trend", detail: "Follows the pattern of the last few weeks (ARIMA)", rmse: 584, mae: 521 },
  { id: "sarima", name: "Recent trend + seasons", detail: "Also uses what happened this time last year (SARIMA)", rmse: 337, mae: 264 },
  { id: "rf", name: "Machine learning", detail: "Learns from many past patterns at once (random forest)", rmse: 261, mae: 233 },
];
const FILL_DURATION = 700;
const EASE = d3.easeCubicOut;

const numberFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const percentFormat = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const ratioFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  rows: [],
  boundaries: null,
  selectedDistrict: "7",
  selectedYear: "all",
  typeFilter: null, // primary crime type used to colour the map, or null for all crimes
  heatMode: "count", // "count" or "index" (district pattern relative to the city)
  selectedModel: "rf",
  hourWeekday: {},
  types: [],
  weekly: [],
  chart: null,
  weeklyChart: null,
  heat: null,
  shapeSelection: null,
  haloSelection: null,
  sheenSelection: null,
  labelSelection: null,
  displayed: new Map(), // last rendered numbers, used to tween between values
  mapReady: false, // first paint is instant; later selections animate
};

function districtKey(value) {
  return String(Number(value));
}

function districtNumber(value) {
  return String(Number(value)).padStart(2, "0");
}

function districtName(value) {
  return DISTRICT_NAMES[Number(value)] ?? "Unnamed district";
}

function districtLabel(value) {
  return `${districtNumber(value)} · ${districtName(value)}`;
}

function periodLabel(year = state.selectedYear) {
  return year === "all" ? "2022–2024" : String(year);
}

function typeLabel(type) {
  const lower = type.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function typeTotalForDistrict(district, year, type) {
  return state.types
    .filter((row) => row.district === districtKey(district) && row.type === type && (year === "all" || row.year === Number(year)))
    .reduce((sum, row) => sum + row.incidents, 0);
}

function citywideTypeTotal(year, type) {
  return state.types
    .filter((row) => row.type === type && (year === "all" || row.year === Number(year)))
    .reduce((sum, row) => sum + row.incidents, 0);
}

function rowsForDistrict(district) {
  return state.rows.filter((row) => row.district === districtKey(district));
}

function totalForDistrict(district, year = state.selectedYear) {
  return rowsForDistrict(district)
    .filter((row) => year === "all" || row.year === Number(year))
    .reduce((sum, row) => sum + row.incidents, 0);
}

function citywideTotal(year = "all") {
  return state.rows
    .filter((row) => year === "all" || row.year === Number(year))
    .reduce((sum, row) => sum + row.incidents, 0);
}

function allDistricts() {
  return [...new Set(
    state.boundaries.features
      .map((feature) => districtKey(feature.properties.dist_num))
      .filter((district) => rowsForDistrict(district).length > 0),
  )].sort((a, b) => Number(a) - Number(b));
}

function getMapTotals(year = state.selectedYear, type = state.typeFilter) {
  return new Map(allDistricts().map((district) => [
    district,
    type ? typeTotalForDistrict(district, year, type) : totalForDistrict(district, year),
  ]));
}

// Shared floating tooltip used by the map and the analysis panels.
const tooltip = document.querySelector("#map-tooltip");

function showTooltip(event, html) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  tooltip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - 260)}px`;
  tooltip.style.top = `${Math.min(event.clientY + 14, window.innerHeight - 100)}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

function motionDuration(duration) {
  return reducedMotion.matches || !state.mapReady ? 0 : duration;
}

// Tween a numeric readout so values glide instead of snapping.
function setNumber(id, value, formatter = numberFormat) {
  const element = document.querySelector(`#${id}`);
  const previous = state.displayed.get(id);
  state.displayed.set(id, value);

  if (previous === undefined || motionDuration(1) === 0) {
    element.textContent = formatter.format(value);
    return;
  }

  d3.select(element)
    .transition()
    .duration(600)
    .ease(EASE)
    .tween("text", () => {
      const interpolate = d3.interpolateNumber(previous, value);
      const isInteger = Number.isInteger(value) && Number.isInteger(previous);
      return (t) => {
        const current = interpolate(t);
        element.textContent = formatter.format(isInteger ? Math.round(current) : current);
      };
    });
}

// Swap a text readout with a gentle fade so the change registers without a jump.
function setText(id, text, detail = "") {
  const element = document.querySelector(`#${id}`);
  const key = `${text}|${detail}`;
  if (element.dataset.value === key) return;
  element.dataset.value = key;
  element.classList.remove("is-refreshing");
  void element.offsetWidth; // restart the animation
  element.textContent = text;
  if (detail) {
    const small = document.createElement("small");
    small.className = "stat-detail";
    small.textContent = detail;
    element.append(small);
  }
  element.classList.add("is-refreshing");
}

function updateMap() {
  const totals = getMapTotals();
  const values = [...totals.values()].filter((value) => value > 0);
  const extent = d3.extent(values);
  const color = d3
    .scaleSequential()
    .domain(extent[0] === extent[1] ? [0, extent[1] || 1] : extent)
    .interpolator(d3.interpolateRgbBasis(MAP_RAMP));

  const isSelected = (feature) => districtKey(feature.properties.dist_num) === state.selectedDistrict;

  state.shapeSelection
    .classed("is-selected", isSelected)
    .attr("aria-pressed", isSelected)
    .transition()
    .duration(motionDuration(FILL_DURATION))
    .ease(EASE)
    .attr("fill", (feature) => {
      const district = districtKey(feature.properties.dist_num);
      return totals.has(district) ? color(totals.get(district)) : "#18283a";
    })
    .style("opacity", (feature) => (isSelected(feature) ? 1 : 0.86));

  // The halo (behind) and sheen (on top) fade in together around the selected district.
  for (const layer of [state.haloSelection, state.sheenSelection]) {
    layer
      .transition()
      .duration(motionDuration(FILL_DURATION))
      .ease(EASE)
      .style("opacity", (feature) => (isSelected(feature) ? 1 : 0));
  }

  state.labelSelection
    .classed("is-selected", isSelected)
    .select(".district-label-name")
    .transition()
    .duration(motionDuration(FILL_DURATION))
    .ease(EASE)
    .style("opacity", (feature) => (isSelected(feature) ? 1 : 0));

  document.querySelector("#map-period").textContent = periodLabel();
  const filterButton = document.querySelector("#map-filter");
  filterButton.hidden = !state.typeFilter;
  document.querySelector("#map-filter-label").textContent = state.typeFilter ? typeLabel(state.typeFilter) : "";

  state.mapReady = true;
  setText("map-selection-name", districtLabel(state.selectedDistrict));
  setText(
    "map-selection-total",
    `${numberFormat.format(totals.get(state.selectedDistrict) ?? 0)} ${
      state.typeFilter ? `${typeLabel(state.typeFilter).toLowerCase()} reports` : "reports"
    } · ${periodLabel()}`,
  );
}

function updateTrend() {
  const lookup = new Map(
    rowsForDistrict(state.selectedDistrict).map((row) => [`${row.year}-${row.month}`, row.incidents]),
  );
  const rows = [];
  for (const year of YEARS) {
    for (let month = 1; month <= 12; month += 1) {
      rows.push({ year, month, incidents: lookup.get(`${year}-${month}`) ?? 0 });
    }
  }

  const total = rows.reduce((sum, row) => sum + row.incidents, 0);
  const average = total / rows.length;
  const peak = rows.reduce((highest, row) => (row.incidents > highest.incidents ? row : highest), rows[0]);
  const lowest = rows.reduce((least, row) => (row.incidents < least.incidents ? row : least), rows[0]);
  const totalsByYear = new Map(
    YEARS.map((year) => [
      year,
      rows.filter((row) => row.year === year).reduce((sum, row) => sum + row.incidents, 0),
    ]),
  );
  const baseline = totalsByYear.get(2022);
  const change = baseline > 0 ? ((totalsByYear.get(2024) - baseline) / baseline) * 100 : null;

  const cityTotal = citywideTotal();
  const ranked = [...getMapTotals("all", null).entries()].sort((a, b) => b[1] - a[1]);
  const rank = ranked.findIndex(([district]) => district === state.selectedDistrict) + 1;

  setText("district-number", `District ${districtNumber(state.selectedDistrict)}`);
  setText("district-name", districtName(state.selectedDistrict));
  setNumber("district-total", total);
  setNumber("monthly-average", Math.round(average));
  setText("peak-month", `${MONTH_NAMES[peak.month - 1]} ${peak.year}`, `${numberFormat.format(peak.incidents)} reports`);
  setText("lowest-month", `${MONTH_NAMES[lowest.month - 1]} ${lowest.year}`, `${numberFormat.format(lowest.incidents)} reports`);
  setNumber("city-share", cityTotal ? total / cityTotal : 0, percentFormat);
  setText("district-rank", rank ? `#${rank}` : "—", rank ? `of ${ranked.length} districts, most reports first` : "");

  const maxYear = Math.max(...totalsByYear.values(), 1);
  for (const year of YEARS) {
    const yearTotal = totalsByYear.get(year);
    setNumber(`year-total-${year}`, yearTotal);
    document.querySelector(`#year-bar-${year}`).style.width = `${(yearTotal / maxYear) * 100}%`;
  }

  const trendDirection = document.querySelector("#trend-direction");
  trendDirection.textContent = change === null
    ? "No 2022 baseline"
    : `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs 2022`;
  trendDirection.classList.toggle("is-up", change !== null && change > 0);
  trendDirection.classList.toggle("is-down", change !== null && change < 0);

  const labels = rows.map((row) => `${MONTH_NAMES[row.month - 1]} ${String(row.year).slice(-2)}`);
  const values = rows.map((row) => row.incidents);

  if (state.chart) {
    state.chart.data.labels = labels;
    state.chart.data.datasets[0].data = values;
    state.chart.update();
    return;
  }

  const context = document.querySelector("#trend-chart").getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, 360);
  gradient.addColorStop(0, "rgba(56, 214, 198, 0.36)");
  gradient.addColorStop(1, "rgba(56, 214, 198, 0.01)");

  state.chart = new Chart(context, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: "#38d6c6",
        backgroundColor: gradient,
        borderWidth: 2.2,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: "#ffb454",
        pointHoverBorderColor: "#07111f",
        pointHoverBorderWidth: 2,
        tension: 0.26,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: motionDuration(650), easing: "easeOutCubic" },
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          backgroundColor: "rgba(4, 10, 19, 0.95)",
          borderColor: "rgba(180, 210, 230, 0.24)",
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: (item) => `${numberFormat.format(item.raw)} reports`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: "rgba(180, 210, 230, 0.15)" },
          ticks: {
            color: "#6f8497",
            maxRotation: 0,
            callback(value, index) {
              return index % 6 === 0 ? this.getLabelForValue(value) : "";
            },
          },
        },
        y: {
          beginAtZero: false,
          border: { display: false },
          grid: { color: "rgba(180, 210, 230, 0.1)" },
          ticks: { color: "#6f8497", callback: (value) => compactFormat.format(value) },
        },
      },
    },
  });
}

function selectDistrict(district) {
  const normalized = districtKey(district);
  if (!rowsForDistrict(normalized).length) return;
  state.selectedDistrict = normalized;
  document.querySelector("#district-select").value = normalized;
  updateMap();
  updateTrend();
  updateAnalysis();
}

function setTypeFilter(type) {
  state.typeFilter = state.typeFilter === type ? null : type;
  updateMap();
  updateTypes();
}

function renderMap() {
  const container = document.querySelector("#district-map");
  const width = Math.max(container.clientWidth, 340);
  const height = container.clientHeight || 520;
  const svg = d3
    .select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "group")
    .attr("aria-label", "Clickable choropleth map of Chicago police districts");

  // Soft halo used behind the selected district, plus a gentle sheen on top of it.
  const defs = svg.append("defs");
  defs
    .append("filter")
    .attr("id", "district-halo")
    .attr("x", "-30%")
    .attr("y", "-30%")
    .attr("width", "160%")
    .attr("height", "160%")
    .append("feGaussianBlur")
    .attr("stdDeviation", 9);

  const sheen = defs
    .append("linearGradient")
    .attr("id", "district-sheen")
    .attr("x1", "0%")
    .attr("y1", "0%")
    .attr("x2", "100%")
    .attr("y2", "100%");
  sheen.append("stop").attr("offset", "0%").attr("stop-color", "#ffffff").attr("stop-opacity", 0.18);
  sheen.append("stop").attr("offset", "55%").attr("stop-color", "#ffffff").attr("stop-opacity", 0.03);
  sheen.append("stop").attr("offset", "100%").attr("stop-color", "#ffb454").attr("stop-opacity", 0.14);

  const projection = d3.geoMercator().fitExtent(
    [[18, 14], [width - 18, height - 14]],
    state.boundaries,
  );
  const path = d3.geoPath(projection);
  const features = state.boundaries.features;
  const namedFeatures = features.filter((feature) => rowsForDistrict(feature.properties.dist_num).length);

  state.haloSelection = svg
    .append("g")
    .attr("class", "district-halos")
    .selectAll("path")
    .data(namedFeatures)
    .join("path")
    .attr("class", "district-halo")
    .attr("d", path)
    .style("opacity", 0);

  state.shapeSelection = svg
    .append("g")
    .selectAll("path")
    .data(features)
    .join("path")
    .attr("class", "district-shape")
    .attr("d", path)
    .attr("fill", "#18283a")
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", (feature) => `District ${districtLabel(feature.properties.dist_num)}, select to see details`)
    .on("click", (_, feature) => selectDistrict(feature.properties.dist_num))
    .on("keydown", (event, feature) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectDistrict(feature.properties.dist_num);
      }
    })
    .on("pointerenter pointermove", (event, feature) => {
      const district = districtKey(feature.properties.dist_num);
      const totals = getMapTotals();
      if (!totals.has(district)) {
        showTooltip(event, `<strong>District ${districtNumber(district)}</strong><span>No data for this area</span>`);
        return;
      }
      const total = totals.get(district);
      const cityTotal = state.typeFilter
        ? citywideTypeTotal(state.selectedYear, state.typeFilter)
        : citywideTotal(state.selectedYear);
      const what = state.typeFilter ? `${typeLabel(state.typeFilter).toLowerCase()} reports` : "reports";
      showTooltip(event, `<strong>${districtLabel(district)}</strong>
        <span>${numberFormat.format(total)} ${what} · ${percentFormat.format(cityTotal ? total / cityTotal : 0)} of the city total</span>
        <em>Click to see details</em>`);
    })
    .on("pointerleave", hideTooltip);

  state.sheenSelection = svg
    .append("g")
    .attr("class", "district-sheens")
    .selectAll("path")
    .data(namedFeatures)
    .join("path")
    .attr("class", "district-sheen")
    .attr("d", path)
    .attr("fill", "url(#district-sheen)")
    .style("opacity", 0);

  state.labelSelection = svg
    .append("g")
    .selectAll("text")
    .data(namedFeatures)
    .join("text")
    .attr("class", "district-label")
    .attr("transform", (feature) => `translate(${path.centroid(feature)})`)
    .attr("text-anchor", "middle");

  state.labelSelection
    .append("tspan")
    .attr("class", "district-label-number")
    .attr("dy", "0.35em")
    .text((feature) => districtNumber(feature.properties.dist_num));

  state.labelSelection
    .append("tspan")
    .attr("class", "district-label-name")
    .attr("x", 0)
    .attr("dy", "1.35em")
    .style("opacity", 0)
    .text((feature) => districtName(feature.properties.dist_num));

  updateMap();
}

function setupControls() {
  const select = document.querySelector("#district-select");
  const districts = allDistricts();
  select.innerHTML = districts
    .map((district) => `<option value="${district}">${districtLabel(district)}</option>`)
    .join("");
  if (!districts.includes(state.selectedDistrict)) {
    state.selectedDistrict = districts[0];
  }
  select.value = state.selectedDistrict;
  select.addEventListener("change", (event) => selectDistrict(event.target.value));

  document.querySelectorAll(".year-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedYear = button.dataset.year;
      document.querySelectorAll(".year-button").forEach((candidate) => {
        const isActive = candidate === button;
        candidate.classList.toggle("is-active", isActive);
        candidate.setAttribute("aria-pressed", String(isActive));
      });
      updateMap();
      updateAnalysis();
    });
  });

  document.querySelector("#map-filter").addEventListener("click", () => setTypeFilter(null));
  document.querySelector("#type-reset").addEventListener("click", () => setTypeFilter(null));

  document.querySelectorAll("#heat-mode .mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.heatMode = button.dataset.mode;
      document.querySelectorAll("#heat-mode .mode-button").forEach((candidate) => {
        const isActive = candidate === button;
        candidate.classList.toggle("is-active", isActive);
        candidate.setAttribute("aria-pressed", String(isActive));
      });
      updateHeatmap();
    });
  });
}


/* ---------- Analysis panels ---------- */

function updateAnalysis() {
  updateHeatmap();
  updateTypes();
}

// Hour x weekday grid for a district (or the whole city) over the selected period.
function hourWeekdayGrid(district) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  const sources = district === "city" ? Object.values(state.hourWeekday) : [state.hourWeekday[district] ?? {}];
  for (const byYear of sources) {
    for (const [year, cells] of Object.entries(byYear)) {
      if (state.selectedYear !== "all" && Number(year) !== Number(state.selectedYear)) continue;
      for (let dow = 0; dow < 7; dow += 1) {
        for (let hour = 0; hour < 24; hour += 1) grid[dow][hour] += cells[dow][hour];
      }
    }
  }
  return grid;
}

function renderHeatmap() {
  const container = document.querySelector("#heatmap");
  const margin = { top: 34, right: 54, bottom: 26, left: 40 };
  const width = 760;
  const cell = 30;
  const gap = 3;
  const height = margin.top + 7 * cell + margin.bottom;
  const inner = width - margin.left - margin.right;
  const x = d3.scaleBand().domain(d3.range(24)).range([0, inner]).paddingInner(gap / cell);
  const y = d3.scaleBand().domain(WEEKDAY_ORDER).range([0, 7 * cell]).paddingInner(gap / cell);

  const svg = d3
    .select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("class", "heatmap-svg");
  const group = svg.append("g").attr("transform", `translate(${margin.left}, ${margin.top})`);

  // Column totals sit above the grid as small bars; row totals as text on the right.
  const columnBars = group
    .append("g")
    .attr("class", "heat-column-bars")
    .selectAll("rect")
    .data(d3.range(24))
    .join("rect")
    .attr("x", (hour) => x(hour))
    .attr("width", x.bandwidth())
    .attr("y", -6)
    .attr("height", 0);

  const cells = group
    .append("g")
    .selectAll("rect")
    .data(d3.cross(WEEKDAY_ORDER, d3.range(24)).map(([dow, hour]) => ({ dow, hour })))
    .join("rect")
    .attr("class", "heat-cell")
    .attr("x", (d) => x(d.hour))
    .attr("y", (d) => y(d.dow))
    .attr("width", x.bandwidth())
    .attr("height", y.bandwidth())
    .attr("rx", 4)
    .attr("fill", "#18283a")
    .on("pointerenter pointermove", (event, d) => {
      const { district, city, districtTotal, cityTotal } = state.heat.current;
      const count = district[d.dow][d.hour];
      const share = districtTotal ? count / districtTotal : 0;
      const cityShare = cityTotal ? city[d.dow][d.hour] / cityTotal : 0;
      const ratio = cityShare ? share / cityShare : 0;
      const hourLabel = `${String(d.hour).padStart(2, "0")}:00–${String((d.hour + 1) % 24).padStart(2, "0")}:00`;
      showTooltip(event, `<strong>${WEEKDAY_NAMES[d.dow]} ${hourLabel}</strong>
        <span>${numberFormat.format(count)} reports · ${percentFormat.format(share)} of this district's week</span>
        <em>${ratio ? `${ratioFormat.format(ratio)}× what is typical for the city at this hour` : "No comparison available"}</em>`);
      rowLabels.classed("is-active", (dow) => dow === d.dow);
      columnLabels.classed("is-active", (hour) => hour === d.hour);
    })
    .on("pointerleave", () => {
      hideTooltip();
      rowLabels.classed("is-active", false);
      columnLabels.classed("is-active", false);
    });

  const rowLabels = group
    .append("g")
    .selectAll("text")
    .data(WEEKDAY_ORDER)
    .join("text")
    .attr("class", "heat-axis")
    .attr("x", -10)
    .attr("y", (dow) => y(dow) + y.bandwidth() / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", "end")
    .text((dow) => WEEKDAY_NAMES[dow]);

  const rowTotals = group
    .append("g")
    .selectAll("text")
    .data(WEEKDAY_ORDER)
    .join("text")
    .attr("class", "heat-total")
    .attr("x", inner + 10)
    .attr("y", (dow) => y(dow) + y.bandwidth() / 2)
    .attr("dy", "0.35em");

  const columnLabels = group
    .append("g")
    .selectAll("text")
    .data(d3.range(24))
    .join("text")
    .attr("class", "heat-axis heat-axis--hour")
    .attr("x", (hour) => x(hour) + x.bandwidth() / 2)
    .attr("y", 7 * cell + 16)
    .attr("text-anchor", "middle")
    .text((hour) => (hour % 3 === 0 ? `${String(hour).padStart(2, "0")}` : ""));

  state.heat = { cells, columnBars, rowTotals, current: null };
  updateHeatmap();
}

function updateHeatmap() {
  if (!state.heat) return;
  const district = hourWeekdayGrid(state.selectedDistrict);
  const city = hourWeekdayGrid("city");
  const districtTotal = d3.sum(district.flat());
  const cityTotal = d3.sum(city.flat());
  state.heat.current = { district, city, districtTotal, cityTotal };

  const duration = motionDuration(600);
  let fill;
  if (state.heatMode === "index") {
    // log2 ratio of the district's share of the week vs the city's share, clamped to 0.5x–2x.
    const color = d3.scaleDiverging(d3.interpolateRgbBasis(DIVERGING_RAMP)).domain([-1, 0, 1]);
    fill = (d) => {
      const share = districtTotal ? district[d.dow][d.hour] / districtTotal : 0;
      const cityShare = cityTotal ? city[d.dow][d.hour] / cityTotal : 0;
      if (!share || !cityShare) return "#18283a";
      return color(Math.max(-1, Math.min(1, Math.log2(share / cityShare))));
    };
    document.querySelector("#heat-ramp").style.background = `linear-gradient(90deg, ${DIVERGING_RAMP.join(", ")})`;
    document.querySelector("#heat-legend-low").textContent = "½× city";
    document.querySelector("#heat-legend-high").textContent = "2× city";
    document.querySelector("#heat-note").textContent =
      "Orange squares are hours that are busier in this district than is typical for the city. Blue squares are quieter than typical.";
  } else {
    // Cap the scale at the 95th percentile so the midnight spike (incidents logged
    // without a precise time default to 00:00) does not flatten every other hour.
    const cap = d3.quantile(district.flat().sort(d3.ascending), 0.95) || 1;
    const color = d3.scaleSequential(d3.interpolateRgbBasis(MAP_RAMP)).domain([0, cap]).clamp(true);
    fill = (d) => color(district[d.dow][d.hour]);
    document.querySelector("#heat-ramp").style.background = `linear-gradient(90deg, ${MAP_RAMP.join(", ")})`;
    document.querySelector("#heat-legend-low").textContent = "Fewer";
    document.querySelector("#heat-legend-high").textContent = "More";
    document.querySelector("#heat-note").textContent =
      "Each square is one hour of one weekday; the bars above add up each hour. Midnight looks high because reports with no exact time are logged at 00:00.";
  }

  state.heat.cells.transition().duration(duration).ease(EASE).attr("fill", fill);

  const hourTotals = d3.range(24).map((hour) => d3.sum(district.map((row) => row[hour])));
  const barScale = d3.scaleLinear().domain([0, d3.max(hourTotals) || 1]).range([0, 22]);
  state.heat.columnBars
    .transition()
    .duration(duration)
    .ease(EASE)
    .attr("y", (hour) => -6 - barScale(hourTotals[hour]))
    .attr("height", (hour) => barScale(hourTotals[hour]));

  state.heat.rowTotals.text((dow) => compactFormat.format(d3.sum(district[dow])));

  document.querySelector("#heat-subtitle").textContent =
    `${districtLabel(state.selectedDistrict)} · ${periodLabel()} · ${numberFormat.format(districtTotal)} reports`;
}

function updateTypes() {
  const district = state.selectedDistrict;
  const year = state.selectedYear;
  const inPeriod = (row) => year === "all" || row.year === Number(year);
  const districtCounts = d3.rollup(
    state.types.filter((row) => row.district === district && inPeriod(row)),
    (rows) => d3.sum(rows, (row) => row.incidents),
    (row) => row.type,
  );
  const cityCounts = d3.rollup(
    state.types.filter(inPeriod),
    (rows) => d3.sum(rows, (row) => row.incidents),
    (row) => row.type,
  );
  const districtTotal = d3.sum(districtCounts.values());
  const cityTotal = d3.sum(cityCounts.values());

  const rows = [...districtCounts.entries()]
    .map(([type, count]) => ({
      type,
      count,
      share: districtTotal ? count / districtTotal : 0,
      cityShare: cityTotal ? (cityCounts.get(type) ?? 0) / cityTotal : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_TYPES);
  // Keep the filtered type visible even when it falls outside the top list.
  if (state.typeFilter && !rows.some((row) => row.type === state.typeFilter)) {
    const count = districtCounts.get(state.typeFilter) ?? 0;
    rows.push({
      type: state.typeFilter,
      count,
      share: districtTotal ? count / districtTotal : 0,
      cityShare: cityTotal ? (cityCounts.get(state.typeFilter) ?? 0) / cityTotal : 0,
    });
  }

  const maxShare = d3.max(rows, (row) => Math.max(row.share, row.cityShare)) || 1;
  const duration = motionDuration(600);

  const items = d3
    .select("#type-chart")
    .selectAll(".type-row")
    .data(rows, (row) => row.type)
    .join(
      (enter) => {
        const row = enter.append("button").attr("type", "button").attr("class", "type-row");
        row.append("span").attr("class", "type-name");
        const track = row.append("span").attr("class", "type-track");
        track.append("span").attr("class", "type-bar").style("width", "0%");
        track.append("span").attr("class", "type-tick").style("left", "0%");
        row.append("span").attr("class", "type-count");
        return row;
      },
      (update) => update,
      (exit) => exit.remove(),
    )
    .classed("is-selected", (row) => row.type === state.typeFilter)
    .attr("aria-pressed", (row) => row.type === state.typeFilter)
    .on("click", (_, row) => setTypeFilter(row.type))
    .on("pointerenter pointermove", (event, row) => {
      const ratio = row.cityShare ? row.share / row.cityShare : 0;
      showTooltip(event, `<strong>${typeLabel(row.type)}</strong>
        <span>${numberFormat.format(row.count)} reports · ${percentFormat.format(row.share)} of this district's crime</span>
        <span>Whole city: ${percentFormat.format(row.cityShare)}${ratio ? ` · ${ratioFormat.format(ratio)}× the city's share` : ""}</span>
        <em>${row.type === state.typeFilter ? "Click to show all crimes again" : "Click to colour the map by this"}</em>`);
    })
    .on("pointerleave", hideTooltip);

  items.order();
  items.select(".type-name").text((row) => typeLabel(row.type));
  items.select(".type-count").text((row) => numberFormat.format(row.count));
  items
    .select(".type-bar")
    .transition()
    .duration(duration)
    .ease(EASE)
    .style("width", (row) => `${(row.share / maxShare) * 100}%`);
  items
    .select(".type-tick")
    .transition()
    .duration(duration)
    .ease(EASE)
    .style("left", (row) => `${(row.cityShare / maxShare) * 100}%`);

  document.querySelector("#types-subtitle").textContent =
    `${districtLabel(district)} · ${periodLabel()} · the ${Math.min(TOP_TYPES, rows.length)} most common of ${districtCounts.size} types`;
  document.querySelector("#type-reset").hidden = !state.typeFilter;
}

function renderForecast() {
  // Drop the partial weeks at either end so the series matches the report's ~156 weeks.
  const weeks = state.weekly.filter((row) => row.week >= "2022-01-03" && row.week <= "2024-12-23");
  const trainSize = Math.floor(weeks.length * TRAIN_SHARE);
  const labels = weeks.map((row) => row.week);
  const values = weeks.map((row) => row.incidents);

  const context = document.querySelector("#weekly-chart").getContext("2d");
  const testWindow = {
    id: "testWindow",
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const start = scales.x.getPixelForValue(trainSize - 0.5);
      ctx.save();
      ctx.fillStyle = "rgba(255, 180, 84, 0.07)";
      ctx.fillRect(start, chartArea.top, chartArea.right - start, chartArea.bottom - chartArea.top);
      ctx.strokeStyle = "rgba(255, 180, 84, 0.45)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(start, chartArea.top);
      ctx.lineTo(start, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#ffb454";
      ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "left";
      ctx.fillText("PREDICTED", start + 8, chartArea.top + 14);
      ctx.textAlign = "right";
      ctx.fillStyle = "#6f8497";
      ctx.fillText("LEARNED FROM", start - 8, chartArea.top + 14);
      ctx.restore();
    },
  };

  state.weeklyChart = new Chart(context, {
    type: "line",
    plugins: [testWindow],
    data: {
      labels,
      datasets: [
        {
          label: "Observed",
          data: values,
          borderColor: "#38d6c6",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: "#ffb454",
          pointHoverBorderColor: "#07111f",
          pointHoverBorderWidth: 2,
          tension: 0.25,
          order: 1,
        },
        {
          label: "Upper error band",
          data: [],
          borderWidth: 0,
          pointRadius: 0,
          pointHoverRadius: 0,
          backgroundColor: "rgba(255, 180, 84, 0.18)",
          fill: "+1",
          tension: 0.25,
          order: 2,
        },
        {
          label: "Lower error band",
          data: [],
          borderWidth: 0,
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0.25,
          order: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: motionDuration(650), easing: "easeOutCubic" },
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          backgroundColor: "rgba(4, 10, 19, 0.95)",
          borderColor: "rgba(180, 210, 230, 0.24)",
          borderWidth: 1,
          padding: 12,
          filter: (item) => item.datasetIndex === 0,
          callbacks: {
            title: (items) => `Week of ${items[0].label}`,
            label: (item) => `${numberFormat.format(item.raw)} reports across Chicago`,
            afterLabel: (item) => (item.dataIndex >= trainSize ? "One of the predicted weeks" : "Used to learn the pattern"),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: "rgba(180, 210, 230, 0.15)" },
          ticks: {
            color: "#6f8497",
            maxRotation: 0,
            autoSkip: false,
            // Label the first week of each quarter.
            callback(value) {
              const month = labels[value].slice(5, 7);
              if (labels[value - 1]?.slice(5, 7) === month) return "";
              return ["01", "04", "07", "10"].includes(month)
                ? `${MONTH_NAMES[Number(month) - 1]} ${labels[value].slice(2, 4)}`
                : "";
            },
          },
        },
        y: {
          beginAtZero: false,
          border: { display: false },
          grid: { color: "rgba(180, 210, 230, 0.1)" },
          ticks: { color: "#6f8497", callback: (value) => compactFormat.format(value) },
        },
      },
    },
  });

  const list = d3.select("#model-list");
  const maxError = d3.max(MODELS, (model) => model.rmse);
  const rows = list
    .selectAll(".model-row")
    .data(MODELS)
    .join("button")
    .attr("type", "button")
    .attr("class", "model-row")
    .attr("role", "listitem")
    .on("click", (_, model) => {
      state.selectedModel = model.id;
      updateForecast();
    })
    .on("pointerenter pointermove", (event, model) => {
      showTooltip(event, `<strong>${model.name}</strong>
        <span>${model.detail}</span>
        <span>Typically off by about ${numberFormat.format(model.mae)} reports a week</span>
        <em>${model.id === state.selectedModel ? "Shown on the chart" : "Click to show it on the chart"}</em>`);
    })
    .on("pointerleave", hideTooltip);

  rows.html((model) => `
    <span class="model-head">
      <span class="model-name">${model.name}</span>
      <span class="model-rank"></span>
    </span>
    <span class="model-metric"><span class="model-metric-label" title="Root mean square error">Big misses</span>
      <span class="model-track"><span class="model-bar model-bar--rmse" style="width:${(model.rmse / maxError) * 100}%"></span></span>
      <span class="model-value">${numberFormat.format(model.rmse)}</span></span>
    <span class="model-metric"><span class="model-metric-label" title="Mean absolute error">Typical</span>
      <span class="model-track"><span class="model-bar model-bar--mae" style="width:${(model.mae / maxError) * 100}%"></span></span>
      <span class="model-value">${numberFormat.format(model.mae)}</span></span>
  `);
  const ranked = [...MODELS].sort((a, b) => a.rmse - b.rmse).map((model) => model.id);
  rows.select(".model-rank").text((model) => (ranked[0] === model.id ? "Best" : `#${ranked.indexOf(model.id) + 1}`));

  state.forecast = { weeks, trainSize, values, rows };
  updateForecast();
}

function updateForecast() {
  const { trainSize, values, rows } = state.forecast;
  const model = MODELS.find((candidate) => candidate.id === state.selectedModel);
  rows.classed("is-selected", (candidate) => candidate.id === model.id)
    .attr("aria-pressed", (candidate) => candidate.id === model.id);

  const upper = values.map((value, index) => (index >= trainSize ? value + model.rmse : null));
  const lower = values.map((value, index) => (index >= trainSize ? Math.max(0, value - model.rmse) : null));
  state.weeklyChart.data.datasets[1].data = upper;
  state.weeklyChart.data.datasets[2].data = lower;
  state.weeklyChart.update();

  document.querySelector("#forecast-note").textContent =
    `${model.name}: the shaded band shows how far its predictions typically strayed from the real numbers (about ${numberFormat.format(model.rmse)} reports a week either way). Lower is better.`;
}

async function initialise() {
  try {
    const responses = await Promise.all(
      [DATA_URL, BOUNDARIES_URL, HOUR_WEEKDAY_URL, TYPES_URL, WEEKLY_URL].map((url) => fetch(url)),
    );
    if (responses.some((response) => !response.ok)) throw new Error("Data request failed");
    const [rowsResponse, boundariesResponse, hourWeekdayResponse, typesResponse, weeklyResponse] = responses;
    state.hourWeekday = await hourWeekdayResponse.json();
    state.types = (await typesResponse.json()).map((row) => ({ ...row, district: districtKey(row.district) }));
    state.weekly = await weeklyResponse.json();

    state.rows = (await rowsResponse.json()).map((row) => ({
      district: districtKey(row.district),
      year: Number(row.year),
      month: Number(row.month),
      incidents: Number(row.incidents),
    }));
    state.boundaries = await boundariesResponse.json();
    // District 31 is a placeholder boundary with no operational district behind it.
    state.boundaries.features = state.boundaries.features.filter(
      (feature) => districtKey(feature.properties.dist_num) !== "31",
    );

    setupControls();
    renderMap();
    updateTrend();
    renderHeatmap();
    renderForecast();
    updateAnalysis();
    document.querySelector("#loading-state").hidden = true;
  } catch (error) {
    console.error(error);
    document.querySelector("#loading-state").hidden = true;
    document.querySelector("#error-state").hidden = false;
  }
}

window.addEventListener("DOMContentLoaded", initialise);
