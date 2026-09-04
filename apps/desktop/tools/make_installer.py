"""설치 프로그램 하나를 만든다 (ADR-0012).

`pnpm shell:publish`가 만든 폴더를 Inno Setup으로 싼다. 배치는 ADR-0011이 정한 그대로이며
이 절차는 포장만 한다 — 나중에 MSI가 필요해지면 같은 폴더를 다른 것으로 싸면 된다.

WebView2 Evergreen bootstrapper를 함께 담는다. 설치 중에 Evergreen이 없을 때만 실행된다.

**서명은 아직 하지 않는다.** ``--sign-tool``에 명령을 주면 만든 뒤 그것을 부른다. 인증서는
Phase 9의 남은 일이다.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

#: 저장소 뿌리. apps/desktop/tools 에서 세 단계 위다.
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]

sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "ifc-worker" / "tools"))

from build_runtime import use_utf8  # noqa: E402

#: 셸과 설치본이 같은 버전을 말하게 하는 한 자리 (ADR-0012).
VERSION_FILE = REPOSITORY_ROOT / "apps" / "desktop" / "Directory.Build.props"

INSTALLER_SCRIPT = REPOSITORY_ROOT / "apps" / "desktop" / "installer" / "Bim4dViewer.iss"

#: Evergreen bootstrapper. 늘 최신을 가리키므로 해시를 고정할 수 없다.
BOOTSTRAPPER_URL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
BOOTSTRAPPER_NAME = "MicrosoftEdgeWebView2Setup.exe"

#: `ISCC.exe`가 있을 만한 자리들. winget은 사용자 폴더에, 설치 관리자는 Program Files에 둔다.
ISCC_CANDIDATES = (
    Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Inno Setup 6" / "ISCC.exe",
    Path(os.environ.get("ProgramFiles(x86)", "")) / "Inno Setup 6" / "ISCC.exe",
    Path(os.environ.get("ProgramFiles", "")) / "Inno Setup 6" / "ISCC.exe",
)


def read_version(props: Path = VERSION_FILE) -> str:
    """`Directory.Build.props`의 `<Version>`을 읽는다.

    XML 파서를 부르지 않는 이유는 이 파일이 우리 것이고 한 줄이기 때문이다. 찾지 못하면
    조용히 기본값을 쓰지 않고 멈춘다 — 버전 없는 설치본은 무엇을 받았는지 알 수 없다.
    """
    text = props.read_text(encoding="utf-8")
    found = re.search(r"<Version>([^<]+)</Version>", text)
    if found is None:
        raise SystemExit(f"<Version>을 찾지 못했다: {props}")
    return found.group(1).strip()


def find_iscc(explicit: Path | None = None) -> Path:
    """Inno Setup 컴파일러를 찾는다."""
    if explicit is not None:
        if not explicit.exists():
            raise SystemExit(f"준 자리에 ISCC.exe가 없다: {explicit}")
        return explicit

    on_path = shutil.which("ISCC")
    if on_path is not None:
        return Path(on_path)

    for candidate in ISCC_CANDIDATES:
        if candidate.exists():
            return candidate

    raise SystemExit(
        "Inno Setup을 찾지 못했다. `winget install JRSoftware.InnoSetup`으로 깔거나 "
        "--iscc로 자리를 준다."
    )


def iscc_args(
    iscc: Path,
    *,
    version: str,
    source: Path,
    output: Path,
    bootstrapper: Path | None,
    script: Path = INSTALLER_SCRIPT,
) -> list[str]:
    """컴파일러에게 시킬 말. 값은 전부 여기서 넘어간다."""
    args = [
        str(iscc),
        f"/DAppVersion={version}",
        f"/DSourceDir={source}",
        f"/DOutputDir={output}",
    ]
    if bootstrapper is not None:
        args.append(f"/DBootstrapper={bootstrapper}")
    args.append(str(script))
    return args


def installer_path(output: Path, version: str) -> Path:
    return output / f"Bim4dViewer-Setup-{version}.exe"


def fetch_bootstrapper(destination: Path) -> Path:
    """WebView2 Evergreen bootstrapper를 받는다.

    늘 최신을 가리키는 주소라 크기도 해시도 고정할 수 없다. 대신 받은 것이 실행 파일인지
    본다 — 프록시가 끼어들어 HTML을 돌려주는 일이 흔하다.
    """
    from urllib.request import urlopen

    destination.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(BOOTSTRAPPER_URL) as response, destination.open("wb") as file:  # noqa: S310
        shutil.copyfileobj(response, file)

    if destination.read_bytes()[:2] != b"MZ":
        raise SystemExit(
            f"받은 것이 실행 파일이 아니다: {destination}\n  {BOOTSTRAPPER_URL}를 확인한다."
        )

    return destination


def build(
    *,
    source: Path,
    output: Path,
    bootstrapper: Path | None,
    iscc: Path | None = None,
    version: str | None = None,
) -> Path:
    if not (source / "Bim4d.Desktop.exe").exists():
        raise SystemExit(
            f"설치본 폴더가 아니다: {source}\n  저장소 뿌리에서 `pnpm shell:publish`를 먼저 돌린다."
        )

    resolved_version = version or read_version()
    output.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        iscc_args(
            find_iscc(iscc),
            version=resolved_version,
            source=source,
            output=output,
            bootstrapper=bootstrapper,
        ),
        check=True,
    )

    made = installer_path(output, resolved_version)
    if not made.exists():
        raise SystemExit(f"설치 프로그램이 만들어지지 않았다: {made}")

    return made


def main(argv: list[str] | None = None) -> int:
    use_utf8()

    artifacts = REPOSITORY_ROOT / "apps" / "desktop" / "artifacts"

    parser = argparse.ArgumentParser(description="설치 프로그램을 만든다 (ADR-0012)")
    parser.add_argument(
        "--source",
        type=Path,
        default=artifacts / "publish",
        help="`pnpm shell:publish`가 만든 폴더",
    )
    parser.add_argument("--out", type=Path, default=artifacts / "installer", help="산출물 자리")
    parser.add_argument("--iscc", type=Path, default=None, help="ISCC.exe의 자리")
    parser.add_argument(
        "--bootstrapper",
        type=Path,
        default=None,
        help="미리 받아 둔 WebView2 bootstrapper. 주지 않으면 받는다",
    )
    parser.add_argument(
        "--no-bootstrapper",
        action="store_true",
        help="WebView2 bootstrapper를 담지 않는다. 폐쇄망용 산출물이 쓰는 길이다",
    )
    parser.add_argument("--sign-tool", default=None, help="만든 뒤 부를 서명 명령. {file}이 경로다")
    arguments = parser.parse_args(argv)

    bootstrapper: Path | None = None
    if not arguments.no_bootstrapper:
        bootstrapper = arguments.bootstrapper or fetch_bootstrapper(
            artifacts / "cache" / BOOTSTRAPPER_NAME
        )

    made = build(
        source=arguments.source,
        output=arguments.out,
        bootstrapper=bootstrapper,
    )

    size = made.stat().st_size / (1024 * 1024)
    print(f"만들었다: {made}  ({size:.0f} MB)")

    if arguments.sign_tool is not None:
        subprocess.run(arguments.sign_tool.format(file=str(made)), shell=True, check=True)
        print(f"서명했다: {made}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
