using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

namespace Bim4d.Desktop.Core;

/// <summary>프로젝트에 적힌 모델 하나. 원본은 담지 않고 어디 있었는지만 적는다.</summary>
/// <param name="ModelRef">일정의 <c>modelRef</c>. 연결의 키다 (ADR-0008).</param>
/// <param name="AbsolutePath">저장할 때의 자리.</param>
/// <param name="RelativePath">프로젝트 파일 기준. 드라이브가 다르면 없다.</param>
/// <param name="Fingerprint">파일 내용의 SHA-256. 모르면 없다.</param>
/// <param name="Schema">IFC2X3 / IFC4 …. 모르면 없다.</param>
public sealed record ProjectModel(
    string ModelRef,
    string AbsolutePath,
    string? RelativePath = null,
    string? Fingerprint = null,
    string? Schema = null
);

/// <summary>
/// 프로젝트 하나의 내용.
/// </summary>
/// <remarks>
/// 일정과 화면 상태는 문자열이다. 셸은 그것을 열어 보지 않고 옮기기만 한다 — 해석 지점을
/// 하나로 두기 위해서다 (ADR-0007, ADR-0009, ADR-0013).
/// </remarks>
public sealed record ProjectDocument
{
    public required string Name { get; init; }

    /// <summary>일정 v3 JSON. 셸은 검증하지 않는다.</summary>
    public required string ScheduleJson { get; init; }

    /// <summary>Viewpoint JSON. 카메라·숨김·격리·단면.</summary>
    public required string ViewerStateJson { get; init; }

    public required IReadOnlyList<ProjectModel> Models { get; init; }

    /// <summary>최근 목록 같은 자리에 보이려고 두는 요약. 정본은 언제나 일정이다.</summary>
    public int TaskCount { get; init; }
}

/// <summary>프로젝트를 열거나 쓰다 실패했다.</summary>
public sealed class ProjectStoreException : Exception, ICodedError
{
    public ProjectStoreException(string code, string message, Exception? cause = null)
        : base(message, cause)
    {
        Code = code;
    }

    public string Code { get; }
}

/// <summary>
/// 프로젝트 파일 하나를 여닫는다 (ADR-0013).
/// </summary>
/// <remarks>
/// SQLite인 이유는 하나로 충분하다 — <b>쓰다 죽어도 반만 쓰인 파일이 남지 않는다.</b>
/// 트랜잭션이 그것을 공짜로 준다.
///
/// 표는 셋이다. 셸이 스스로 질의해야 하는 <c>models</c>만 열로 펴고, 일정과 화면 상태는
/// <c>documents</c>에 JSON 덩어리로 둔다. Task와 연결을 열로 펴면 C#이 일정 스키마를 알아야
/// 하고, 그러면 파서가 둘이 되어 버전이 올라갈 때 조용히 어긋난다.
/// </remarks>
public static class ProjectStore
{
    /// <summary>이 앱이 쓰는 프로젝트 스키마 버전.</summary>
    public const int SchemaVersion = 1;

    /// <summary>확장자. 우리 고유 이름이라 남의 것을 가져가지 않는다 (ADR-0012).</summary>
    public const string Extension = ".bim4d";

    private const string ScheduleDocument = "schedule";
    private const string ViewerStateDocument = "viewerState";

