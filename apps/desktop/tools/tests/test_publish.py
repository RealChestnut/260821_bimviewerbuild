"""설치본과 설치 프로그램을 만드는 절차의 판단 부분 (ADR-0011, ADR-0012).

`dotnet publish`도 `ISCC`도 여기서 부르지 않는다. 실제로 만들어진 것이 도는지는
`pnpm shell:publish`가 창을 띄워 확인한다.
"""

from pathlib import Path

import pytest

from make_installer import iscc_args, installer_path, read_version
from publish import RUNTIME_IDENTIFIER, dotnet_publish_args, missing_after_publish


class TestDotnetPublishArgs:
    def test_자체_포함으로_게시한다(self, tmp_path: Path) -> None:
        # .NET이 깔리지 않은 PC에서 떠야 한다 (마스터 계획 9절).
        args = dotnet_publish_args(tmp_path / "proj", tmp_path / "out")

        assert "--self-contained" in args
        assert args[args.index("--self-contained") + 1] == "true"

    def test_win_x64를_고른다(self, tmp_path: Path) -> None:
        args = dotnet_publish_args(tmp_path / "proj", tmp_path / "out")

        assert args[args.index("--runtime") + 1] == RUNTIME_IDENTIFIER == "win-x64"

    def test_기본은_Release다(self, tmp_path: Path) -> None:
        args = dotnet_publish_args(tmp_path / "proj", tmp_path / "out")

        assert args[args.index("--configuration") + 1] == "Release"


class TestMissingAfterPublish:
    @pytest.fixture
    def published(self, tmp_path: Path) -> Path:
        (tmp_path / "Bim4d.Desktop.exe").write_bytes(b"")
        (tmp_path / "web").mkdir()
        (tmp_path / "web" / "index.html").write_text("", encoding="utf-8")
        (tmp_path / "python").mkdir()
        (tmp_path / "python" / "python.exe").write_bytes(b"")
        (tmp_path / "ifc-worker" / "ifc_worker").mkdir(parents=True)
        (tmp_path / "ifc-worker" / "ifc_worker" / "__main__.py").write_text("", encoding="utf-8")
        return tmp_path

    def test_다_있으면_비어_있다(self, published: Path) -> None:
        assert missing_after_publish(published) == []

    def test_자산이_없으면_말한다(self, published: Path) -> None:
        # web은 셸이 배치를 고르는 기준이다 (ADR-0011).
        (published / "web" / "index.html").unlink()

        assert published / "web" / "index.html" in missing_after_publish(published)

    def test_동봉한_Python이_없으면_말한다(self, published: Path) -> None:
        (published / "python" / "python.exe").unlink()

        assert published / "python" / "python.exe" in missing_after_publish(published)

    def test_셸이_없으면_말한다(self, published: Path) -> None:
        (published / "Bim4d.Desktop.exe").unlink()

        assert published / "Bim4d.Desktop.exe" in missing_after_publish(published)


class TestVersion:
    def test_한_자리에서_읽는다(self, tmp_path: Path) -> None:
        props = tmp_path / "Directory.Build.props"
        props.write_text("<Project><PropertyGroup><Version>1.2.3</Version>\n", encoding="utf-8")

        assert read_version(props) == "1.2.3"

    def test_없으면_기본값을_쓰지_않고_멈춘다(self, tmp_path: Path) -> None:
        # 버전 없는 설치본은 무엇을 받았는지 알 수 없다.
        props = tmp_path / "Directory.Build.props"
        props.write_text("<Project></Project>", encoding="utf-8")

        with pytest.raises(SystemExit):
            read_version(props)

    def test_산출물_이름에_버전이_들어간다(self, tmp_path: Path) -> None:
        assert installer_path(tmp_path, "0.1.0").name == "Bim4dViewer-Setup-0.1.0.exe"


class TestIsccArgs:
    def test_값을_전부_넘긴다(self, tmp_path: Path) -> None:
        args = iscc_args(
            tmp_path / "ISCC.exe",
            version="0.1.0",
            source=tmp_path / "publish",
            output=tmp_path / "out",
            bootstrapper=tmp_path / "boot.exe",
            script=tmp_path / "a.iss",
        )

        assert "/DAppVersion=0.1.0" in args
        assert f"/DSourceDir={tmp_path / 'publish'}" in args
        assert f"/DBootstrapper={tmp_path / 'boot.exe'}" in args

    def test_스크립트가_마지막이다(self, tmp_path: Path) -> None:
        # ISCC는 스크립트 파일 하나만 받는다.
        args = iscc_args(
            tmp_path / "ISCC.exe",
            version="0.1.0",
            source=tmp_path / "publish",
            output=tmp_path / "out",
            bootstrapper=None,
            script=tmp_path / "a.iss",
        )

        assert args[-1] == str(tmp_path / "a.iss")

    def test_bootstrapper가_없으면_그_정의도_없다(self, tmp_path: Path) -> None:
        args = iscc_args(
            tmp_path / "ISCC.exe",
            version="0.1.0",
            source=tmp_path / "publish",
            output=tmp_path / "out",
            bootstrapper=None,
            script=tmp_path / "a.iss",
        )

        assert not any(arg.startswith("/DBootstrapper=") for arg in args)
