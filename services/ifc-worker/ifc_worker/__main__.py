"""`python -m ifc_worker` 진입점."""

import sys

from .loop import main

if __name__ == "__main__":
    sys.exit(main())
