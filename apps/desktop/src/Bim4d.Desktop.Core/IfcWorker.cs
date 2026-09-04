using System.Text.Json.Serialization;

namespace Bim4d.Desktop.Core;

/// <summary>사람이 아니라 기계가 읽는 코드를 가진 실패.</summary>
/// <remarks>
/// 오류 보고가 코드를 함께 보이려면 어떤 실패가 코드를 가졌는지 알아야 한다. 실패 종류가
/// 늘 때마다 <see cref="ErrorReport.From"/>에 분기를 더하지 않기 위해 짝을 이것 하나로 둔다.
/// </remarks>
public interface ICodedError
{
    string Code { get; }
}

/// <summary>
/// 기계가 분기할 수 있는 코드를 가진 실패.
/// </summary>
/// <remarks>
/// 워커가 낸 코드를 그대로 옮긴다. 코드는 <c>worker.</c>로 시작하는 안정된 문자열이다
/// (ADR-0009).
/// </remarks>
public sealed class WorkerException : Exception, ICodedError
{
    public WorkerException(string code, string message)
        : base(message)
    {
        Code = code;
    }

    public string Code { get; }
}

/// <summary>수령 파일 점검 결과. 사실만 담는다. 받아들일지는 부르는 쪽이 정한다.</summary>
public sealed record IfcMetadata(
    [property: JsonPropertyName("schema")] string Schema,
    [property: JsonPropertyName("productCount")] int ProductCount,
    [property: JsonPropertyName("products")] IReadOnlyDictionary<string, int> Products,
    [property: JsonPropertyName("duplicateGlobalIds")] IReadOnlyList<string> DuplicateGlobalIds,
    [property: JsonPropertyName("missingGlobalIdCount")] int MissingGlobalIdCount,
    [property: JsonPropertyName("hasWorkSchedule")] bool HasWorkSchedule
);

/// <summary>일정을 IFC로 쓴 결과.</summary>
public sealed record ScheduleExportResult(
    [property: JsonPropertyName("outputPath")] string OutputPath,
    [property: JsonPropertyName("taskCount")] int TaskCount,
    /// <summary>그 파일에 옮길 수 없어 건너뛴 부재 연결 수. 조용히 버리지 않는다.</summary>
    [property: JsonPropertyName("skippedAssignments")] int SkippedAssignments
);

/// <summary>
/// IFC Worker 계약.
/// </summary>
/// <remarks>
/// 전송 방식이 여기 등장하지 않는다. 지금 구현은 자식 프로세스 stdio지만(ADR-0009) Named
/// Pipe나 HTTP로 바뀌어도 이 인터페이스는 그대로다. 그래서 어느 전송으로도 지킬 수 있는
/// 것만 넣는다.
///
/// 큰 파일은 값이 아니라 경로로 오간다.
/// </remarks>
public interface IIfcWorker : IAsyncDisposable
{
    Task PingAsync(CancellationToken cancellationToken = default);

    Task<IfcMetadata> InspectAsync(string path, CancellationToken cancellationToken = default);

    /// <summary>
    /// IFC에 든 일정을 읽는다. 결과는 검증하지 않은 일정 v3 JSON 문자열이다.
    /// </summary>
    /// <remarks>
    /// 해석 지점을 하나로 두기 위해 검증은 웹 쪽 <c>parseSchedule</c>이 한다. 셸은 옮기기만 한다.
    /// </remarks>
    Task<string> ImportScheduleAsync(string path, CancellationToken cancellationToken = default);

    Task<ScheduleExportResult> ExportScheduleAsync(
        string sourcePath,
        string outputPath,
        string scheduleJson,
        CancellationToken cancellationToken = default
    );
}
