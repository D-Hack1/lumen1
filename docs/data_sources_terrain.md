# data_sources_terrain.md

_Owner: Shiva Shakthi_ (citations compiled by Ebin from `pipeline/config/dem_sources.yaml` and the published layer sidecars)

DEM and terrain data citations. Every elevation product below is read from the NASA Planetary Geodesy Data Archive (PGDA) or the LROC
archive and is used only through the pipeline's own readers; no value is typed in by hand.

## Elevation models

| Product key | Product | Resolution | Coverage | Source page |
|---|---|---|---|---|
| `polar_5m_lola_pgda_81` | Polar LOLA mosaic | 5 m | 87–90°S | [PGDA product 81](https://pgda.gsfc.nasa.gov/products/81) |
| `site_specific_5m_lola_pgda_78` | Site-specific LOLA products (with total Z uncertainty and clone products) | 5 m | site-specific | [PGDA product 78](https://pgda.gsfc.nasa.gov/products/78) |
| `polar_10m_lola_pgda_90` | Polar LOLA mosaic (`LDEM_83S_10MPP_ADJ`) | 10 m | 83–90°S | [PGDA product 90](https://pgda.gsfc.nasa.gov/products/90) |
| `polar_20m_lola_pgda_90` | Polar LOLA mosaic (`LDEM_80S_20MPP_ADJ`) | 20 m | 80–90°S | [PGDA product 90](https://pgda.gsfc.nasa.gov/products/90) |
| `polar_60m_lola_pgda_90` | Regional LOLA mosaic (`LDEM_60S_60MPP_ADJ`) | 60 m | 60–90°S | [PGDA product 90](https://pgda.gsfc.nasa.gov/products/90) |
| `regional_240m_lola_pgda_90` | Regional LOLA mosaic (`LDEM_60S_240MPP_ADJ`) | 240 m | 60–90°S | [PGDA product 90](https://pgda.gsfc.nasa.gov/products/90) |
| `chandrayaan3_lroc_vikramsite_dtm` | LROC pre-landing Vikram-site DTM | 3 m | Vikram landing site | [LROC RDR viewer](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_DTM_VIKRAMSITE1) |
| `chandrayaan3_lola_30m_pgda_90` | LOLA product (`LDEM_75S_30MPP_ADJ`) | 30 m | 75–90°S | [PGDA product 90](https://pgda.gsfc.nasa.gov/products/90) |
| `lroc_nac_dtm_apollo11` | LROC NAC stereo DTM `NAC_DTM_APOLLO11` (pad slope only; relative linear error 0.77 m, RMS vs LOLA 1.81 m) | 2 m | landing site | [LROC RDR APOLLO11](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_DTM_APOLLO11) |
| `lroc_nac_dtm_apollo12` | LROC NAC stereo DTM `NAC_DTM_APOLLO12` (pad slope only; relative linear error 0.8 m, RMS vs LOLA 1.31 m) | 2 m | landing site | [LROC RDR APOLLO12](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_DTM_APOLLO12) |
| `lroc_nac_dtm_apollo14` | LROC NAC stereo DTM `NAC_DTM_APOLLO14` (pad slope only; relative linear error 0.76 m, RMS vs LOLA 0.76 m) | 2 m | landing site | [LROC RDR APOLLO14](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_DTM_APOLLO14) |
| `lroc_nac_dtm_apollo15` | LROC NAC stereo DTM `NAC_DTM_APOLLO15` (pad slope only; relative linear error 1.06 m, RMS vs LOLA 1.74 m) | 2 m | landing site | [LROC RDR APOLLO15](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_DTM_APOLLO15) |
| `lroc_nac_dtm_apollo16` | LROC NAC stereo DTM `NAC_DTM_APOLLO16` (pad slope only; relative linear error 0.88 m, RMS vs LOLA 1.02 m) | 2 m | landing site | [LROC RDR APOLLO16](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_DTM_APOLLO16) |
| `lroc_nac_dtm_apollo17` | LROC NAC stereo DTM `NAC_DTM_APOLLO17` (pad slope only; relative linear error 2.55 m, RMS vs LOLA 1.77 m) | 5 m | landing site | [LROC RDR APOLLO17](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_DTM_APOLLO17) |
| `lroc_nac_dtm_change6` | LROC NAC stereo DTM `NAC_DTM_CHANGE6` (pad slope only; relative linear error 2.61 m, RMS vs LOLA 2.05 m) | 4 m | landing site | [LROC RDR CHANGE6](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_DTM_CHANGE6) |
| (G9 evidence) | LROC NAC stereo DTM `NAC_DTM_VIKRAMSITE1` + its two 3 m orthophotos (relative linear error 1.92 m, RMS vs LOLA 1.85 m) | 3 m | CY-3 landing area | [LROC RDR VIKRAMSITE1](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_DTM_VIKRAMSITE1) |

LROC NAC DTMs (NASA PDS `LRO-L-LROC-5-RDR-V1.0`, volume `LROLRC_2001`; method Henriksen et al. 2017, *Icarus* 283, 122–137) are used only for
the pad slope of the listed coarse-mask sites (`pipeline/scripts/run_pad_lroc.py`) and for the G9 shadow comparison; the horizon masks and σ of
those sites still come from the global LDEM_128. Blue Ghost (Mare Crisium) and SLIM (Shioli) have no LROC NAC DTM, so they have no pad slope.

Tier-A horizon masks use the finest product that covers a site out to 5 km (near field), a 20 m product to 80 km and the 240 m product to
250 km (see `pipeline/config/terrain.yaml`). The vertical datum of the adjusted LOLA products relative to the 1,737.4 km reference sphere
is **not formally confirmed** (recorded as an open item in `MC_SIGMA_REPORT.md`).

## Maps shown or derived in the app

- **Average solar illumination and Earth visibility** (85–90°S and 80–90°S layers, 60 m/px): Mazarico, E., et al. (2011), *Icarus* 211,
  1066–1081, [doi:10.1016/j.icarus.2010.10.030](https://doi.org/10.1016/j.icarus.2010.10.030); product via PGDA.
- **Permanently shadowed regions (derived):** pixels with 0 % average illumination in the layer above; tagged "derived" wherever shown.
- **Artemis III candidate landing-region outlines:** [USGS Astrogeology lunar polar maps](https://astrogeology.usgs.gov/search/map/Moon/Lunar_Polar_Maps).
- **Polar terrain picture on the Orbit page:** NASA LRO LOLA 80 m south-polar DEM, averaged to 768 px; horizons and illumination computed
  from it for the app (`web/public/content/orbit/orbit.json`).
- **South-pole photo base:** LROC mosaic exported from [LROC QuickMap](https://quickmap.lroc.im-ldi.com/);
  credit NASA/GSFC/Arizona State University (`web/public/content/moon/south_pole_lroc.json`).

## Checks that were made against these sources

- `pipeline/scripts/check_site_illumination.py` reads the illumination layer at a site's coordinates. At the time of writing it reports
  ~45 % at the IM-2 site, and 0 % at the catalogue's Shackleton-ridge coordinates (−89.54°, 129.0°E) — see `docs/limitations.md`.
