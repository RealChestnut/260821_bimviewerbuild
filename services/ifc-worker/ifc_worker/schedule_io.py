"""Ifc4D 일정 가져오기와 내보내기.

주고받는 일정은 ADR-0005·0006·0008이 정한 v3 JSON이다. Worker는 새 스키마를 만들지
않는다. IFC 쪽 Entity는 `AGENTS.md` 2.6절이 정한 여섯을 쓴다.

operation 매핑의 정본은 ADR-0002다.

===============  ==========================  ==============================
TaskOperation    IfcTask.PredefinedType      관계
===============  ==========================  ==============================
CONSTRUCT        CONSTRUCTION                IfcRelAssignsToProduct
DEMOLISH         DEMOLITION                  IfcRelAssignsToProcess
MODIFY           RENOVATION                  IfcRelAssignsToProduct
TEMPORARY        USERDEFINED + ObjectType    IfcRelAssignsToProduct
===============  ==========================  ==============================

`PredefinedType`은 Task 하나에 하나뿐이다. 그래서 한 Task가 서로 다른 operation으로
여러 부재를 다루면 IFC로 온전히 옮길 수 없다. 그런 할당은 건너뛰고 몇 개를 못 썼는지
세어서 알린다. 조용히 버리지 않는다.
"""

from __future__ import annotations

import os
import re
from typing import Any

import ifcopenshell
import ifcopenshell.guid

from .inspection import open_ifc
from .protocol import WorkerError

#: 우리 어휘 → IFC. ADR-0002의 잠정 매핑을 왕복 테스트로 검증한 값이다.
PREDEFINED_TYPE = {
    "CONSTRUCT": "CONSTRUCTION",
    "DEMOLISH": "DEMOLITION",
    "MODIFY": "RENOVATION",
    "TEMPORARY": "USERDEFINED",
}
OPERATION_BY_PREDEFINED_TYPE = {
    "CONSTRUCTION": "CONSTRUCT",
    "DEMOLITION": "DEMOLISH",
    "RENOVATION": "MODIFY",
}

SEQUENCE_TYPES = {"FINISH_START", "START_START", "FINISH_FINISH", "START_FINISH"}

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_LAG = re.compile(r"^P(?P<days>-?\d+)D$")


def _fail(message: str) -> WorkerError:
    return WorkerError("worker.schedule.invalid", message)


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value != "" else None


def _date_only(value: Any) -> str | None:
    """IfcDateTime에서 달력 날짜만 꺼낸다. 일정의 날짜는 시각이 아니라 날짜다."""
    text = _text(value)
    if text is None:
        return None
    head = text[:10]
    return head if DATE.match(head) else None


def _validate(schedule: dict[str, Any]) -> None:
    """옮길 수 있는 모양인지만 본다. 의미 검증은 앱의 `parseSchedule`이 한다."""
    for key in ("scheduleId", "name"):
        if not isinstance(schedule.get(key), str):
            raise _fail(f"{key}가 문자열이 아니다.")
    for key in ("tasks", "dependencies", "assignments"):
        if not isinstance(schedule.get(key), list):
            raise _fail(f"{key}가 배열이 아니다.")
    for task in schedule["tasks"]:
        if not isinstance(task, dict) or not isinstance(task.get("taskId"), str):
            raise _fail("tasks에 taskId가 없는 항목이 있다.")


