# Chicago Crime Patterns

Interactive GitHub Pages site for exploring reported crime trends across Chicago police districts from 2022 to 2024.

## Features

- Clickable police-district choropleth map
- Linked 36-month district trend chart
- Year controls for the map
- Official CPD district names
- District totals, monthly averages, peak and lowest months, citywide share, rank, yearly breakdown, and 2022–2024 change
- Linked analysis panels: hour × weekday heatmap (counts or vs. city), crime-type mix with click-to-filter map, and weekly citywide series with the report's model errors
- Responsive keyboard- and touch-friendly interface

## Data

The site uses aggregates from the City of Chicago's **Crimes — 2001 to Present** dataset and the city's current police-district boundary dataset. Individual incident records are not published in this repository.

- `fetch_data.mjs` — monthly counts by district (`data/district_monthly.json`)
- `fetch_analysis.mjs` — hour × weekday counts, primary-type counts by district, and daily citywide counts rolled up to weeks (`data/district_hour_weekday.json`, `data/district_types.json`, `data/weekly_city.json`)

Model errors in the forecasting panel are taken from the accompanying report (Table 1).

## Local preview

Serve the directory with any static web server, for example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## GitHub Pages

Every push to `main` deploys the site via the workflow in `.github/workflows/pages.yml`. Live at https://nanxi-lu.github.io/chicago-crime-interactive/
