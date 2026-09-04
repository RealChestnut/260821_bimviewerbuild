from pathlib import Path

import pytest

#: 저장소 뿌리. services/ifc-worker/tests 에서 두 단계 위다.
ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "packages" / "test-fixtures" / "ifc"


@pytest.fixture
def three_elements() -> str:
    """벽 2, 슬래브 1. 일정 fixture가 가리키는 GlobalId를 담고 있다."""
    return str(FIXTURES / "three-elements-ifc4.ifc")


@pytest.fixture
def minimal_wall() -> str:
    return str(FIXTURES / "minimal-wall-ifc4.ifc")
