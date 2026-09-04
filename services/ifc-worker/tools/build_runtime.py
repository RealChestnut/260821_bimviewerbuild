"""설치본이 들고 다닐 Python 런타임을 만든다 (ADR-0011).

만드는 것은 두 폴더다.

``python/``
    임베더블 CPython을 푼 자리. ``Lib/site-packages``에 ``requirements.txt``의
    wheel이 들어가고, ``python313._pth``가 ``sys.path``를 정한다.

``ifc-worker/``
    ``ifc_worker`` 패키지. 코드는 저장소의 것을 그대로 복사한다.

**판단과 입출력을 가른다.** 경로 계산, ``_pth`` 내용, pip 인자는 값을 받아 값을
돌려주는 함수로 두고 시험한다. 내려받기와 압축 해제는 그 값을 쓰는 얇은 층이다.

폐쇄망에서는 ``--embed-zip``으로 미리 받아 둔 zip을, ``--wheel-dir``로 미리 받아 둔
wheel 폴더를 준다. 그러면 이 스크립트는 네트워크를 쓰지 않는다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

#: 동봉하는 CPython. 시스템 Python을 따라가지 않으므로 우리가 고른다 (ADR-0011).
PYTHON_VERSION = "3.13.15"

#: ``python-3.13.15-embed-amd64.zip``의 크기와 sha256. 받은 것이 우리가 고른 것인지 본다.
PYTHON_EMBED_SIZE = 11_009_825
PYTHON_EMBED_SHA256 = "d1f04d990aee1253d8569e8e5104e30fa9f5fa830899f14843448872d936a2cf"

#: ``python313.dll``, ``python313.zip``, ``python313._pth``가 공유하는 이름.
PYTHON_STEM = "python313"

#: wheel을 고를 때 쓰는 짝. 호스트 Python이 무엇이든 이 짝의 wheel만 받는다.
WHEEL_PYTHON_VERSION = "3.13"
WHEEL_PLATFORM = "win_amd64"


@dataclass(frozen=True)
class Layout:
    """설치본 트리에서 이 스크립트가 만드는 자리들."""

    root: Path
    python_dir: Path
    python_exe: Path
    site_packages: Path
    pth_file: Path
    worker_dir: Path
    worker_package: Path


def layout(root: Path) -> Layout:
    """설치 폴더 뿌리에서 자리들을 계산한다.

    이름은 ADR-0011이 정한 것이며 셸의 배치 해석도 같은 이름을 본다.
    """
    root = Path(root)
    python_dir = root / "python"
    worker_dir = root / "ifc-worker"
    return Layout(
        root=root,
        python_dir=python_dir,
        python_exe=python_dir / "python.exe",
        site_packages=python_dir / "Lib" / "site-packages",
        pth_file=python_dir / f"{PYTHON_STEM}._pth",
        worker_dir=worker_dir,
        worker_package=worker_dir / "ifc_worker",
    )


def embed_url(version: str = PYTHON_VERSION) -> str:
    return f"https://www.python.org/ftp/python/{version}/python-{version}-embed-amd64.zip"


def pth_lines() -> list[str]:
    """``python313._pth``의 내용.

    임베더블 배포판은 이 파일이 있으면 ``PYTHONPATH``와 사용자 site를 무시한다. 그래서
    여기 적힌 것이 ``sys.path``의 전부다. 경로는 이 파일이 있는 폴더 기준이므로
    ``..\\ifc-worker``가 워커 패키지의 부모를 가리킨다. **워커를 찾는 일이 작업
    디렉터리에 매이지 않는다** (ADR-0011).

    ``import site``는 site-packages에 들어 있는 ``.pth``를 읽게 한다. wheel이 그런
    파일을 함께 깔 수 있다.
    """
    return [
        f"{PYTHON_STEM}.zip",
        ".",
        "Lib\\site-packages",
        "..\\ifc-worker",
        "import site",
    ]


def pip_args(requirements: Path, target: Path, wheel_dir: Path | None = None) -> list[str]:
    """호스트 pip에게 시킬 말.

    호스트 Python이 3.13이 아니어도 3.13 win_amd64 wheel을 받아야 한다. 그래서 짝을
    직접 적고 소스 배포는 받지 않는다. pip는 ``--python-version``과 ``--platform``을
    ``--only-binary=:all:`` 없이는 받아 주지 않는다.

    ``wheel_dir``을 주면 그 폴더만 본다. 폐쇄망에서 쓰는 길이다.
    """
    args = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--requirement",
        str(requirements),
        "--target",
        str(target),
        "--only-binary=:all:",
        "--python-version",
        WHEEL_PYTHON_VERSION,
        "--platform",
        WHEEL_PLATFORM,
        "--no-compile",
    ]
    if wheel_dir is not None:
        args += ["--no-index", "--find-links", str(wheel_dir)]
    return args


def missing_paths(tree: Layout) -> list[Path]:
    """다 만들어졌는지 본다. 없는 것을 그대로 돌려준다.

    반쯤 만들어진 트리를 성공으로 보고 넘기면 설치본에서야 드러난다.
    """
    required = [
        tree.python_exe,
        tree.python_dir / f"{PYTHON_STEM}.dll",
        tree.pth_file,
        tree.site_packages / "ifcopenshell",
        tree.worker_package / "__main__.py",
    ]
    return [path for path in required if not path.exists()]


def digest_of(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            sha.update(chunk)
    return sha.hexdigest()


def verify_embed_zip(path: Path) -> None:
    """받은 zip이 우리가 고른 그것인지 본다.

    크기부터 보는 이유는 실패를 읽기 쉽게 하기 위해서다. 프록시가 끼어들어 HTML을
    돌려주면 sha256 불일치보다 크기가 먼저 말해 준다.
    """
    size = path.stat().st_size
    if size != PYTHON_EMBED_SIZE:
        raise SystemExit(
            f"임베더블 zip의 크기가 다르다: {size} 바이트, 기대 {PYTHON_EMBED_SIZE} ({path})"
        )

    actual = digest_of(path)
    if actual != PYTHON_EMBED_SHA256:
        raise SystemExit(
            f"임베더블 zip의 sha256이 다르다: {actual}, 기대 {PYTHON_EMBED_SHA256} ({path})"
        )


def download(url: str, destination: Path) -> None:
    from urllib.request import urlopen

    destination.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(url) as response, destination.open("wb") as file:  # noqa: S310 - 고정된 https 주소
        shutil.copyfileobj(response, file)


def copy_worker(source_package: Path, tree: Layout) -> None:
    """워커 패키지를 복사한다. ``__pycache__``는 남기지 않는다."""
    if tree.worker_package.exists():
        shutil.rmtree(tree.worker_package)
    tree.worker_dir.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        source_package,
        tree.worker_package,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )


def build(
    root: Path,
    *,
    requirements: Path,
    worker_package: Path,
    embed_zip: Path | None = None,
    wheel_dir: Path | None = None,
) -> Layout:
    """트리를 만든다. 이미 있으면 지우고 다시 만든다."""
    tree = layout(root)

    if tree.python_dir.exists():
        shutil.rmtree(tree.python_dir)
    tree.python_dir.mkdir(parents=True)

    with tempfile.TemporaryDirectory() as scratch:
        source = embed_zip
        if source is None:
            source = Path(scratch) / "python-embed.zip"
            download(embed_url(), source)
        verify_embed_zip(source)

        with zipfile.ZipFile(source) as archive:
            archive.extractall(tree.python_dir)

    tree.pth_file.write_text("\n".join(pth_lines()) + "\n", encoding="utf-8")
    tree.site_packages.mkdir(parents=True, exist_ok=True)

    subprocess.run(pip_args(requirements, tree.site_packages, wheel_dir), check=True)

    copy_worker(worker_package, tree)

    missing = missing_paths(tree)
    if missing:
        raise SystemExit("런타임이 덜 만들어졌다:\n" + "\n".join(f"  {path}" for path in missing))

    return tree


def smoke(tree: Layout, *, ifc_path: Path | None = None, timeout: float = 120.0) -> dict[str, Any]:
    """만든 런타임을 실제로 띄워 본다 (ADR-0009 규약).

    작업 디렉터리를 일부러 다른 곳으로 두고 띄운다. ``_pth``가 워커를 찾는지 보려는
    것이며, 그것이 이 배치의 핵심이다.

    ``ping``만으로도 native 확장이 올라온 것은 증명된다. ``ifc_worker.handlers``가
    ``inspection``을 거쳐 ``ifcopenshell``을 module 로드 시점에 부르기 때문이다. IFC를
    주면 파일을 실제로 읽는 데까지 간다.
    """
    requests = [{"id": "1", "method": "ping"}]
    if ifc_path is not None:
        requests.append({"id": "2", "method": "inspect", "params": {"path": str(ifc_path)}})

    payload = "".join(json.dumps(request) + "\n" for request in requests)

    with tempfile.TemporaryDirectory() as elsewhere:
        completed = subprocess.run(
            [str(tree.python_exe), "-m", "ifc_worker"],
            input=payload,
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=elsewhere,
            timeout=timeout,
        )

    lines = [line for line in completed.stdout.splitlines() if line.strip() != ""]
    if len(lines) != len(requests) + 1:
        raise SystemExit(
            "워커가 기대한 줄 수를 내지 않았다.\n"
            f"  stdout: {completed.stdout!r}\n"
            f"  stderr: {completed.stderr!r}"
        )

    ready = json.loads(lines[0])
    if ready.get("event") != "ready":
        raise SystemExit(f"첫 줄이 ready가 아니다: {lines[0]}")

    for line in lines[1:]:
        response = json.loads(line)
        if not response.get("ok"):
            raise SystemExit(f"요청이 실패했다: {line}")

    return ready


def main(argv: list[str] | None = None) -> int:
    here = Path(__file__).resolve()
    service_root = here.parents[1]
    repo_root = here.parents[3]

    parser = argparse.ArgumentParser(description="설치본용 Python 런타임을 만든다 (ADR-0011)")
    parser.add_argument(
        "--out",
        type=Path,
        default=repo_root / "apps" / "desktop" / "artifacts" / "runtime",
        help="트리를 만들 자리. 설치 폴더의 뿌리에 해당한다",
    )
    parser.add_argument(
        "--embed-zip",
        type=Path,
        default=None,
        help="미리 받아 둔 임베더블 zip. 주면 내려받지 않는다",
    )
    parser.add_argument(
        "--wheel-dir",
        type=Path,
        default=None,
        help="미리 받아 둔 wheel 폴더. 주면 PyPI를 보지 않는다",
    )
    parser.add_argument(
        "--ifc",
        type=Path,
        default=repo_root / "packages" / "test-fixtures" / "ifc" / "three-elements-ifc4.ifc",
        help="띄워 본 뒤 실제로 읽어 볼 IFC. 없으면 ping까지만 한다",
    )
    parser.add_argument("--skip-smoke", action="store_true", help="띄워 보는 단계를 건너뛴다")
    arguments = parser.parse_args(argv)

    tree = build(
        arguments.out,
        requirements=service_root / "requirements.txt",
        worker_package=service_root / "ifc_worker",
        embed_zip=arguments.embed_zip,
        wheel_dir=arguments.wheel_dir,
    )

    print(f"만들었다: {tree.root}")

    if arguments.skip_smoke:
        return 0

    ifc_path = arguments.ifc if arguments.ifc is not None and arguments.ifc.exists() else None
    ready = smoke(tree, ifc_path=ifc_path)
    print(
        "띄워 봤다: "
        f"python {ready.get('python')} · ifcopenshell {ready.get('ifcopenshell')} · "
        f"protocol {ready.get('protocol')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
