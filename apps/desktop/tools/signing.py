"""코드 서명 (마스터 계획 9절 Phase 9).

인증서는 우리 것이 아니다. 이 모듈이 하는 일은 **무엇을 어떤 순서로 서명하는가**를 정해
두는 것이며, 서명 명령 자체는 밖에서 받는다.

순서가 중요하다.

```text
publish → 셸 이진 파일 서명 → 설치 프로그램으로 싸기 → 설치 프로그램 서명
```

설치 프로그램을 먼저 서명하고 안의 파일을 나중에 서명할 수는 없다. 싸고 나면 안을 못
고친다.

**우리가 만든 것만 서명한다.** .NET 런타임과 CPython과 ifcopenshell과 WebView2는 각자
만든 곳이 이미 서명했다. 그 위에 우리 이름을 덧씌우면 원래 서명을 지우고 출처를 흐린다.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

#: 우리가 만든 이진 파일. 나머지는 만든 곳의 서명을 그대로 둔다.
OWN_BINARIES = (
    "Bim4d.Desktop.exe",
    "Bim4d.Desktop.dll",
    "Bim4d.Desktop.Core.dll",
)

#: 서명 명령이 반드시 담아야 하는 자리표시자.
FILE_PLACEHOLDER = "{file}"


def files_to_sign(publish_directory: Path) -> list[Path]:
    """설치본 폴더에서 서명할 것들을 고른다.

    없는 것은 조용히 건너뛰지 않고 빠뜨린 채 돌려준다. 무엇이 서명됐는지는 부르는 쪽이
    세어 볼 수 있어야 한다.
    """
    return [publish_directory / name for name in OWN_BINARIES if (publish_directory / name).exists()]


def sign_command(template: str, target: Path) -> str:
    """서명 명령 하나를 만든다.

    자리표시자가 없으면 멈춘다. 그대로 두면 같은 파일을 계속 서명하거나 아무것도 서명하지
    않은 채 성공했다고 말하게 된다.
    """
    if FILE_PLACEHOLDER not in template:
        raise SystemExit(
            f"서명 명령에 {FILE_PLACEHOLDER}가 없다: {template}\n"
            f'  예: signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f cert.pfx {FILE_PLACEHOLDER}'
        )
    return template.replace(FILE_PLACEHOLDER, f'"{target}"')


def sign(template: str, targets: list[Path]) -> None:
    """받은 명령으로 하나씩 서명한다.

    명령은 껍데기를 거쳐 돈다. 인증서 암호를 명령줄에 적으면 프로세스 목록에 보이므로,
    쓰는 쪽은 환경 변수나 인증서 저장소를 쓰는 편이 낫다.
    """
    for target in targets:
        subprocess.run(sign_command(template, target), shell=True, check=True)


def find_signtool(explicit: Path | None = None) -> Path:
    """`signtool.exe`를 찾는다. Windows SDK와 함께 온다."""
    if explicit is not None:
        if not explicit.exists():
            raise SystemExit(f"준 자리에 signtool.exe가 없다: {explicit}")
        return explicit

    on_path = shutil.which("signtool")
    if on_path is not None:
        return Path(on_path)

    roots = [
        Path(os.environ.get("ProgramFiles(x86)", "")) / "Windows Kits" / "10" / "bin",
        Path(os.environ.get("ProgramFiles", "")) / "Windows Kits" / "10" / "bin",
    ]
    found = [
        candidate
        for root in roots
        if root.exists()
        for candidate in sorted(root.glob("*/x64/signtool.exe"), reverse=True)
    ]
    if found:
        return found[0]

    raise SystemExit(
        "signtool.exe를 찾지 못했다. Windows SDK가 필요하다 (winget install "
        "Microsoft.WindowsSDK.10.0.26100) 또는 --signtool로 자리를 준다."
    )


def verify(targets: list[Path], signtool: Path | None = None) -> None:
    """서명이 실제로 붙었는지 본다.

    서명 명령이 조용히 실패하는 일이 있다. 만들었다고 말하기 전에 확인한다.
    """
    tool = find_signtool(signtool)
    for target in targets:
        subprocess.run([str(tool), "verify", "/pa", "/v", str(target)], check=True)
