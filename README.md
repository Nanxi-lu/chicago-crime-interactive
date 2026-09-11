# Chicago Crime Patterns

Interactive GitHub Pages site for exploring reported crime trends across Chicago police districts from 2022 to 2024.

## Features

- Clickable police-district choropleth map
- Linked 36-month district trend chart
- Year controls for the map
- District totals, monthly averages, peak-month summaries, and 2022–2024 change
- Selected figures and the complete analysis report
- Responsive keyboard- and touch-friendly interface

## Data

The site uses monthly aggregates from the City of Chicago's **Crimes — 2001 to Present** dataset and the city's current police-district boundary dataset. Individual incident records are not published in this repository.

## Local preview

Serve the directory with any static web server, for example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## GitHub Pages

In the repository settings, choose **Pages → Deploy from a branch**, then publish the root of the `main` branch.
