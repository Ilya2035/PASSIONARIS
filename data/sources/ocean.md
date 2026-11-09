# Ocean currents (module "currents") — sources and licence

## What was made
- `public/assets/ocean/currents.src.json` — hand-authored waypoints of 69 surface currents (flow order, main season).
- `public/assets/ocean/currents.json` — baked game data (smoothed, ~1° spacing, nudged off land), made by
  `tools/node/node.exe tests/currents-bake.mjs --write`.

## Sources
- **No external dataset was downloaded** for this module (nothing in `data/raw/ocean/`).
  Paths, directions, typical speeds and widths were authored by hand from general oceanographic knowledge,
  the kind summarised in standard textbooks and public-domain charts, for example:
  - Talley, Pickard, Emery, Swift — *Descriptive Physical Oceanography* (6th ed., 2011) — circulation schematics (reference only).
  - U.S. Navy / NOAA public-domain "Surface Currents of the World" style charts and the NOAA Ocean Service
    education pages on ocean currents (reference only, public domain).
  - Schott & McCreary (2001), *The monsoon circulation of the Indian Ocean* — seasonal reversal of the
    Somali Current and the Southwest / Northeast Monsoon Currents (reference only).
  - Russian school-atlas classification of currents as warm / cold (тёплые / холодные) for the `kind` field.
  No text, figures or digitised geometry were copied; every coordinate was typed by hand.
- **Land mask** used to keep paths at sea: `public/assets/map/cells.bin.gz` (the game's own bake of
  Natural Earth 1:10m admin-0 countries + lakes, public domain — see `data/ATTRIBUTION.md`).
  Every baked point and every segment (sampled along its great-circle arc every <= 1.2 km, i.e. finer
  than one 4.9 km MAP texel) is open ocean (cell id 0).

## Licence
The authored data (`currents.src.json`, `currents.json`) is original work of the Passionaris project and
can be used under the project's licence. Natural Earth (used only through the land mask) is public domain.

## Caveats
- Paths are schematic, climatological mean positions (like a game or atlas map), not a model: eddies,
  meanders, interannual variability and sea-level change are not represented.
- Seasonality is modelled only for the Somali Current (reverses Dec–Mar), the Southwest Monsoon Current
  (Jun–Sep), the Northeast Monsoon Current (Dec–Mar), the Indian Ocean Equatorial Countercurrent (Dec–Apr) and
  the Davidson Current (Nov–Feb); `weakMonths` mark transition months at reduced strength.
- Speeds are typical surface values in m/s; the renderer compresses them (speed^0.55) for on-screen drift.
