"""DineSense edge vision service: per-table occupancy from IP cameras, sent to the API as signed events.

Frames never leave the process. Nothing is written to disk except blurred calibration snapshots (on request)
and footage an operator explicitly records for labelling.
"""

__version__ = "0.1.0"
