namespace Bim4d.Desktop.Core;

/// <summary>
/// 명령줄로 받은 것.
/// </summary>
/// <remarks>
/// 지금은 열 파일 하나뿐이다. 사람이 대화상자를 누르지 않고도 여는 길이 있어야 셸과 웹을
/// 잇는 경로를 자동으로 시험할 수 있다. 나중에 파일 연결(Phase 9)이 붙는 자리이기도 하다.
/// </remarks>
public sealed record StartupOptions
{
    /// <summary>뜨자마자 열 IFC. 없으면 빈 창으로 시작한다.</summary>
    public string? OpenPath { get; init; }

    /// <summary>연 뒤 이만큼 지나면 스스로 끝낸다. 자동 시험이 쓰는 길이다.</summary>
    public TimeSpan? ExitAfter { get; init; }

    /// <summary>
    /// 뜨자마자 워커까지 닿는지 보고 결과를 기록에 남긴다.
    /// </summary>
    /// <remarks>
    /// 설치본이 온전한지는 창을 열어 메뉴를 눌러 봐야 알 수 있었다. 설치 뒤 확인을 사람 손에
    /// 맡기지 않기 위한 길이다 (ADR-0011). 동봉한 Python이 실제로 뜨는지가 설치본에서 가장
    /// 먼저 깨지는 자리다.
    /// </remarks>
    public bool SelfCheck { get; init; }

    /// <summary>
    /// 사람이 아니라 절차가 띄웠다.
    /// </summary>
    /// <remarks>
    /// 이때는 대화상자를 띄우지 않는다. 아무도 누르지 않아 그대로 멈추고, 게시나 CI에서는
    /// 그것이 몇 시간짜리 멈춤이 된다. 실패는 기록으로 남긴다.
    /// </remarks>
    public bool Automated => SelfCheck || ExitAfter is not null;

    /// <summary>
    /// 명령줄을 읽는다.
    /// </summary>
    /// <remarks>
    /// 모르는 인자는 조용히 버리지 않고 그대로 둔다. 여기서 판단할 일이 아니며, 셸이
    /// 무엇을 받았는지는 로그에 남는다.
    /// </remarks>
    public static StartupOptions Parse(IReadOnlyList<string> arguments)
    {
        string? openPath = null;
        TimeSpan? exitAfter = null;
        var selfCheck = false;

        for (var index = 0; index < arguments.Count; index += 1)
        {
            var current = arguments[index];
            var next = index + 1 < arguments.Count ? arguments[index + 1] : null;

            switch (current)
            {
                case "--open" when next is not null:
                    openPath = next;
                    index += 1;
                    break;

                case "--exit-after" when next is not null && double.TryParse(next, out var seconds):
                    exitAfter = TimeSpan.FromSeconds(seconds);
                    index += 1;
                    break;

                case "--self-check":
                    selfCheck = true;
                    break;

                default:
                    // 옵션이 아니면 열 파일로 본다. 파일 연결과 끌어다 놓기가 그렇게 준다.
                    if (!current.StartsWith('-'))
                    {
                        openPath ??= current;
                    }
                    break;
            }
        }

        return new StartupOptions
        {
            OpenPath = openPath,
            ExitAfter = exitAfter,
            SelfCheck = selfCheck,
        };
    }
}
