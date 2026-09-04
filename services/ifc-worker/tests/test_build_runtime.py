"""설치본 런타임을 만드는 절차의 판단 부분 (ADR-0011).

내려받기와 압축 해제는 여기서 시험하지 않는다. 그 둘은 값을 쓰는 얇은 층이며, 실제로
만들어진 트리가 도는지는 `pnpm worker:runtime`이 띄워 보는 것으로 확인한다.
"""

from pathlib import Path

import pytest

from tools.build_runtime import (
    PYTHON_EMBED_SHA256,
    PYTHON_STEM,
    PYTHON_VERSION,
    WHEEL_PLATFORM,
    WHEEL_PYTHON_VERSION,
    embed_url,
    layout,
    missing_paths,
    pip_args,
    pth_lines,
)


class TestLayout:
    def test_ADR_0011이_정한_이름을_쓴다(self, tmp_path: Path) -> None:
        tree = layout(tmp_path)

        assert tree.python_dir == tmp_path / "python"
        assert tree.worker_dir == tmp_path / "ifc-worker"
        assert tree.worker_package == tmp_path / "ifc-worker" / "ifc_worker"

    def test_실행_파일과_site_packages는_python_아래다(self, tmp_path: Path) -> None:
        tree = layout(tmp_path)

        assert tree.python_exe == tmp_path / "python" / "python.exe"
        assert tree.site_packages == tmp_path / "python" / "Lib" / "site-packages"

    def test_pth는_dll과_같은_이름을_쓴다(self, tmp_path: Path) -> None:
        assert layout(tmp_path).pth_file.name == f"{PYTHON_STEM}._pth"


class TestPthLines:
    def test_site_packages와_워커를_모두_담는다(self) -> None:
        lines = pth_lines()

        assert "Lib\\site-packages" in lines
        assert "..\\ifc-worker" in lines

    def test_표준_라이브러리_zip이_첫_줄이다(self) -> None:
        assert pth_lines()[0] == f"{PYTHON_STEM}.zip"

    def test_import_site를_켠다(self) -> None:
        # wheel이 함께 까는 .pth를 읽게 하려면 site가 켜져 있어야 한다.
        assert "import site" in pth_lines()


class TestEmbedUrl:
    def test_고른_버전을_가리킨다(self) -> None:
        url = embed_url()

        assert PYTHON_VERSION in url
        assert url.endswith(f"python-{PYTHON_VERSION}-embed-amd64.zip")

    def test_https다(self) -> None:
        assert embed_url().startswith("https://")

    def test_sha256을_고정해_두었다(self) -> None:
        assert len(PYTHON_EMBED_SHA256) == 64


class TestPipArgs:
    def test_호스트_Python이_무엇이든_같은_짝을_받는다(self, tmp_path: Path) -> None:
        args = pip_args(tmp_path / "requirements.txt", tmp_path / "site-packages")

        assert "--python-version" in args
        assert args[args.index("--python-version") + 1] == WHEEL_PYTHON_VERSION
        assert "--platform" in args
        assert args[args.index("--platform") + 1] == WHEEL_PLATFORM

    def test_소스_배포를_받지_않는다(self, tmp_path: Path) -> None:
        # --python-version과 --platform은 --only-binary=:all: 없이는 pip가 거부한다.
        assert "--only-binary=:all:" in pip_args(tmp_path / "r.txt", tmp_path / "sp")

    def test_target으로_넣는다(self, tmp_path: Path) -> None:
        target = tmp_path / "site-packages"
        args = pip_args(tmp_path / "r.txt", target)

        assert args[args.index("--target") + 1] == str(target)

    def test_wheel_폴더를_주면_PyPI를_보지_않는다(self, tmp_path: Path) -> None:
        wheels = tmp_path / "wheels"
        args = pip_args(tmp_path / "r.txt", tmp_path / "sp", wheels)

        assert "--no-index" in args
        assert args[args.index("--find-links") + 1] == str(wheels)

    def test_wheel_폴더가_없으면_그_인자도_없다(self, tmp_path: Path) -> None:
        args = pip_args(tmp_path / "r.txt", tmp_path / "sp")

        assert "--no-index" not in args
        assert "--find-links" not in args


class TestMissingPaths:
    @pytest.fixture
    def full_tree(self, tmp_path: Path) -> Path:
        tree = layout(tmp_path)
        tree.site_packages.mkdir(parents=True)
        (tree.site_packages / "ifcopenshell").mkdir()
        tree.python_exe.write_bytes(b"")
        (tree.python_dir / f"{PYTHON_STEM}.dll").write_bytes(b"")
        tree.pth_file.write_text("\n".join(pth_lines()), encoding="utf-8")
        tree.worker_package.mkdir(parents=True)
        (tree.worker_package / "__main__.py").write_text("", encoding="utf-8")
        return tmp_path

    def test_다_있으면_비어_있다(self, full_tree: Path) -> None:
        assert missing_paths(layout(full_tree)) == []

    def test_ifcopenshell이_없으면_말한다(self, full_tree: Path) -> None:
        tree = layout(full_tree)
        (tree.site_packages / "ifcopenshell").rmdir()

        assert tree.site_packages / "ifcopenshell" in missing_paths(tree)

    def test_워커가_없으면_말한다(self, full_tree: Path) -> None:
        tree = layout(full_tree)
        (tree.worker_package / "__main__.py").unlink()

        assert tree.worker_package / "__main__.py" in missing_paths(tree)

    def test_pth가_없으면_말한다(self, full_tree: Path) -> None:
        tree = layout(full_tree)
        tree.pth_file.unlink()

        assert tree.pth_file in missing_paths(tree)