def _remove_existing_schedule(model: ifcopenshell.file) -> None:
    """이미 들어 있는 일정을 걷어 낸다.

    내보내기는 일정을 얹는 것이 아니라 **그 파일의 일정을 이 일정으로 만든다**. 걷어 내지
    않으면 같은 파일을 두 번 내보낼 때 Task가 겹쳐 쌓인다.

    부재와 공간 구조는 건드리지 않는다. 지우는 것은 일정이 만든 것뿐이다.
    """
    doomed: list[Any] = []

    for relation in model.by_type("IfcRelAssignsToProduct"):
        if any(related.is_a("IfcTask") for related in relation.RelatedObjects):
            doomed.append(relation)
    for relation in model.by_type("IfcRelAssignsToProcess"):
        if relation.RelatingProcess.is_a("IfcTask"):
            doomed.append(relation)
    for relation in model.by_type("IfcRelAssignsToControl"):
        if relation.RelatingControl.is_a("IfcWorkControl"):
            doomed.append(relation)
    for nests in model.by_type("IfcRelNests"):
        if nests.RelatingObject.is_a("IfcTask"):
            doomed.append(nests)

    doomed.extend(model.by_type("IfcRelSequence"))
    doomed.extend(model.by_type("IfcTaskTime"))
    doomed.extend(model.by_type("IfcLagTime"))
    doomed.extend(model.by_type("IfcTask"))
    doomed.extend(model.by_type("IfcWorkSchedule"))

    for entity in doomed:
        try:
            model.remove(entity)
        except Exception:  # noqa: BLE001 - 이미 지워진 참조는 넘어간다
            continue