    /// <summary>
    /// 프로젝트를 쓴다. 이미 있으면 덮어쓴다.
    /// </summary>
    /// <remarks>
    /// 전부 한 트랜잭션이다. 중간에 죽으면 이전 파일이 그대로 남는다.
    ///
    /// 상대 경로는 여기서 계산한다. 프로젝트를 다른 폴더에 저장하면 상대 위치가 달라지므로
    /// 부르는 쪽이 미리 계산해 둘 수 없다.
    /// </remarks>
    public static void Write(string path, ProjectDocument document)
    {
        using var connection = Open(path);
        using var transaction = connection.BeginTransaction();

        Execute(
            connection,
            """
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS models (
              model_ref     TEXT PRIMARY KEY,
              absolute_path TEXT NOT NULL,
              relative_path TEXT,
              fingerprint   TEXT,
              schema        TEXT
            );
            CREATE TABLE IF NOT EXISTS documents (name TEXT PRIMARY KEY, json TEXT NOT NULL);
            DELETE FROM models;
            """
        );

        WriteMeta(connection, "schemaVersion", SchemaVersion.ToString());
        WriteMeta(connection, "projectName", document.Name);
        WriteMeta(connection, "savedAt", DateTimeOffset.Now.ToString("O"));
        WriteMeta(connection, "taskCount", document.TaskCount.ToString());

        foreach (var model in document.Models)
        {
            using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO models (model_ref, absolute_path, relative_path, fingerprint, schema)
                VALUES ($ref, $absolute, $relative, $fingerprint, $schema)
                """;
            command.Parameters.AddWithValue("$ref", model.ModelRef);
            command.Parameters.AddWithValue("$absolute", model.AbsolutePath);
            command.Parameters.AddWithValue(
                "$relative",
                (object?)ModelPaths.RelativeTo(path, model.AbsolutePath) ?? DBNull.Value
            );
            command.Parameters.AddWithValue("$fingerprint", (object?)model.Fingerprint ?? DBNull.Value);
            command.Parameters.AddWithValue("$schema", (object?)model.Schema ?? DBNull.Value);
            command.ExecuteNonQuery();
        }

        WriteDocument(connection, ScheduleDocument, document.ScheduleJson);
        WriteDocument(connection, ViewerStateDocument, document.ViewerStateJson);

        transaction.Commit();
    }

    /// <summary>
    /// 프로젝트를 읽는다.
    /// </summary>
    /// <exception cref="ProjectStoreException">
    /// 프로젝트 파일이 아니거나, 이 앱보다 새로운 버전이 만든 파일이다.
    /// </exception>
    public static ProjectDocument Read(string path)
    {
        if (!File.Exists(path))
        {
            throw new ProjectStoreException("project.missing", $"프로젝트 파일이 없다: {path}");
        }

        using var connection = Open(path);

        var version = ReadSchemaVersion(connection);
        if (version > SchemaVersion)
        {
            throw new ProjectStoreException(
                "project.too-new",
                $"이 프로젝트는 더 새로운 버전이 만들었다 (파일 {version}, 이 앱 {SchemaVersion}). "
                    + "앱을 올린 뒤 연다."
            );
        }

        // 올릴 것이 생기면 여기서 version별로 올린다. 읽고 나면 항상 최신이다 (ADR-0013).

        return new ProjectDocument
        {
            Name = ReadMeta(connection, "projectName") ?? Path.GetFileNameWithoutExtension(path),
            ScheduleJson = ReadDocument(connection, ScheduleDocument),
            ViewerStateJson = ReadDocument(connection, ViewerStateDocument),
            Models = ReadModels(connection),
            TaskCount = int.TryParse(ReadMeta(connection, "taskCount"), out var count) ? count : 0,
        };
    }

    private static SqliteConnection Open(string path)
    {
        var directory = Path.GetDirectoryName(Path.GetFullPath(path));
        if (directory is not null)
        {
            Directory.CreateDirectory(directory);
        }

        // 풀링을 끈다. 켜 두면 Dispose 뒤에도 파일 핸들이 남아, 저장한 프로젝트를 사용자가
        // 옮기거나 지우지 못한다. 우리는 열고 바로 닫는 쓰임이라 풀이 줄 이득도 없다.
        var connection = new SqliteConnection(
            new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString()
        );
        try
        {
            connection.Open();
        }
        catch (SqliteException cause)
        {
            connection.Dispose();
            throw new ProjectStoreException("project.unreadable", $"프로젝트를 열지 못했다: {path}", cause);
        }
        return connection;
    }

    private static int ReadSchemaVersion(SqliteConnection connection)
    {
        try
        {
            var value = ReadMeta(connection, "schemaVersion");
            if (value is null || !int.TryParse(value, out var version))
            {
                throw new ProjectStoreException(
                    "project.not-a-project",
                    "프로젝트 파일이 아니다. schemaVersion이 없다."
                );
            }
            return version;
        }
        catch (SqliteException cause)
        {
            // meta 표조차 없다. SQLite이긴 하나 우리 파일이 아니다.
            throw new ProjectStoreException("project.not-a-project", "프로젝트 파일이 아니다.", cause);
        }
    }

    private static void Execute(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    private static void WriteMeta(SqliteConnection connection, string key, string value)
    {
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO meta (key, value) VALUES ($key, $value)
            ON CONFLICT(key) DO UPDATE SET value = $value
            """;
        command.Parameters.AddWithValue("$key", key);
        command.Parameters.AddWithValue("$value", value);
        command.ExecuteNonQuery();
    }

    private static string? ReadMeta(SqliteConnection connection, string key)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT value FROM meta WHERE key = $key";
        command.Parameters.AddWithValue("$key", key);
        return command.ExecuteScalar() as string;
    }

