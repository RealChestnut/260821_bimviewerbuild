import pytest

from ifc_worker.protocol import WorkerError
from ifc_worker.schedule_io import export_schedule, import_schedule

SLAB = "2YsHnV6bk3PgZdL9uCxWtM"
WALL_A = "0BnKdW4tq7SfUcM3vHxZgR"
WALL_B = "1MjTgR8dp5NkXbC2wFyQsA"

MODEL_REF = "three-elements-ifc4.ifc"


def schedule() -> dict:
    """왕복에 쓸 일정. WBS·선후행·네 가지 operation을 모두 담는다."""
    return {
        "scheduleId": "mock",
        "name": "왕복 시험 일정",
        "schemaVersion": 3,
        "models": [{"modelRef": MODEL_REF}],
        "tasks": [
            {"taskId": "W1", "name": "1층 골조"},
            {
                "taskId": "T001",
                "name": "슬래브 타설",
                "parentTaskId": "W1",
                "start": "2026-03-02",
                "finish": "2026-03-06",
            },
            {
                "taskId": "T002",
                "name": "벽 A 시공",
                "parentTaskId": "W1",
                "start": "2026-03-09",
                "finish": "2026-03-13",
            },
            {"taskId": "T003", "name": "벽 B 철거", "start": "2026-03-16", "finish": "2026-03-20"},
            {"taskId": "T004", "name": "가설 지지", "start": "2026-03-23", "finish": "2026-03-25"},
            {"taskId": "T005", "name": "검사 (시간 미정)"},
        ],
        "dependencies": [
            {
                "predecessorId": "T001",
                "successorId": "T002",
                "type": "FINISH_START",
                "lagDays": 2,
            },
            {"predecessorId": "T002", "successorId": "T003", "type": "START_START", "lagDays": 0},
        ],
        "assignments": [
            {
                "taskId": "T001",
                "modelRef": MODEL_REF,
                "productGlobalId": SLAB,
                "operation": "CONSTRUCT",
            },
            {
                "taskId": "T002",
                "modelRef": MODEL_REF,
                "productGlobalId": WALL_A,
                "operation": "MODIFY",
            },
            {
                "taskId": "T003",
                "modelRef": MODEL_REF,
                "productGlobalId": WALL_B,
                "operation": "DEMOLISH",
            },
            {
                "taskId": "T004",
                "modelRef": MODEL_REF,
                "productGlobalId": WALL_A,
                "operation": "TEMPORARY",
            },
        ],
    }


@pytest.fixture
def exported(tmp_path, three_elements: str) -> str:
    output = str(tmp_path / "with-schedule.ifc")
    export_schedule(three_elements, output, schedule())
    return output


class TestExport:
    def test_원본을_고치지_않는다(self, tmp_path, three_elements: str) -> None:
        before = open(three_elements, "rb").read()

        export_schedule(three_elements, str(tmp_path / "out.ifc"), schedule())

        # 원본 IFC는 읽기 전용이다 (AGENTS.md 2.1절).
        assert open(three_elements, "rb").read() == before

    def test_쓴_Task_수를_돌려준다(self, tmp_path, three_elements: str) -> None:
        result = export_schedule(three_elements, str(tmp_path / "out.ifc"), schedule())

        assert result["taskCount"] == 6
        assert result["outputPath"].endswith("out.ifc")

    def test_모델에_없는_부재는_건너뛰고_센다(self, tmp_path, three_elements: str) -> None:
        source = schedule()
        source["assignments"].append(
            {
                "taskId": "T005",
                "modelRef": "다른모델.ifc",
                "productGlobalId": "3AbCdEfGhIjKlMnOpQrStU",
                "operation": "CONSTRUCT",
            }
        )

        result = export_schedule(three_elements, str(tmp_path / "out.ifc"), source)

        # 조용히 버리지 않는다. 몇 개를 못 썼는지 알린다.
        assert result["skippedAssignments"] == 1

    def test_없는_원본은_거부한다(self, tmp_path) -> None:
        with pytest.raises(WorkerError) as raised:
            export_schedule(str(tmp_path / "없다.ifc"), str(tmp_path / "out.ifc"), schedule())

        assert raised.value.code == "worker.file.not-found"

    def test_일정이_스키마에_맞지_않으면_거부한다(self, tmp_path, three_elements: str) -> None:
        with pytest.raises(WorkerError) as raised:
            export_schedule(three_elements, str(tmp_path / "out.ifc"), {"tasks": []})

        assert raised.value.code == "worker.schedule.invalid"


