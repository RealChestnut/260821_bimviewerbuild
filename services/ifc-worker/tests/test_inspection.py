import pytest

from ifc_worker.inspection import inspect_file, open_ifc
from ifc_worker.protocol import WorkerError


class TestInspectFile:
    def test_Header의_Schema를_읽는다(self, three_elements: str) -> None:
        # 파일명이나 확장자로 추정하지 않는다 (AGENTS.md 2.3절).
        assert inspect_file(three_elements)["schema"] == "IFC4"

    def test_부재를_종류별로_센다(self, three_elements: str) -> None:
        result = inspect_file(three_elements)

        assert result["productCount"] == 3
        assert result["products"] == {"IfcSlab": 1, "IfcWall": 2}

    def test_GlobalId가_성하면_비어_있다(self, three_elements: str) -> None:
        result = inspect_file(three_elements)

        assert result["duplicateGlobalIds"] == []
        assert result["missingGlobalIdCount"] == 0

    def test_일정이_없는_모델을_알린다(self, three_elements: str) -> None:
        # 파일에 IfcTask가 없는 것은 오류가 아니라 정상 경로다 (AGENTS.md 2.6절).
        assert inspect_file(three_elements)["hasWorkSchedule"] is False

    def test_길이_단위를_알린다(self, three_elements: str) -> None:
        assert inspect_file(three_elements)["units"] == {"length": "METRE"}

    def test_부재가_하나인_모델도_읽는다(self, minimal_wall: str) -> None:
        result = inspect_file(minimal_wall)

        assert result["productCount"] == 1
        assert result["products"] == {"IfcWall": 1}


class TestOpenIfc:
    def test_없는_파일은_거부한다(self, tmp_path) -> None:
        with pytest.raises(WorkerError) as raised:
            open_ifc(str(tmp_path / "없다.ifc"))

        assert raised.value.code == "worker.file.not-found"

    def test_IFC가_아니면_거부한다(self, tmp_path) -> None:
        broken = tmp_path / "broken.ifc"
        broken.write_text("이건 IFC가 아니다", encoding="utf-8")

        with pytest.raises(WorkerError) as raised:
            open_ifc(str(broken))

        assert raised.value.code == "worker.ifc.unreadable"

    def test_다룰_수_없는_Schema는_거부한다(self, tmp_path, three_elements: str) -> None:
        source = open(three_elements, encoding="utf-8").read()
        odd = tmp_path / "odd.ifc"
        odd.write_text(source.replace("FILE_SCHEMA(('IFC4'))", "FILE_SCHEMA(('IFC9X9'))"), encoding="utf-8")

        with pytest.raises(WorkerError) as raised:
            open_ifc(str(odd))

        # 모르는 Schema를 아는 척 읽지 않는다.
        assert raised.value.code in {
            "worker.ifc.unsupported-schema",
            "worker.ifc.unreadable",
        }