    private static void WriteDocument(SqliteConnection connection, string name, string json)
    {
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO documents (name, json) VALUES ($name, $json)
            ON CONFLICT(name) DO UPDATE SET json = $json
            """;
        command.Parameters.AddWithValue("$name", name);
        command.Parameters.AddWithValue("$json", json);
        command.ExecuteNonQuery();
    }

    private static string ReadDocument(SqliteConnection connection, string name)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT json FROM documents WHERE name = $name";
        command.Parameters.AddWithValue("$name", name);
        // 없으면 빈 문자열이다. 웹이 "비어 있음"으로 읽는다.
        return command.ExecuteScalar() as string ?? string.Empty;
    }

    private static List<ProjectModel> ReadModels(SqliteConnection connection)
    {
        var models = new List<ProjectModel>();

        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT model_ref, absolute_path, relative_path, fingerprint, schema
            FROM models ORDER BY model_ref
            """;

        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            models.Add(
                new ProjectModel(
                    reader.GetString(0),
                    reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetString(3),
                    reader.IsDBNull(4) ? null : reader.GetString(4)
                )
            );
        }

        return models;
    }
}

/// <summary>모델을 어디서 찾았나 (ADR-0013).</summary>
public enum ModelLocation
{
    /// <summary>적힌 절대 경로에 있었다.</summary>
    Absolute,

    /// <summary>프로젝트 파일 기준 상대 경로에서 찾았다. 폴더째 옮겼거나 다른 PC다.</summary>
    Relative,

    /// <summary>둘 다 없다. 사용자에게 묻는다.</summary>
    NotFound,
}

/// <summary>찾아본 결과.</summary>
/// <param name="Model">프로젝트에 적혀 있던 것.</param>
/// <param name="Path">실제로 찾은 자리. 못 찾았으면 없다.</param>
/// <param name="Found">어디서 찾았나.</param>
public sealed record ResolvedModel(ProjectModel Model, string? Path, ModelLocation Found);

/// <summary>
/// 프로젝트에 적힌 모델을 실제 파일에서 찾는다 (ADR-0013).
/// </summary>
/// <remarks>
/// 절대 경로를 먼저 보고, 없으면 프로젝트 파일 기준 상대 경로로 다시 찾는다. 폴더째 옮기거나
/// 다른 PC에서 여는 일이 흔하기 때문이다.
///
/// 못 찾아도 연결을 지우지 않는다. 네트워크 드라이브가 잠깐 안 붙은 날 프로젝트를 열었다가
/// 몇 주치 연결이 사라지는 일을 만들지 않는다 (ADR-0008의 원칙).
/// </remarks>
public static class ModelPaths
{
    /// <summary>
    /// 프로젝트 파일 기준의 상대 경로. 드라이브가 다르면 없다.
    /// </summary>
    /// <remarks>
    /// 드라이브가 다르면 상대 경로가 의미를 잃는다. `..\..\..\` 를 아무리 올라가도 다른
    /// 드라이브에 닿지 못한다.
    /// </remarks>
    public static string? RelativeTo(string projectFile, string modelPath)
    {
        var projectDirectory = Path.GetDirectoryName(Path.GetFullPath(projectFile));
        if (projectDirectory is null)
        {
            return null;
        }

        var model = Path.GetFullPath(modelPath);
        if (
            !string.Equals(
                Path.GetPathRoot(projectDirectory),
                Path.GetPathRoot(model),
                StringComparison.OrdinalIgnoreCase
            )
        )
        {
            return null;
        }

        return Path.GetRelativePath(projectDirectory, model);
    }

    /// <summary>절대 → 상대 → 못 찾음 순으로 찾는다.</summary>
    public static ResolvedModel Resolve(ProjectModel model, string projectFile)
    {
        if (File.Exists(model.AbsolutePath))
        {
            return new ResolvedModel(model, model.AbsolutePath, ModelLocation.Absolute);
        }

        if (model.RelativePath is { } relative)
        {
            var projectDirectory = Path.GetDirectoryName(Path.GetFullPath(projectFile));
            if (projectDirectory is not null)
            {
                var candidate = Path.GetFullPath(Path.Combine(projectDirectory, relative));
                if (File.Exists(candidate))
                {
                    return new ResolvedModel(model, candidate, ModelLocation.Relative);
                }
            }
        }

        return new ResolvedModel(model, null, ModelLocation.NotFound);
    }

    /// <summary>
    /// 파일 내용의 SHA-256을 소문자 hex로.
    /// </summary>
    /// <remarks>
    /// 웹의 <c>sha256Hex</c>와 같은 값을 내야 한다. 파일명이나 수정 시각은 쓰지 않는다 —
    /// 같은 내용을 다른 이름으로 열어도 같은 값이어야 한다.
    /// </remarks>
    public static string Fingerprint(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexStringLower(SHA256.HashData(stream));
    }
}
