"""설치본 하나를 만든다 (ADR-0011, 마스터 계획 9절 Phase 9).

한 명령으로 셋을 모은다.

1. 셸 — `dotnet publish -r win-x64 --self-contained`. .NET이 깔리지 않은 PC에서 뜬다
2. 웹 — `apps/viewer-web/dist`를 `web/`으로
3. 워커 — 임베더블 Python과 `ifc_worker`를 `python/`과 `ifc-worker/`로
   (`services/ifc-worker/tools/build_runtime.py`가 하던 그 일을 그대로 부른다)

만든 뒤 셸의 `--self-check`로 실제로 띄워 워커까지 닿는지 본다. 배치를 만드는 쪽과 읽는
쪽이 같은 이름을 쓰는지는 그렇게만 증명된다.

**설치 프로그램은 여기서 만들지 않는다.** 이것은 폴더 하나이며, Setup EXE 또는 MSI로 싸는
일은 별도 ADR과 함께 온다.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

#: 저장소 뿌리. apps/desktop/tools 에서 세 단계 위다.
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]

sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "ifc-worker" / "tools"))

from build_runtime import build as build_runtime  # noqa: E402
from build_runtime import layout as runtime_layout  # noqa: E402
from build_runtime import use_utf8  # noqa: E402

import signing  # noqa: E402

#: 게시 대상. 마스터 계획 9절이 정한 Windows x64다.
RUNTIME_IDENTIFIER = "win-x64"

#: 셸 실행 파일의 이름.
SHELL_EXECUTABLE = "Bim4d.Desktop.exe"


@dataclass(frozen=True)
class Sources:
    """저장소에서 가져오는 것들."""

    shell_project: Path
    web_dist: Path
    worker_service: Path

    @staticmethod
    def of(repository: Path) -> "Sources":
        return Sources(
            shell_project=repository / "apps" / "desktop" / "src" / "Bim4d.Desktop",
            web_dist=repository / "apps" / "viewer-web" / "dist",
            worker_service=repository / "services" / "ifc-worker",
        )


def dotnet_publish_args(project: Path, out: Path, configuration: str = "Release") -> list[str]:
    """`dotnet publish`에게 시킬 말.

    ``--self-contained``이라 .NET 런타임이 함께 들어간다. 설치본이 커지는 대신 사용자가
    무엇을 먼저 깔 필요가 없다 (마스터 계획 9절).
    """
    return [
        "dotnet",
        "publish",
        str(project),
        "--configuration",
        configuration,
        "--runtime",
        RUNTIME_IDENTIFIER,
        "--self-contained",
        "true",
        "--output",
        str(out),
        "--nologo",
    ]


def missing_after_publish(out: Path) -> list[Path]:
    """설치본에 있어야 할 자리들.

    셸이 배치를 고르는 기준이 `web/`이므로 그것부터 본다. 나머지는 `InstallLayout`이
    보는 것과 같은 자리다.
    """
    tree = runtime_layout(out)
    required = [
        out / SHELL_EXECUTABLE,
        out / "web" / "index.html",
        tree.python_exe,
        tree.worker_package / "__main__.py",
    ]
    return [path for path in required if not path.exists()]


def copy_web(dist: Path, out: Path) -> None:
    """빌드한 뷰어 자산을 `web/`으로 옮긴다.

    이름은 셸이 먼저 보는 그 이름이다 (ADR-0011). 폴더째 `app.local`로 매핑된다 (ADR-0010).
    """
    destination = out / "web"
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(dist, destination)


def size_of(root: Path) -> int:
    return sum(path.stat().st_size for path in root.rglob("*") if path.is_file())


def self_check(out: Path, log_directory: Path, *, timeout: float = 180.0) -> dict:
    """만든 설치본을 실제로 띄워 워커까지 닿는지 본다.

    배치를 만드는 쪽과 읽는 쪽이 같은 이름을 쓰는지는 이렇게만 증명된다. 셸이 결과를
    ``selfCheck`` 필드로 남기므로 그 줄을 찾아 온다. 창을 띄워야 하는 일이라 창이 없는
    자리에서는 부를 수 없다.

    ``--exit-after``는 자체 점검이 끝난 뒤부터 센다. 창은 곧 스스로 닫힌다.
    """
    already = _log_lines(log_directory)

    subprocess.run(
        [str(out / SHELL_EXECUTABLE), "--self-check", "--exit-after", "5"],
        check=True,
        timeout=timeout,
    )

    for line in reversed(_log_lines(log_directory)[len(already) :]):
        record = json.loads(line)
        if "selfCheck" in record:
            return record

    raise SystemExit(
        f"셸이 자체 점검 결과를 남기지 않았다. 기록: {log_directory}"
    )


def _log_lines(directory: Path) -> list[str]:
    files = sorted(glob.glob(str(directory / "shell-*.log")))
    if not files:
        return []
    return [line for line in Path(files[-1]).read_text(encoding="utf-8").splitlines() if line]


def publish(
    out: Path,
    *,
    repository: Path = REPOSITORY_ROOT,
    embed_zip: Path | None = None,
    wheel_dir: Path | None = None,
    configuration: str = "Release",
) -> Path:
    sources = Sources.of(repository)

    if not sources.web_dist.exists():
        raise SystemExit(
            f"뷰어 자산이 없다: {sources.web_dist}\n"
            "  저장소 뿌리에서 `pnpm build`를 먼저 돌린다."
        )

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    subprocess.run(dotnet_publish_args(sources.shell_project, out, configuration), check=True)
    copy_web(sources.web_dist, out)
    build_runtime(
        out,
        requirements=sources.worker_service / "requirements.txt",
        worker_package=sources.worker_service / "ifc_worker",
        embed_zip=embed_zip,
        wheel_dir=wheel_dir,
    )

    missing = missing_after_publish(out)
    if missing:
        raise SystemExit("설치본이 덜 만들어졌다:\n" + "\n".join(f"  {path}" for path in missing))

    return out


def main(argv: list[str] | None = None) -> int:
    use_utf8()

    parser = argparse.ArgumentParser(description="설치본 폴더 하나를 만든다 (ADR-0011)")
    parser.add_argument(
        "--out",
        type=Path,
        default=REPOSITORY_ROOT / "apps" / "desktop" / "artifacts" / "publish",
        help="설치본을 만들 자리",
    )
    parser.add_argument("--configuration", default="Release")
    parser.add_argument("--embed-zip", type=Path, default=None, help="미리 받아 둔 임베더블 zip")
    parser.add_argument("--wheel-dir", type=Path, default=None, help="미리 받아 둔 wheel 폴더")
    parser.add_argument(
        "--skip-self-check",
        action="store_true",
        help="띄워 보는 단계를 건너뛴다. 창을 띄울 수 없는 자리에서 쓴다",
    )
    parser.add_argument(
        "--sign-tool",
        default=None,
        help="우리가 만든 이진 파일을 서명할 명령. {file}이 경로다. 싸기 전에 부른다",
    )
    arguments = parser.parse_args(argv)

    out = publish(
        arguments.out,
        embed_zip=arguments.embed_zip,
        wheel_dir=arguments.wheel_dir,
        configuration=arguments.configuration,
    )

    # 서명은 싸기 전에 한다. 싸고 나면 안을 못 고친다.
    if arguments.sign_tool is not None:
        targets = signing.files_to_sign(out)
        signing.sign(arguments.sign_tool, targets)
        signing.verify(targets)
        print(f"서명했다: {len(targets)}개")

    print(f"만들었다: {out}  ({size_of(out) / (1024 * 1024):.0f} MB)")

    if arguments.skip_self_check:
        return 0

    logs = Path(os.environ["APPDATA"]) / "Bim4dViewer" / "logs"
    record = self_check(out, logs)

    if record.get("selfCheck") != "ok":
        raise SystemExit(f"자체 점검이 통과하지 못했다: {json.dumps(record, ensure_ascii=False)}")

    print(
        f"띄워 봤다: {record.get('message')} · "
        f"layout {record.get('layout')} · python {record.get('python')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
