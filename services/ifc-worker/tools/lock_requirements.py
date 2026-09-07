"""설치본에 들어갈 wheel 버전을 고정한다 (ADR-0011).

`requirements.txt`는 `ifcopenshell`만 고정한다. numpy·shapely 같은 이행 의존은 그때의 최신이
들어오므로 **같은 커밋에서 만든 설치본이 항상 같지 않다.** 실제로 몇 시간 사이에 numpy가
2.5.2에서 2.5.3으로 바뀌는 것을 보았다.

이 스크립트는 pip에게 "깔지는 말고 무엇을 깔지 알려 달라"고 물어 그 답을 파일로 적는다.
`build_runtime.py`는 그 파일이 있으면 그것으로 깐다.

    python services/ifc-worker/tools/lock_requirements.py

버전을 올리고 싶을 때만 다시 돌린다. 돌리면 그날의 최신으로 갱신되므로, 갱신한 이유를
커밋에 적는다.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]

REQUIREMENTS = SERVICE_ROOT / "requirements.txt"
LOCK = SERVICE_ROOT / "requirements.lock.txt"

#: 설치본이 쓰는 짝. `build_runtime`과 같은 값이어야 한다.
WHEEL_PYTHON_VERSION = "3.13"
WHEEL_PLATFORM = "win_amd64"

HEADER = """# 설치본에 들어갈 wheel 버전. 손으로 고치지 않는다 (ADR-0011).
#
# 만드는 법:
#     python services/ifc-worker/tools/lock_requirements.py
#
# `requirements.txt`가 ifcopenshell만 고정하므로 이행 의존은 그때의 최신이 들어온다.
# 그러면 같은 커밋에서 만든 설치본이 서로 다르다. 이 파일이 그것을 막는다.
"""


def resolve(requirements: Path = REQUIREMENTS) -> list[str]:
    """pip에게 무엇을 깔지 물어 이름==버전 목록을 돌려준다.

    실제로 깔지는 않는다(`--dry-run`). 호스트 Python이 3.13이 아니어도 3.13 win_amd64
    wheel로 푼다 — 설치본이 쓸 짝이 그것이기 때문이다.
    """
    with tempfile.TemporaryDirectory() as scratch:
        report = Path(scratch) / "report.json"
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--dry-run",
                "--quiet",
                "--report",
                str(report),
                "--requirement",
                str(requirements),
                "--target",
                str(Path(scratch) / "unused"),
                "--only-binary=:all:",
                "--python-version",
                WHEEL_PYTHON_VERSION,
                "--platform",
                WHEEL_PLATFORM,
            ],
            check=True,
        )
        resolved = json.loads(report.read_text(encoding="utf-8"))

    rows = sorted(
        (item["metadata"]["name"].lower(), item["metadata"]["version"])
        for item in resolved["install"]
    )
    return [f"{name}=={version}" for name, version in rows]


def render(pins: list[str]) -> str:
    return HEADER + "\n".join(pins) + "\n"


def main() -> int:
    pins = resolve()
    LOCK.write_text(render(pins), encoding="utf-8", newline="\n")

    print(f"고정했다: {LOCK}  ({len(pins)}개)")
    for pin in pins:
        print(f"  {pin}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
