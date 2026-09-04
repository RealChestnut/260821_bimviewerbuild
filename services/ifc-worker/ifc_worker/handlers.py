"""method 이름과 하는 일의 짝.

핸들러는 params를 받아 result를 돌려준다. 실패는 `WorkerError`로 던지고, 루프가 그것을
``ok: false`` 줄로 바꾼다.
"""

from __future__ import annotations

from typing import Any, Callable

from .inspection import inspect_file
from .protocol import Request, WorkerError, require_dict, require_str
from .schedule_io import export_schedule, import_schedule

Handler = Callable[[dict[str, Any]], dict[str, Any]]


def _ping(_params: dict[str, Any]) -> dict[str, Any]:
    return {"pong": True}


def _inspect(params: dict[str, Any]) -> dict[str, Any]:
    return inspect_file(require_str(params, "path"))


def _import_schedule(params: dict[str, Any]) -> dict[str, Any]:
    return {"schedule": import_schedule(require_str(params, "path"))}


def _export_schedule(params: dict[str, Any]) -> dict[str, Any]:
    return export_schedule(
        require_str(params, "sourcePath"),
        require_str(params, "outputPath"),
        require_dict(params, "schedule"),
    )


HANDLERS: dict[str, Handler] = {
    "ping": _ping,
    "inspect": _inspect,
    "import-schedule": _import_schedule,
    "export-schedule": _export_schedule,
}


def dispatch(request: Request) -> dict[str, Any]:
    handler = HANDLERS.get(request.method)
    if handler is None:
        # 모르는 method를 조용히 넘기지 않는다. 부모가 규약을 잘못 안 것이다.
        raise WorkerError("worker.method.unknown", f"모르는 method다: {request.method}")
    return handler(request.params)
