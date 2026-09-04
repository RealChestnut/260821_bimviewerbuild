"""줄 단위 JSON 규약.

규약의 정본은 ``docs/adr/0009-ifc-worker-ipc.md``다. 한 줄에 JSON 하나이며 stdout은
프로토콜 전용이다. 사람이 읽을 것은 전부 stderr로 간다.

실패는 예외가 아니라 값으로 나간다. 이 모듈의 ``WorkerError``는 그 값을 만들기 위한
내부 표현이며, 루프가 받아 ``ok: false`` 줄로 바꾼다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

#: 규약 버전. 부모가 아는 값과 다르면 부모가 워커를 죽인다.
PROTOCOL_VERSION = 1


class WorkerError(Exception):
    """기계가 분기할 수 있는 코드를 가진 실패.

    ``code``는 ``worker.``로 시작하는 안정된 문자열이다. 메시지는 사람이 읽는다.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Request:
    id: str
    method: str
    params: dict[str, Any] = field(default_factory=dict)


def parse_request(line: str) -> Request:
    """줄 하나를 요청으로 읽는다.

    형태를 믿지 않고 전부 검사한다. 파일은 사람이 손으로 만들 수 있고 나중에는 다른
    언어로 쓴 부모가 보낸다.
    """
    try:
        raw = json.loads(line)
    except json.JSONDecodeError as cause:
        raise WorkerError("worker.request.malformed", f"JSON이 아니다: {cause}") from cause

    if not isinstance(raw, dict):
        raise WorkerError("worker.request.malformed", "요청은 JSON 객체여야 한다.")

    request_id = raw.get("id")
    if not isinstance(request_id, str) or request_id == "":
        raise WorkerError("worker.request.malformed", "id가 비어 있다.")

    method = raw.get("method")
    if not isinstance(method, str) or method == "":
        raise WorkerError("worker.request.malformed", "method가 비어 있다.")

    params = raw.get("params", {})
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise WorkerError("worker.request.malformed", "params는 객체여야 한다.")

    return Request(id=request_id, method=method, params=params)


def _line(payload: dict[str, Any]) -> str:
    # ensure_ascii=False로 한글을 그대로 싣는다. 줄 안에 날 개행은 JSON이 이스케이프한다.
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def ok_response(request_id: str, result: dict[str, Any]) -> str:
    return _line({"id": request_id, "ok": True, "result": result})


def error_response(request_id: str, code: str, message: str) -> str:
    return _line({"id": request_id, "ok": False, "error": {"code": code, "message": message}})


def ready_line(ifcopenshell_version: str, python_version: str) -> str:
    """시작을 알리는 첫 줄. 부모는 이 줄을 보고 준비를 안다."""
    return _line(
        {
            "event": "ready",
            "protocol": PROTOCOL_VERSION,
            "ifcopenshell": ifcopenshell_version,
            "python": python_version,
        }
    )


def require_str(params: dict[str, Any], key: str) -> str:
    value = params.get(key)
    if not isinstance(value, str) or value.strip() == "":
        raise WorkerError("worker.request.malformed", f"params.{key}가 비어 있다.")
    return value


def require_dict(params: dict[str, Any], key: str) -> dict[str, Any]:
    value = params.get(key)
    if not isinstance(value, dict):
        raise WorkerError("worker.request.malformed", f"params.{key}가 객체가 아니다.")
    return value
