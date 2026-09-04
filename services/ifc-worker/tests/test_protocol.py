import json

import pytest

from ifc_worker.protocol import (
    PROTOCOL_VERSION,
    WorkerError,
    error_response,
    ok_response,
    parse_request,
    ready_line,
    require_dict,
    require_str,
)


def code_of(line: str) -> str:
    with pytest.raises(WorkerError) as raised:
        parse_request(line)
    return raised.value.code


class TestParseRequest:
    def test_읽는다(self) -> None:
        request = parse_request('{"id":"1","method":"ping","params":{"a":1}}')

        assert request.id == "1"
        assert request.method == "ping"
        assert request.params == {"a": 1}

    def test_params는_없어도_된다(self) -> None:
        assert parse_request('{"id":"1","method":"ping"}').params == {}

    def test_JSON이_아니면_거부한다(self) -> None:
        assert code_of("{ not json") == "worker.request.malformed"

    def test_객체가_아니면_거부한다(self) -> None:
        assert code_of("[1,2,3]") == "worker.request.malformed"

    def test_id가_없으면_거부한다(self) -> None:
        assert code_of('{"method":"ping"}') == "worker.request.malformed"

    def test_method가_비면_거부한다(self) -> None:
        assert code_of('{"id":"1","method":""}') == "worker.request.malformed"

    def test_params가_객체가_아니면_거부한다(self) -> None:
        assert code_of('{"id":"1","method":"ping","params":[]}') == "worker.request.malformed"


class TestResponses:
    def test_성공_줄(self) -> None:
        parsed = json.loads(ok_response("1", {"pong": True}))

        assert parsed == {"id": "1", "ok": True, "result": {"pong": True}}

    def test_실패_줄(self) -> None:
        parsed = json.loads(error_response("1", "worker.internal", "터졌다"))

        assert parsed == {
            "id": "1",
            "ok": False,
            "error": {"code": "worker.internal", "message": "터졌다"},
        }

    def test_한_줄이다(self) -> None:
        # 줄 안에 날 개행이 있으면 다음 응답과 섞인다.
        line = ok_response("1", {"message": "두\n줄"})

        assert "\n" not in line

    def test_준비_줄에_규약_버전을_싣는다(self) -> None:
        parsed = json.loads(ready_line("0.8.5", "3.14.6"))

        assert parsed["event"] == "ready"
        assert parsed["protocol"] == PROTOCOL_VERSION
        assert parsed["ifcopenshell"] == "0.8.5"


class TestRequireHelpers:
    def test_문자열을_꺼낸다(self) -> None:
        assert require_str({"path": "a.ifc"}, "path") == "a.ifc"

    def test_빈_문자열은_거부한다(self) -> None:
        with pytest.raises(WorkerError) as raised:
            require_str({"path": "  "}, "path")

        assert raised.value.code == "worker.request.malformed"

    def test_객체를_꺼낸다(self) -> None:
        assert require_dict({"schedule": {"a": 1}}, "schedule") == {"a": 1}

    def test_객체가_아니면_거부한다(self) -> None:
        with pytest.raises(WorkerError) as raised:
            require_dict({"schedule": "x"}, "schedule")

        assert raised.value.code == "worker.request.malformed"
