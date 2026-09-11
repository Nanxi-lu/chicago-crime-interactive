const DATA_URL = "data/district_monthly.json";
const BOUNDARIES_URL = "data/police_districts.geojson";
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const numberFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const state = {
  rows: [],
  boundaries: null,
  selectedDistrict: "7",
  selectedYear: "all",
  chart: null,
  shapeSelection: null,
};

function districtLabel(value) {
  return `District ${String(value).padStart(2, "0")}`;
}

function rowsForDistrict(district) {
  return state.rows.filter((row) => row.district === String(Number(district)));
}

function totalForDistrict(district, year = state.selectedYear) {
  return rowsForDistrict(district)
    .filter((row) => year === "all" || row.year === Number(year))
    .reduce((sum, row) => sum + row.incidents, 0);
}

function allDistricts() {
  return [...new Set(
    state.boundaries.features
      .map((feature) => String(Number(feature.properties.dist_num)))
      .filter((district) => rowsForDistrict(district).length > 0),
  )].sort((a, b) => Number(a) - Number(b));
}

function getMapTotals() {
  return new Map(allDistricts().map((district) => [district, totalForDistrict(district)]));
}

function updateMap() {
  const totals = getMapTotals();
  const values = [...totals.values()].filter((value) => value > 0);
  const extent = d3.extent(values);
  const color = d3
    .scaleSequential()
    .domain(extent[0] === extent[1] ? [0, extent[1] || 1] : extent)
    .interpolator(d3.interpolateRgbBasis(["#15334a", "#1a8d8b", "#4be1c9", "#ffb454"]));

  state.shapeSelection
    .attr("fill", (feature) => {
      const district = String(Number(feature.properties.dist_num));
      return totals.has(district) ? color(totals.get(district)) : "#18283a";
    })
    .classed("is-selected", (feature) => String(Number(feature.properties.dist_num)) === state.selectedDistrict)
    .attr("aria-pressed", (feature) => String(Number(feature.properties.dist_num)) === state.selectedDistrict);

  document.querySelector("#map-period").textContent =
    state.selectedYear === "all" ? "2022–2024" : state.selectedYear;
}

function updateTrend() {
  const sourceRows = rowsForDistrict(state.selectedDistrict).sort(
    (a, b) => a.year - b.year || a.month - b.month,
  );
  const lookup = new Map(sourceRows.map((row) => [`${row.year}-${row.month}`, row.incidents]));
  const rows = [];
  for (let year = 2022; year <= 2024; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      rows.push({
        year,
        month,
        incidents: lookup.get(`${year}-${month}`) ?? 0,
      });
    }
  }
  const total = rows.reduce((sum, row) => sum + row.incidents, 0);
  const average = total / rows.length;
  const peak = rows.reduce((highest, row) => (row.incidents > highest.incidents ? row : highest), rows[0]);
  const totalsByYear = new Map(
    [2022, 2023, 2024].map((year) => [
      year,
      rows.filter((row) => row.year === year).reduce((sum, row) => sum + row.incidents, 0),
    ]),
  );
  const baseline = totalsByYear.get(2022);
  const change = baseline > 0
    ? ((totalsByYear.get(2024) - baseline) / baseline) * 100
    : null;

  document.querySelector("#district-name").textContent = districtLabel(state.selectedDistrict);
  document.querySelector("#district-total").textContent = numberFormat.format(total);
  document.querySelector("#monthly-average").textContent = numberFormat.format(Math.round(average));
  document.querySelector("#peak-month").textContent = `${MONTH_NAMES[peak.month - 1]} ${peak.year}`;

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
  const normalized = String(Number(district));
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

  const projection = d3.geoMercator().fitExtent(
    [[18, 14], [width - 18, height - 14]],
    state.boundaries,
  );
  const path = d3.geoPath(projection);
  const tooltip = document.querySelector("#map-tooltip");

  state.shapeSelection = svg
    .append("g")
    .selectAll("path")
    .data(state.boundaries.features)
    .join("path")
    .attr("class", "district-shape")
    .attr("d", path)
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", (feature) => `${districtLabel(feature.properties.dist_num)}, select to view trend`)
    .on("click", (_, feature) => selectDistrict(feature.properties.dist_num))
    .on("keydown", (event, feature) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectDistrict(feature.properties.dist_num);
      }
    })
    .on("pointerenter pointermove", (event, feature) => {
      const district = String(Number(feature.properties.dist_num));
      const total = totalForDistrict(district);
      tooltip.innerHTML = `<strong>${districtLabel(district)}</strong><span>${total ? `${numberFormat.format(total)} incidents` : "No linked records"}</span>`;
      tooltip.hidden = false;
      tooltip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - 230)}px`;
      tooltip.style.top = `${Math.min(event.clientY + 14, window.innerHeight - 80)}px`;
    })
    .on("pointerleave", () => {
      tooltip.hidden = true;
    });

  svg
    .append("g")
    .selectAll("text")
    .data(state.boundaries.features.filter((feature) => rowsForDistrict(feature.properties.dist_num).length))
    .join("text")
    .attr("class", "district-label")
    .attr("x", (feature) => path.centroid(feature)[0])
    .attr("y", (feature) => path.centroid(feature)[1])
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .text((feature) => Number(feature.properties.dist_num));

  updateMap();
}

function setupControls() {
  const select = document.querySelector("#district-select");
  select.innerHTML = allDistricts()
    .map((district) => `<option value="${district}">${districtLabel(district)}</option>`)
    .join("");
  if (!allDistricts().includes(state.selectedDistrict)) {
    state.selectedDistrict = allDistricts()[0];
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
      district: String(Number(row.district)),
      year: Number(row.year),
      month: Number(row.month),
      incidents: Number(row.incidents),
    }));
    state.boundaries = await boundariesResponse.json();
    state.boundaries.features = state.boundaries.features.filter(
      (feature) => String(Number(feature.properties.dist_num)) !== "31",
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
