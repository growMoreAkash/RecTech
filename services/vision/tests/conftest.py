from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

CONTRACTS = Path(__file__).parent.parent / "dinesense_vision" / "contracts" / "edge-contracts.json"


@pytest.fixture(scope="session")
def contracts() -> dict[str, Any]:
    return json.loads(CONTRACTS.read_text())  # type: ignore[no-any-return]