def export_schedule(
    source_path: str,
    output_path: str,
    schedule: dict[str, Any],
) -> dict[str, Any]:
    """일정을 원본 IFC 위에 얹어 새 파일로 쓴다.

    원본은 읽기만 하고, 쓰기는 부모가 지정한 출력 경로에만 한다 (`AGENTS.md` 2.1절).
    """
    _validate(schedule)
    model = open_ifc(source_path)
    _remove_existing_schedule(model)

    products = {
        product.GlobalId: product
        for product in model.by_type("IfcProduct")
        if isinstance(getattr(product, "GlobalId", None), str)
    }

    # Task 하나가 여러 operation을 가질 수 없으므로 먼저 Task별 operation을 정한다.
    operation_by_task: dict[str, str] = {}
    skipped = 0
    for assignment in schedule["assignments"]:
        task_id = assignment.get("taskId")
        operation = assignment.get("operation")
        if operation not in PREDEFINED_TYPE:
            raise _fail(f"모르는 operation이다: {operation}")
        operation_by_task.setdefault(task_id, operation)

    tasks: dict[str, Any] = {}
    for source_task in schedule["tasks"]:
        task_id = source_task["taskId"]
        operation = operation_by_task.get(task_id)
        start = _date_only(source_task.get("start"))
        finish = _date_only(source_task.get("finish"))

        task_time = None
        if start is not None or finish is not None:
            task_time = model.create_entity(
                "IfcTaskTime",
                Name=task_id,
                DataOrigin="NOTDEFINED",
                DurationType="NOTDEFINED",
                ScheduleStart=None if start is None else f"{start}T00:00:00",
                ScheduleFinish=None if finish is None else f"{finish}T00:00:00",
            )

        tasks[task_id] = model.create_entity(
            "IfcTask",
            GlobalId=ifcopenshell.guid.new(),
            Name=_text(source_task.get("name")) or task_id,
            # taskId는 우리 쪽 키다. GlobalId는 파일마다 새로 나므로 Identification에 적는다.
            Identification=task_id,
            IsMilestone=False,
            TaskTime=task_time,
            PredefinedType="NOTDEFINED" if operation is None else PREDEFINED_TYPE[operation],
            # TEMPORARY는 IFC에 대응 값이 없다. USERDEFINED와 ObjectType으로 남긴다 (ADR-0002).
            ObjectType="TEMPORARY" if operation == "TEMPORARY" else None,
        )

    work_schedule = model.create_entity(
        "IfcWorkSchedule",
        GlobalId=ifcopenshell.guid.new(),
        Name=schedule["name"],
        Identification=schedule["scheduleId"],
        CreationDate="1970-01-01T00:00:00",
        StartTime="1970-01-01T00:00:00",
        PredefinedType="PLANNED",
    )

    if tasks:
        model.create_entity(
            "IfcRelAssignsToControl",
            GlobalId=ifcopenshell.guid.new(),
            RelatedObjects=list(tasks.values()),
            RelatingControl=work_schedule,
        )

    # WBS는 IfcRelNests로 옮긴다. 부모 하나에 관계 하나다.
    children: dict[str, list[Any]] = {}
    for source_task in schedule["tasks"]:
        parent_id = _text(source_task.get("parentTaskId"))
        if parent_id is None or parent_id not in tasks:
            continue
        children.setdefault(parent_id, []).append(tasks[source_task["taskId"]])
    for parent_id, nested in children.items():
        model.create_entity(
            "IfcRelNests",
            GlobalId=ifcopenshell.guid.new(),
            RelatingObject=tasks[parent_id],
            RelatedObjects=nested,
        )

    for dependency in schedule["dependencies"]:
        predecessor = tasks.get(dependency.get("predecessorId"))
        successor = tasks.get(dependency.get("successorId"))
        sequence_type = dependency.get("type")
        if predecessor is None or successor is None or sequence_type not in SEQUENCE_TYPES:
            raise _fail(f"옮길 수 없는 선후행이다: {dependency}")

        lag_days = dependency.get("lagDays", 0)
        time_lag = None
        if isinstance(lag_days, int) and lag_days != 0:
            time_lag = model.create_entity(
                "IfcLagTime",
                DataOrigin="NOTDEFINED",
                LagValue=model.create_entity("IfcDuration", f"P{lag_days}D"),
                DurationType="NOTDEFINED",
            )

        model.create_entity(
            "IfcRelSequence",
            GlobalId=ifcopenshell.guid.new(),
            RelatingProcess=predecessor,
            RelatedProcess=successor,
            TimeLag=time_lag,
            SequenceType=sequence_type,
        )

    for assignment in schedule["assignments"]:
        task = tasks.get(assignment.get("taskId"))
        product = products.get(assignment.get("productGlobalId"))
        operation = assignment.get("operation")

        # 이 파일에 없는 부재이거나, 그 Task가 다른 operation으로 정해졌으면 옮길 수 없다.
        if task is None or product is None or operation != operation_by_task.get(
            assignment.get("taskId")
        ):
            skipped += 1
            continue

        if operation == "DEMOLISH":
            model.create_entity(
                "IfcRelAssignsToProcess",
                GlobalId=ifcopenshell.guid.new(),
                RelatedObjects=[product],
                RelatingProcess=task,
            )
        else:
            model.create_entity(
                "IfcRelAssignsToProduct",
                GlobalId=ifcopenshell.guid.new(),
                RelatedObjects=[task],
                RelatingProduct=product,
            )

    model.write(output_path)
    return {
        "outputPath": output_path,
        "taskCount": len(tasks),
        "skippedAssignments": skipped,
    }


def _task_id_of(task: Any) -> str:
    """우리 쪽 키. 우리가 쓴 파일이면 Identification에 있고, 아니면 GlobalId를 쓴다."""
    return _text(getattr(task, "Identification", None)) or str(task.GlobalId)


def _operation_of(task: Any, *, demolish: bool) -> str:
    if demolish:
        return "DEMOLISH"
    predefined = _text(getattr(task, "PredefinedType", None))
    if predefined == "USERDEFINED" and _text(getattr(task, "ObjectType", None)) == "TEMPORARY":
        return "TEMPORARY"
    # 우리가 쓰지 않은 IFC에는 이 정보가 없다. 그때는 시공으로 읽는다 (ADR-0002의 알려진 손실).
    return OPERATION_BY_PREDEFINED_TYPE.get(predefined or "", "CONSTRUCT")


