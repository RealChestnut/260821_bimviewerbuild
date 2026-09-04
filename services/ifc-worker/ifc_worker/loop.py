"""줄을 읽고 줄을 쓰는 본체.

stdout은 프로토콜 전용이다. 사람이 읽을 것은 전부 stderr로 간다. 한 줄이라도 섞이면
그 응답은 파싱되지 않는다 (ADR-0009).

부모가 죽으면 stdin이 닫힌다. EOF를 보면 스스로 끝낸다. 고아 프로세스를 남기지 않는다.
"""

from __future__ import annotations

import platform
import sys
import traceback
from typing import IO

import ifcopenshell

from .handlers import dispatch
from .protocol import WorkerError, error_response, ok_response, parse_request, ready_line

#: 요청의 id를 아직 모를 때 쓰는 값. 줄이 깨져 id를 못 읽은 경우다.
UNKNOWN_ID = "?"


def handle_line(line: str) -> str:
    """줄 하나를 처리해 응답 줄을 돌려준다.

    어떤 실패도 예외로 새어 나가지 않는다. 루프가 한 요청 때문에 멈추면 그 뒤 요청이
    모두 막힌다.
    """
    request_id = UNKNOWN_ID
    try:
        request = parse_request(line)
        request_id = request.id
        return ok_response(request_id, dispatch(request))
    except WorkerError as error:
        return error_response(request_id, error.code, error.message)
    except Exception as cause:  # noqa: BLE001 - 마지막 그물. 코드를 붙여 값으로 돌려준다
        traceback.print_exc(file=sys.stderr)
        return error_response(request_id, "worker.internal", str(cause))


def run(stdin: IO[str], stdout: IO[str], stderr: IO[str]) -> None:
    stdout.write(ready_line(ifcopenshell.version, platform.python_version()) + "\n")
    stdout.flush()

    for line in stdin:
        stripped = line.strip()
        # 빈 줄은 요청이 아니다. 파이프에 섞여 들어올 수 있으므로 조용히 넘긴다.
        if stripped == "":
            continue

        stdout.write(handle_line(stripped) + "\n")
        # 줄마다 흘려보낸다. 버퍼에 남으면 부모가 응답을 못 본 채 마감을 맞는다.
        stdout.flush()
        stderr.flush()


def main() -> int:
    """규약은 UTF-8이다 (ADR-0009).

    Windows에서 파이프로 연결하면 Python이 지역 코드 페이지(cp949 등)를 쓴다. 그대로 두면
    한글이 든 줄이 부모에게 깨져 도착하고, 그 줄은 JSON으로 읽히지 않는다. 셋 다 UTF-8로
    맞춘 뒤 시작한다.
    """
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8")

    run(sys.stdin, sys.stdout, sys.stderr)
    return 0
