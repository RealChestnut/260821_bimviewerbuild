"""서명 대상과 순서 (마스터 계획 9절 Phase 9).

실제로 서명하는 것은 시험하지 않는다. 인증서가 없고, 있어도 시험이 그것을 쓰면 안 된다.
여기서 보는 것은 **무엇을 고르고 명령을 어떻게 만드는가**다.
"""

from pathlib import Path

import pytest

from signing import OWN_BINARIES, files_to_sign, sign_command


class TestFilesToSign:
    @pytest.fixture
    def publish(self, tmp_path: Path) -> Path:
        for name in OWN_BINARIES:
            (tmp_path / name).write_bytes(b"")
        # 만든 곳이 이미 서명한 것들. 우리가 덧씌우지 않는다.
        for name in ("System.Private.CoreLib.dll", "hostfxr.dll", "Microsoft.Web.WebView2.Core.dll"):
            (tmp_path / name).write_bytes(b"")
        (tmp_path / "python").mkdir()
        (tmp_path / "python" / "python.exe").write_bytes(b"")
        return tmp_path

    def test_우리가_만든_것만_고른다(self, publish: Path) -> None:
        chosen = {path.name for path in files_to_sign(publish)}

        assert chosen == set(OWN_BINARIES)

    def test_남이_서명한_것에_덧씌우지_않는다(self, publish: Path) -> None:
        # .NET 런타임과 WebView2는 Microsoft가, CPython은 python.org가 이미 서명했다.
        chosen = {path.name for path in files_to_sign(publish)}

        assert "System.Private.CoreLib.dll" not in chosen
        assert "Microsoft.Web.WebView2.Core.dll" not in chosen
        assert "python.exe" not in chosen

    def test_셸_실행_파일이_들어_있다(self, publish: Path) -> None:
        assert publish / "Bim4d.Desktop.exe" in files_to_sign(publish)

    def test_없는_것은_빠진다(self, publish: Path) -> None:
        (publish / "Bim4d.Desktop.Core.dll").unlink()

        assert publish / "Bim4d.Desktop.Core.dll" not in files_to_sign(publish)

    def test_설치본이_아니면_비어_있다(self, tmp_path: Path) -> None:
        assert files_to_sign(tmp_path) == []


class TestSignCommand:
    def test_자리표시자를_경로로_바꾼다(self, tmp_path: Path) -> None:
        target = tmp_path / "Bim4d.Desktop.exe"

        command = sign_command("signtool sign /fd SHA256 {file}", target)

        assert str(target) in command
        assert "{file}" not in command

    def test_공백이_든_경로를_따옴표로_감싼다(self, tmp_path: Path) -> None:
        target = tmp_path / "BIM 4D Viewer.exe"

        assert f'"{target}"' in sign_command("signtool sign {file}", target)

    def test_자리표시자가_없으면_멈춘다(self, tmp_path: Path) -> None:
        # 그대로 두면 아무것도 서명하지 않은 채 성공했다고 말하게 된다.
        with pytest.raises(SystemExit):
            sign_command("signtool sign /fd SHA256", tmp_path / "a.exe")
