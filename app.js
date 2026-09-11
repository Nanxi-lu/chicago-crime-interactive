const DATA_URL = "data/district_monthly.json";
const BOUNDARIES_URL = "data/police_districts.geojson";
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

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  rows: [],
  boundaries: null,
  selectedDistrict: "7",
  selectedYear: "all",
  chart: null,
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

function getMapTotals(year = state.selectedYear) {
  return new Map(allDistricts().map((district) => [district, totalForDistrict(district, year)]));
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

  document.querySelector("#map-period").textContent =
    state.selectedYear === "all" ? "2022–2024" : state.selectedYear;

  state.mapReady = true;
  setText("map-selection-name", districtLabel(state.selectedDistrict));
  setText(
    "map-selection-total",
    `${numberFormat.format(totals.get(state.selectedDistrict) ?? 0)} incidents · ${
      state.selectedYear === "all" ? "2022–2024" : state.selectedYear
    }`,
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
  const ranked = [...getMapTotals("all").entries()].sort((a, b) => b[1] - a[1]);
  const rank = ranked.findIndex(([district]) => district === state.selectedDistrict) + 1;

  setText("district-number", `District ${districtNumber(state.selectedDistrict)}`);
  setText("district-name", districtName(state.selectedDistrict));
  setNumber("district-total", total);
  setNumber("monthly-average", Math.round(average));
  setText("peak-month", `${MONTH_NAMES[peak.month - 1]} ${peak.year}`, `${numberFormat.format(peak.incidents)} incidents`);
  setText("lowest-month", `${MONTH_NAMES[lowest.month - 1]} ${lowest.year}`, `${numberFormat.format(lowest.incidents)} incidents`);
  setNumber("city-share", cityTotal ? total / cityTotal : 0, percentFormat);
  setText("district-rank", rank ? `#${rank}` : "—", rank ? `of ${ranked.length} districts by total` : "");

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
            label: (item) => `${numberFormat.format(item.raw)} reported incidents`,
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
  const tooltip = document.querySelector("#map-tooltip");
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
    .attr("aria-label", (feature) => `District ${districtLabel(feature.properties.dist_num)}, select to view details`)
    .on("click", (_, feature) => selectDistrict(feature.properties.dist_num))
    .on("keydown", (event, feature) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectDistrict(feature.properties.dist_num);
      }
    })
    .on("pointerenter pointermove", (event, feature) => {
      const district = districtKey(feature.properties.dist_num);
      const total = totalForDistrict(district);
      const share = total ? total / citywideTotal(state.selectedYear) : 0;
      tooltip.innerHTML = total
        ? `<strong>${districtLabel(district)}</strong>
           <span>${numberFormat.format(total)} incidents · ${percentFormat.format(share)} of city</span>
           <em>Click for full details</em>`
        : `<strong>District ${districtNumber(district)}</strong><span>No linked records</span>`;
      tooltip.hidden = false;
      tooltip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - 250)}px`;
      tooltip.style.top = `${Math.min(event.clientY + 14, window.innerHeight - 90)}px`;
    })
    .on("pointerleave", () => {
      tooltip.hidden = true;
    });

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
    });
  });
}

function setupImageDialog() {
  const dialog = document.querySelector("#image-dialog");
  const image = document.querySelector("#dialog-image");
  const caption = document.querySelector("#dialog-caption");

  document.querySelectorAll(".image-button").forEach((button) => {
    button.addEventListener("click", () => {
      image.src = button.dataset.image;
      image.alt = button.dataset.caption;
      caption.textContent = button.dataset.caption;
      dialog.showModal();
    });
  });

  document.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

async function initialise() {
  setupImageDialog();
  try {
    const [rowsResponse, boundariesResponse] = await Promise.all([
      fetch(DATA_URL),
      fetch(BOUNDARIES_URL),
    ]);
    if (!rowsResponse.ok || !boundariesResponse.ok) throw new Error("Data request failed");

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
    document.querySelector("#loading-state").hidden = true;
  } catch (error) {
    console.error(error);
    document.querySelector("#loading-state").hidden = true;
    document.querySelector("#error-state").hidden = false;
  }
}

window.addEventListener("DOMContentLoaded", initialise);