def import_schedule(path: str) -> dict[str, Any]:
    """IFC에 든 IfcWorkSchedule을 일정 v3 JSON으로 읽는다."""
    model = open_ifc(path)

    schedules = model.by_type("IfcWorkSchedule")
    if not schedules:
        raise WorkerError("worker.schedule.not-found", "파일에 IfcWorkSchedule이 없다.")
    work_schedule = schedules[0]

    tasks = model.by_type("IfcTask")

    parent_by_child: dict[int, Any] = {}
    for nests in model.by_type("IfcRelNests"):
        if not nests.RelatingObject.is_a("IfcTask"):
            continue
        for child in nests.RelatedObjects:
            if child.is_a("IfcTask"):
                parent_by_child[child.id()] = nests.RelatingObject

    task_rows: list[dict[str, Any]] = []
    for task in tasks:
        row: dict[str, Any] = {"taskId": _task_id_of(task), "name": _text(task.Name) or ""}

        parent = parent_by_child.get(task.id())
        if parent is not None:
            row["parentTaskId"] = _task_id_of(parent)

        task_time = getattr(task, "TaskTime", None)
        start = None if task_time is None else _date_only(task_time.ScheduleStart)
        finish = None if task_time is None else _date_only(task_time.ScheduleFinish)
        # 값 없음은 비운 채로 둔다. 0이나 오늘로 대체하지 않는다 (ADR-0002 경계 규칙 4).
        if start is not None:
            row["start"] = start
        if finish is not None:
            row["finish"] = finish

        task_rows.append(row)

    dependencies: list[dict[str, Any]] = []
    for sequence in model.by_type("IfcRelSequence"):
        sequence_type = _text(sequence.SequenceType)
        if sequence_type not in SEQUENCE_TYPES:
            continue

        lag_days = 0
        time_lag = getattr(sequence, "TimeLag", None)
        if time_lag is not None:
            # LagValue는 SELECT라 IfcDuration을 감싼 값으로 온다. 안쪽 문자열을 꺼낸다.
            raw_lag = getattr(time_lag, "LagValue", None)
            matched = _LAG.match(str(getattr(raw_lag, "wrappedValue", raw_lag) or ""))
            if matched is not None:
                lag_days = int(matched.group("days"))

        dependencies.append(
            {
                "predecessorId": _task_id_of(sequence.RelatingProcess),
                "successorId": _task_id_of(sequence.RelatedProcess),
                "type": sequence_type,
                "lagDays": lag_days,
            }
        )

    model_ref = os.path.basename(path)
    assignments: list[dict[str, Any]] = []

    for relation in model.by_type("IfcRelAssignsToProduct"):
        product_id = _text(getattr(relation.RelatingProduct, "GlobalId", None))
        if product_id is None:
            continue
        for related in relation.RelatedObjects:
            if not related.is_a("IfcTask"):
                continue
            assignments.append(
                {
                    "taskId": _task_id_of(related),
                    "modelRef": model_ref,
                    "productGlobalId": product_id,
                    "operation": _operation_of(related, demolish=False),
                }
            )

    for relation in model.by_type("IfcRelAssignsToProcess"):
        process = relation.RelatingProcess
        if not process.is_a("IfcTask"):
            continue
        for related in relation.RelatedObjects:
            product_id = _text(getattr(related, "GlobalId", None))
            if product_id is None:
                continue
            assignments.append(
                {
                    "taskId": _task_id_of(process),
                    "modelRef": model_ref,
                    "productGlobalId": product_id,
                    "operation": _operation_of(process, demolish=True),
                }
            )

    return {
        "scheduleId": _text(work_schedule.Identification) or str(work_schedule.GlobalId),
        "name": _text(work_schedule.Name) or "",
        "schemaVersion": 3,
        # IFC에는 논리 이름이 없다. 파일명을 적고 앱이 fingerprint로 다시 묶는다 (ADR-0008).
        "models": [{"modelRef": model_ref}],
        "tasks": task_rows,
        "dependencies": dependencies,
        "assignments": assignments,
    }
