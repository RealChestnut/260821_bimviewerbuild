namespace Bim4d.Desktop.Core.Tests;

/// <summary>
/// 시험이 저장소 안의 자리를 찾는 길.
/// </summary>
/// <remarks>
/// 테스트는 <c>bin/</c> 아래에서 돈다. 상대 경로를 계단처럼 세면 프로젝트 구조가 바뀔 때
/// 조용히 깨지므로, 저장소 표식을 만날 때까지 올라간다.
/// </remarks>
internal static class RepoPaths
{
    private const string Marker = "pnpm-workspace.yaml";

    public static string Root { get; } = FindRoot();

    public static string WorkerDirectory => Path.Combine(Root, "services", "ifc-worker");

    public static string ThreeElementsFixture =>
        Path.Combine(Root, "packages", "test-fixtures", "ifc", "three-elements-ifc4.ifc");

    private static string FindRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, Marker)))
            {
                return current.FullName;
            }
            current = current.Parent;
        }

        throw new InvalidOperationException($"{Marker}를 가진 저장소 뿌리를 찾지 못했다.");
    }
}
