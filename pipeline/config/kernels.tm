KPL/MK

\begindata

PATH_SYMBOLS = ( 'KERNELS' )
PATH_VALUES  = ( '../kernels' )

KERNELS_TO_LOAD = (
   '$KERNELS/naif0012.tls'                         /* NAIF generic kernels */
   '$KERNELS/pck00011.tpc'                          /* NAIF generic kernels */
   '$KERNELS/de421.bsp'                             /* NAIF planetary SPK */
   '$KERNELS/moon_pa_de421_1900-2050.bpc'           /* NAIF lunar binary PCK */
   '$KERNELS/moon_080317.tf'                        /* NAIF lunar frame kernel */
)

\begintext

LUMEN G-4 lunar/ephemeris kernel lock. Download these files into
pipeline/kernels (or set LUMEN_KERNEL_DIR). The binaries are intentionally
gitignored. Sources: https://naif.jpl.nasa.gov/pub/naif/generic_kernels/.
No DE440 lunar kernels may be loaded with this set.
