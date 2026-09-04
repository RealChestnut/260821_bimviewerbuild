"""수령 파일 점검 (`inspect`).

기준서 20절의 점검 항목 중 **기계가 볼 수 있는 것만** 사실로 돌려준다. "받아들일 만한
파일인가"는 판정하지 않는다. 검증 게이트(reject / warn)는 `AGENTS.md` 1.4절이 아직
미결정으로 둔 항목이라 여기서 굳히지 않는다 (ADR-0009).

Schema는 Header의 FILE_SCHEMA에서 나온다. 파일명이나 확장자로 추정하지 않는다
(`AGENTS.md` 2.3절).
"""

from __future__ import annotations

import os
from collections import Counter
from typing import Any

import ifcopenshell

from .protocol import WorkerError

#: 다룰 수 있는 Schema. 마스터 계획 2.1절은 IFC2x3와 IFC4를 우선한다.
SUPPORTED_SCHEMAS = ("IFC2X3", "IFC4", "IFC4X3", "IFC4X3_ADD2")


def open_ifc(path: str) -> ifcopenshell.file:
    """IFC를 연다. 원본은 읽기만 한다 (`AGENTS.md` 2.1절)."""
    if not os.path.isfile(path):
        raise WorkerError("worker.file.not-found", f"파일이 없다: {path}")

    try:
        model = ifcopenshell.open(path)
    except Exception as cause:  # noqa: BLE001 - 라이브러리가 던지는 예외가 한 갈래가 아니다
        raise WorkerError("worker.ifc.unreadable", f"IFC를 읽지 못했다: {cause}") from cause

    schema = str(model.schema).upper()
    if schema not in SUPPORTED_SCHEMAS:
        raise WorkerError(
            "worker.ifc.unsupported-schema",
            f"다룰 수 없는 Schema다: {model.schema}",
        )
    return model


def _length_unit(model: ifcopenshell.file) -> str | None:
    """길이 단위 이름. 접두어가 있으면 붙여 돌려준다."""
    for assignment in model.by_type("IfcUnitAssignment"):
        for unit in assignment.Units:
            if not unit.is_a("IfcSIUnit"):
                continue
            if unit.UnitType != "LENGTHUNIT":
                continue
            prefix = getattr(unit, "Prefix", None)
            return f"{prefix}{unit.Name}" if prefix else str(unit.Name)
    return None


def inspect_model(model: ifcopenshell.file) -> dict[str, Any]:
    """파일이 담고 있는 사실을 모은다."""
    elements = model.by_type("IfcElement")

    seen: set[str] = set()
    duplicates: set[str] = set()
    missing = 0
    for root in model.by_type("IfcRoot"):
        global_id = getattr(root, "GlobalId", None)
        # GlobalId가 없거나 중복인 경우를 조용히 넘기지 않는다 (`AGENTS.md` 2.2절).
        if not isinstance(global_id, str) or global_id == "":
            missing += 1
            continue
        if global_id in seen:
            duplicates.add(global_id)
        seen.add(global_id)

    return {
        "schema": str(model.schema),
        "productCount": len(elements),
        "products": dict(sorted(Counter(element.is_a() for element in elements).items())),
        "duplicateGlobalIds": sorted(duplicates),
        "missingGlobalIdCount": missing,
        "hasWorkSchedule": len(model.by_type("IfcWorkSchedule")) > 0,
        "units": {"length": _length_unit(model)},
    }


def inspect_file(path: str) -> dict[str, Any]:
    return inspect_model(open_ifc(path))