class TestImport:
    def test_일정이_없는_모델은_거부한다(self, three_elements: str) -> None:
        with pytest.raises(WorkerError) as raised:
            import_schedule(three_elements)

        # IfcTask가 없는 파일은 정상이며, 없다는 사실을 코드로 알린다.
        assert raised.value.code == "worker.schedule.not-found"

    def test_머리말을_읽는다(self, exported: str) -> None:
        result = import_schedule(exported)

        assert result["schemaVersion"] == 3
        assert result["scheduleId"] == "mock"
        assert result["name"] == "왕복 시험 일정"

    def test_모델_이름은_파일명으로_적는다(self, exported: str) -> None:
        result = import_schedule(exported)

        # IFC에는 논리 이름이 없다. 파일명을 적고 앱이 다시 묶는다 (ADR-0008).
        assert [model["modelRef"] for model in result["models"]] == ["with-schedule.ifc"]
        assert "fingerprint" not in result["models"][0]


class TestRoundTrip:
    def test_Task와_계층이_돌아온다(self, exported: str) -> None:
        result = import_schedule(exported)

        by_id = {task["taskId"]: task for task in result["tasks"]}
        assert set(by_id) == {"W1", "T001", "T002", "T003", "T004", "T005"}
        assert by_id["T001"]["name"] == "슬래브 타설"
        assert by_id["T001"]["parentTaskId"] == "W1"
        assert "parentTaskId" not in by_id["W1"]

    def test_날짜가_그대로_돌아온다(self, exported: str) -> None:
        by_id = {task["taskId"]: task for task in import_schedule(exported)["tasks"]}

        assert by_id["T001"]["start"] == "2026-03-02"
        assert by_id["T001"]["finish"] == "2026-03-06"

    def test_시간이_없는_Task는_비운_채로_돌아온다(self, exported: str) -> None:
        by_id = {task["taskId"]: task for task in import_schedule(exported)["tasks"]}

        # 0이나 오늘로 대체하지 않는다 (ADR-0002 경계 규칙 4).
        assert "start" not in by_id["T005"]
        assert "finish" not in by_id["T005"]

    def test_선후행이_유형과_지연까지_돌아온다(self, exported: str) -> None:
        result = import_schedule(exported)

        assert sorted(
            (
                dependency["predecessorId"],
                dependency["successorId"],
                dependency["type"],
                dependency["lagDays"],
            )
            for dependency in result["dependencies"]
        ) == [
            ("T001", "T002", "FINISH_START", 2),
            ("T002", "T003", "START_START", 0),
        ]

    def test_네_가지_operation이_모두_돌아온다(self, exported: str) -> None:
        result = import_schedule(exported)

        assert sorted(
            (assignment["taskId"], assignment["productGlobalId"], assignment["operation"])
            for assignment in result["assignments"]
        ) == [
            ("T001", SLAB, "CONSTRUCT"),
            ("T002", WALL_A, "MODIFY"),
            ("T003", WALL_B, "DEMOLISH"),
            ("T004", WALL_A, "TEMPORARY"),
        ]

    def test_두_번_왕복해도_같다(self, tmp_path, exported: str) -> None:
        once = import_schedule(exported)
        twice_path = str(tmp_path / "again.ifc")
        export_schedule(exported, twice_path, once)

        twice = import_schedule(twice_path)

        # 내보내기는 일정을 얹지 않고 갈아 끼운다. 두 번 돌려도 Task가 겹쳐 쌓이지 않는다.
        assert twice["tasks"] == once["tasks"]
        assert sorted(map(str, twice["dependencies"])) == sorted(map(str, once["dependencies"]))

        # modelRef는 읽은 파일의 이름이므로 파일이 바뀌면 함께 바뀐다. 나머지가 같은지 본다.
        def without_model_ref(rows: list[dict]) -> list[str]:
            return sorted(
                str((row["taskId"], row["productGlobalId"], row["operation"])) for row in rows
            )

        assert without_model_ref(twice["assignments"]) == without_model_ref(once["assignments"])
