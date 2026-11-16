# data_sources_ephem.md

_Owner: Gowri_

Kernel and ephemeris data citations.

## G7 Chandrayaan-3 source review

The planned G7 reference value, 8.75 +/- 0.25 degrees at landing, is retained from
`PLAN_FINAL_R3_DELTA.md` D-13 solely as a recorded, unverified comparison input. It is not
an ISRO or primary-mission result and is not a quantitative PASS criterion because no source
establishing the value was found.

| Source reviewed | Publication date | Relevant section | Exact quoted claim | Result |
|---|---|---|---|---|
| [ISRO, "Chandrayaan-3"](https://www.isro.gov.in/Chandrayaan3.html) | Not stated; mission updates shown from 2023-07-06 to 2023-09-22 | August 23, 2023 | "Chandrayaan-3 has successfully soft-landed on the moon." | Does not state 8.75 degrees, +/-0.25 degrees, or a limb convention. |
| [ISRO, "Chandrayaan-3 Details"](https://www.isro.gov.in/Chandrayaan3_Details.html) | Not stated | Overall specifications, Landing Site (Prime) | "4 km x 2.4 km 69.367621 S, 32.348126 E" | Pre-landing target, not the G7 landing coordinate; no Sun-elevation claim. |

The calculation assumptions are traceable in the G7 JSON report. Its implementation uses the
catalog/model inputs 2023-08-23T12:33:00Z, 69.373 degrees S, 32.319 degrees E, 0 m,
`MOON_ME_DE421`, and the Sun-centre topocentric direction. The NASA/LROC
[observed image annotation](https://lroc.im-ldi.com/images/1314) gives an approximate landing
fix of 69.3741 degrees S, 32.32 degrees E. This is distinct from the ISRO planned target and
from the computation input. The input timestamp, exact landing fix, 8.75-degree value,
Sun-centre versus upper-limb convention, 6-degree operations threshold, and the proposed
2-4 September transition interpretation remain source-unverified.

## G7 IM-2 source status

The G7 report evaluates catalog/model input `2025-03-06T17:28:50Z`, 84.7906 degrees S,
29.1957 degrees E for IM-2. Its second precision and coordinates remain unverified. NASA's
[touchdown update](https://www.nasa.gov/blogs/missions/2025/03/06/intuitive-machines-mission-lands-near-south-pole-carrying-nasa-science/)
reports an approximate `11:30 a.m. CST` (`17:30 UTC`) touchdown. NASA later reported that
Athena landed in a crater and on its side in a
[mission update](https://www.nasa.gov/news-release/nasa-receives-some-data-before-intuitive-machines-ends-lunar-mission/),
and that its solar cells could not recharge in a
[drill-technology update](https://www.nasa.gov/missions/artemis/nasas-lunar-drill-technology-passes-tests-on-the-moon/).
None supplies a numerical touchdown illumination, Sun elevation, or Earth elevation. The
resulting geometry is therefore model output, not independent mission validation.
