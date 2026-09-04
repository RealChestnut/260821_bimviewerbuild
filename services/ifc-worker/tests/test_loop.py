import io
import json
import subprocess
import sys
from pathlib import Path

from ifc_worker.loop import handle_line, run
from ifc_worker.protocol import PROTOCOL_VERSION

WORKER_DIR = Path(__file__).resolve().parents[1]


def parsed(line: str) -> dict:
    return json.loads(line)


class TestHandleLine:
    def test_ping에_답한다(self) -> None:
        assert parsed(handle_line('{"id":"1","method":"ping"}')) == {
            "id": "1",
            "ok": True,
            "result": {"pong": True},
        }

    def test_모르는_method는_코드로_알린다(self) -> None:
        response = parsed(handle_line('{"id":"1","method":"없다"}'))

        assert response["ok"] is False
        assert response["error"]["code"] == "worker.method.unknown"

    def test_깨진_줄은_id를_모른_채_알린다(self) -> None:
        response = parsed(handle_line("{ 깨졌다"))

        # 줄을 못 읽었으니 id도 없다. 그래도 응답은 한 줄 나간다.
        assert response["id"] == "?"
        assert response["error"]["code"] == "worker.request.malformed"

    def test_핸들러의_실패를_그대로_옮긴다(self) -> None:
        response = parsed(handle_line('{"id":"1","method":"inspect","params":{"path":"없다.ifc"}}'))

        assert response["error"]["code"] == "worker.file.not-found"

    def test_params가_빠지면_알린다(self) -> None:
        response = parsed(handle_line('{"id":"1","method":"inspect","params":{}}'))

        assert response["error"]["code"] == "worker.request.malformed"

    def test_예외는_값으로_바뀐다(self, monkeypatch) -> None:
        def 터진다(_params: dict) -> dict:
            raise RuntimeError("예상 못 한 실패")

        monkeypatch.setitem(__import__("ifc_worker.handlers", fromlist=["HANDLERS"]).HANDLERS, "ping", 터진다)

        response = parsed(handle_line('{"id":"1","method":"ping"}'))

        # 루프가 한 요청 때문에 멈추면 그 뒤 요청이 모두 막힌다.
        assert response["error"]["code"] == "worker.internal"


class TestRun:
    def test_준비_줄을_먼저_낸다(self) -> None:
        stdout = io.StringIO()

        run(io.StringIO(""), stdout, io.StringIO())

        first = parsed(stdout.getvalue().splitlines()[0])
        assert first["event"] == "ready"
        assert first["protocol"] == PROTOCOL_VERSION

    def test_요청_순서대로_답한다(self) -> None:
        stdout = io.StringIO()
        stdin = io.StringIO('{"id":"1","method":"ping"}\n{"id":"2","method":"ping"}\n')

        run(stdin, stdout, io.StringIO())

        lines = stdout.getvalue().splitlines()
        assert [parsed(line)["id"] for line in lines[1:]] == ["1", "2"]

    def test_빈_줄은_넘긴다(self) -> None:
        stdout = io.StringIO()

        run(io.StringIO('\n\n{"id":"1","method":"ping"}\n'), stdout, io.StringIO())

        assert len(stdout.getvalue().splitlines()) == 2

    def test_EOF면_끝낸다(self) -> None:
        # 부모가 죽으면 stdin이 닫힌다. 고아로 남지 않는다.
        run(io.StringIO('{"id":"1","method":"ping"}\n'), io.StringIO(), io.StringIO())


class TestProcess:
    """실제로 프로세스를 띄워 규약을 지키는지 본다."""

    def test_모듈로_실행되고_stdout에는_JSON만_나온다(self, three_elements: str) -> None:
        request = json.dumps({"id": "1", "method": "inspect", "params": {"path": three_elements}})

        completed = subprocess.run(
            [sys.executable, "-m", "ifc_worker"],
            input=request + "\n",
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=str(WORKER_DIR),
            timeout=120,
        )

        assert completed.returncode == 0
        lines = completed.stdout.splitlines()
        # 첫 줄은 준비, 그다음이 응답이다. 사람이 읽을 것은 stderr로 간다.
        assert [parsed(line) for line in lines][0]["event"] == "ready"
        assert parsed(lines[1])["result"]["schema"] == "IFC4"
