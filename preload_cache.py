"""Compatibility wrapper for the PAL-AI local elevation cache preloader.

Use this from the project root:
    python preload_cache.py --demo
    python preload_cache.py --status
"""

from backend.preload_elevation_cache import main

if __name__ == "__main__":
    raise SystemExit(main())
