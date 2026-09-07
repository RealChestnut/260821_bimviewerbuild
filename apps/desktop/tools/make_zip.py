"""설치본 폴더를 ZIP 하나로 싼다 (ADR-0012의 대안).

설치 프로그램 없이 건네는 길이다. 받는 사람은 풀고 `Bim4d.Desktop.exe`를 두 번 누른다.

**설치 프로그램이 해 주던 것 넷이 빠진다.** 그래서 안에 넣는 안내문이 그 넷을 대신한다.

| 없는 것 | 안내문이 말하는 것 |
| --- | --- |
| WebView2 확인 | 없으면 앱이 스스로 알리고 받는 곳을 말한다 |
| 시작 메뉴 | 바로가기는 직접 만든다 |
| 제거 | 폴더를 지우면 끝. 남는 자리도 적는다 |
| 파일 연결 | `.bim4d`는 "연결 프로그램"으로 지정한다 |

소수에게 건널 때 쓴다. 널리 뿌릴 때는 설치 프로그램이 낫다.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import zipfile
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]

sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "ifc-worker" / "tools"))

from build_runtime import use_utf8  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))

from make_installer import read_version  # noqa: E402
from publish import SHELL_EXECUTABLE  # noqa: E402

#: 푼 뒤 생기는 폴더 이름이자 안내문 이름의 뿌리.
PRODUCT = "Bim4dViewer"

README_NAME = "먼저 읽어 주세요.txt"

README = """BIM 4D Viewer {version} — 시험판 (설치 프로그램 없는 판)

■ 실행

  1. 이 ZIP을 원하는 폴더에 전부 풉니다.
     (바탕 화면이나 문서 폴더처럼 쓰기 되는 자리면 됩니다)
  2. 폴더 안의 {executable} 를 두 번 누릅니다.

  Windows가 "PC를 보호했습니다"라고 막으면 [추가 정보] → [실행]을 누릅니다.
  아직 코드 서명 인증서를 사지 않아서 그렇습니다.

  인터넷에서 받은 ZIP이면 파일이 잠겨 있을 수 있습니다. 풀기 전에
  ZIP 파일을 오른쪽 클릭 → [속성] → 아래쪽 [차단 해제]를 체크하면 깔끔합니다.

■ WebView2가 필요합니다

  Windows 10/11 대부분에는 이미 있습니다. 없으면 앱이 그 사실과 받는 곳을
  알려 주고 끝납니다. 그때는 아래에서 "Evergreen Standalone Installer"를
  받아 깔고 다시 여시면 됩니다.

  https://developer.microsoft.com/microsoft-edge/webview2/

  .NET이나 Python은 따로 깔 필요 없습니다. 이 폴더 안에 다 들어 있습니다.

■ 바로가기와 파일 연결

  설치 프로그램이 아니라 시작 메뉴에 등록되지 않습니다.
  {executable} 를 오른쪽 클릭 → [바로 가기 만들기]로 직접 만드시면 됩니다.

  프로젝트 파일(.bim4d)을 두 번 눌러 열려면, 그 파일을 오른쪽 클릭 →
  [연결 프로그램] → [다른 앱 선택]에서 {executable} 를 고르시면 됩니다.

■ 지우려면

  이 폴더를 통째로 지우면 됩니다. 레지스트리에 아무것도 쓰지 않습니다.

  설정과 최근 목록과 기록은 아래에 따로 남습니다. 완전히 지우려면 함께
  지우시면 됩니다.

    %APPDATA%\\Bim4dViewer          설정 · 최근 프로젝트 · 기록
    %LOCALAPPDATA%\\Bim4dViewer     화면 캐시

■ 문제가 생기면

  앱에서 [도움말] → [기록 폴더 열기]를 누르고, 그날 날짜 파일을 보내 주세요.
  모델 파일은 보내지 않으셔도 됩니다.

■ 자세한 안내

  같이 받으신 시험판 안내문(BETA_GUIDE)에 15분 과제와 지금 없는 기능이
  적혀 있습니다.
"""


def zip_name(version: str) -> str:
    return f"{PRODUCT}-{version}.zip"


def render_readme(version: str) -> str:
    return README.format(version=version, executable=SHELL_EXECUTABLE)


def digest_of(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            sha.update(chunk)
    return sha.hexdigest()


def build(source: Path, output: Path, version: str) -> Path:
    """설치본 폴더를 ZIP으로 싼다.

    폴더 하나로 감싼다. 받는 사람이 다운로드 폴더에 그대로 풀어도 파일이 흩어지지 않는다.
    """
    if not (source / SHELL_EXECUTABLE).exists():
        raise SystemExit(
            f"설치본 폴더가 아니다: {source}\n  저장소 뿌리에서 `pnpm shell:publish`를 먼저 돌린다."
        )

    output.mkdir(parents=True, exist_ok=True)
    archive = output / zip_name(version)
    root = f"{PRODUCT}-{version}"

    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        bundle.writestr(f"{root}/{README_NAME}", render_readme(version))

        for path in sorted(source.rglob("*")):
            if path.is_file():
                bundle.write(path, f"{root}/{path.relative_to(source).as_posix()}")

    return archive


def main(argv: list[str] | None = None) -> int:
    use_utf8()

    artifacts = REPOSITORY_ROOT / "apps" / "desktop" / "artifacts"

    parser = argparse.ArgumentParser(description="설치본을 ZIP으로 싼다 (ADR-0012)")
    parser.add_argument(
        "--source", type=Path, default=artifacts / "publish", help="`pnpm shell:publish`가 만든 폴더"
    )
    parser.add_argument("--out", type=Path, default=artifacts / "zip", help="산출물 자리")
    arguments = parser.parse_args(argv)

    version = read_version()
    archive = build(arguments.source, arguments.out, version)

    print(f"만들었다: {archive}  ({archive.stat().st_size / (1024 * 1024):.0f} MB)")
    print(f"sha256: {digest_of(archive)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
