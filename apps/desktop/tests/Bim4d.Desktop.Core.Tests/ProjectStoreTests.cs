namespace Bim4d.Desktop.Core.Tests;

/// <summary>
/// 프로젝트 파일을 여닫는다 (ADR-0013).
/// </summary>
/// <remarks>
/// 창 없이 시험할 수 있어야 하므로 판단을 전부 Core에 두었다. 여기서 보는 것은 쓰고 다시
/// 읽으면 같은가, 버전이 다르면 어떻게 하나, 경로를 어떻게 찾나다.
/// </remarks>
public sealed class ProjectStoreTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("bim4d-project-").FullName;

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private string ProjectFile => Path.Combine(_root, "a" + ProjectStore.Extension);

    private static ProjectDocument Sample(params ProjectModel[] models) =>
        new()
        {
            Name = "A동 구조",
            ScheduleJson = """{"scheduleId":"s1","schemaVersion":3,"tasks":[]}""",
            ViewerStateJson = """{"camera":{"position":[1,2,3],"target":[0,0,0]}}""",
            Models = models,
            TaskCount = 7,
        };

    private string MakeIfc(string name, string content = "ISO-10303-21;")
    {
        var path = Path.Combine(_root, name);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
        return path;
    }

    [Fact]
    public void 쓰고_다시_읽으면_같다()
    {
        var ifc = MakeIfc("구조.ifc");
        var written = Sample(new ProjectModel("구조.ifc", ifc, Fingerprint: "9f2b", Schema: "IFC4"));

        ProjectStore.Write(ProjectFile, written);
        var read = ProjectStore.Read(ProjectFile);

        Assert.Equal(written.Name, read.Name);
        Assert.Equal(written.ScheduleJson, read.ScheduleJson);
        Assert.Equal(written.ViewerStateJson, read.ViewerStateJson);
        Assert.Equal(7, read.TaskCount);
        Assert.Single(read.Models);
        Assert.Equal("구조.ifc", read.Models[0].ModelRef);
        Assert.Equal("9f2b", read.Models[0].Fingerprint);
        Assert.Equal("IFC4", read.Models[0].Schema);
    }

    [Fact]
    public void 일정은_열어_보지_않고_그대로_옮긴다()
    {
        // 셸이 일정 스키마를 알면 파서가 둘이 된다 (ADR-0013). 모르는 모양도 그대로 오간다.
        var written = Sample() with { ScheduleJson = """{"이건":"우리가 모르는 모양"}""" };

        ProjectStore.Write(ProjectFile, written);

        Assert.Equal(written.ScheduleJson, ProjectStore.Read(ProjectFile).ScheduleJson);
    }

    [Fact]
    public void 덮어쓰면_옛_모델이_남지_않는다()
    {
        ProjectStore.Write(ProjectFile, Sample(new ProjectModel("옛.ifc", MakeIfc("옛.ifc"))));
        ProjectStore.Write(ProjectFile, Sample(new ProjectModel("새.ifc", MakeIfc("새.ifc"))));

        var read = ProjectStore.Read(ProjectFile);

        Assert.Single(read.Models);
        Assert.Equal("새.ifc", read.Models[0].ModelRef);
    }

    [Fact]
    public void 모델이_없어도_연다()
    {
        // 일정만 있고 모델을 아직 안 연 프로젝트가 있을 수 있다.
        ProjectStore.Write(ProjectFile, Sample());

        Assert.Empty(ProjectStore.Read(ProjectFile).Models);
    }

    [Fact]
    public void 없는_파일은_코드와_함께_거절한다()
    {
        var failure = Assert.Throws<ProjectStoreException>(
            () => ProjectStore.Read(Path.Combine(_root, "없다.bim4d"))
        );

        Assert.Equal("project.missing", failure.Code);
    }

    [Fact]
    public void 우리_파일이_아니면_거절한다()
    {
        var notOurs = Path.Combine(_root, "가짜.bim4d");
        File.WriteAllText(notOurs, "이건 그냥 텍스트다");

        var failure = Assert.Throws<ProjectStoreException>(() => ProjectStore.Read(notOurs));

        Assert.Equal("project.not-a-project", failure.Code);
    }

    [Fact]
    public void 더_새로운_버전은_조용히_열지_않는다()
    {
        // 조용히 열면 모르는 데이터를 잃는다 (ADR-0013).
        ProjectStore.Write(ProjectFile, Sample());
        BumpSchemaVersion(ProjectFile, ProjectStore.SchemaVersion + 1);

        var failure = Assert.Throws<ProjectStoreException>(() => ProjectStore.Read(ProjectFile));

        Assert.Equal("project.too-new", failure.Code);
        Assert.Contains("더 새로운 버전", failure.Message);
    }

    [Fact]
    public void 실패는_코드와_기록_자리를_함께_보인다()
    {
        var failure = Record.Exception(
            () => ProjectStore.Read(Path.Combine(_root, "없다.bim4d"))
        )!;

        var report = ErrorReport.From(failure, "C:\\logs");

        Assert.Equal("project.missing", report.Code);
    }

    private static void BumpSchemaVersion(string path, int version)
    {
        using var connection = new Microsoft.Data.Sqlite.SqliteConnection(
            $"Data Source={path};Pooling=False"
        );
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE meta SET value = $v WHERE key = 'schemaVersion'";
        command.Parameters.AddWithValue("$v", version.ToString());
        command.ExecuteNonQuery();
    }
}

/// <summary>
/// 프로젝트에 적힌 모델을 실제 파일에서 찾는다 (ADR-0013).
/// </summary>
public sealed class ModelPathsTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("bim4d-paths-").FullName;

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private string Make(string relative, string content = "ISO-10303-21;")
    {
        var path = Path.GetFullPath(Path.Combine(_root, relative));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
        return path;
    }

    [Fact]
    public void 적힌_자리에_있으면_그것을_쓴다()
    {
        var ifc = Make("모델/구조.ifc");
        var project = Path.Combine(_root, "a.bim4d");

        var found = ModelPaths.Resolve(new ProjectModel("구조.ifc", ifc), project);

        Assert.Equal(ModelLocation.Absolute, found.Found);
        Assert.Equal(ifc, found.Path);
    }

    [Fact]
    public void 절대_경로가_깨지면_상대로_다시_찾는다()
    {
        // 폴더째 다른 PC로 옮긴 상황이다. 절대 경로는 그 PC의 것이라 없다.
        var ifc = Make("모델/구조.ifc");
        var project = Path.Combine(_root, "a.bim4d");
        var moved = new ProjectModel(
            "구조.ifc",
            AbsolutePath: "D:\\없는PC\\모델\\구조.ifc",
            RelativePath: Path.Combine("모델", "구조.ifc")
        );

        var found = ModelPaths.Resolve(moved, project);

        Assert.Equal(ModelLocation.Relative, found.Found);
        Assert.Equal(ifc, found.Path);
    }

    [Fact]
    public void 둘_다_없으면_못_찾았다고_한다()
    {
        var project = Path.Combine(_root, "a.bim4d");
        var gone = new ProjectModel(
            "구조.ifc",
            AbsolutePath: Path.Combine(_root, "없다.ifc"),
            RelativePath: "없다.ifc"
        );

        var found = ModelPaths.Resolve(gone, project);

        Assert.Equal(ModelLocation.NotFound, found.Found);
        Assert.Null(found.Path);
    }

    [Fact]
    public void 상대_경로가_없으면_절대만_본다()
    {
        var project = Path.Combine(_root, "a.bim4d");
        var noRelative = new ProjectModel("구조.ifc", Path.Combine(_root, "없다.ifc"));

        Assert.Equal(ModelLocation.NotFound, ModelPaths.Resolve(noRelative, project).Found);
    }

    [Fact]
    public void 같은_폴더_아래면_상대_경로를_적는다()
    {
        var ifc = Make("모델/구조.ifc");
        var project = Path.Combine(_root, "a.bim4d");

        var relative = ModelPaths.RelativeTo(project, ifc);

        Assert.Equal(Path.Combine("모델", "구조.ifc"), relative);
    }

    [Fact]
    public void 위로_올라가는_상대_경로도_적는다()
    {
        var ifc = Make("모델/구조.ifc");
        var project = Path.Combine(_root, "일정", "a.bim4d");
        Directory.CreateDirectory(Path.GetDirectoryName(project)!);

        var relative = ModelPaths.RelativeTo(project, ifc);

        Assert.Equal(Path.Combine("..", "모델", "구조.ifc"), relative);
    }

    [Fact]
    public void 드라이브가_다르면_상대_경로가_없다()
    {
        // ..\ 를 아무리 올라가도 다른 드라이브에 닿지 못한다.
        var project = Path.Combine(_root, "a.bim4d");
        var otherDrive = _root.StartsWith("C:", StringComparison.OrdinalIgnoreCase)
            ? "Z:\\모델\\구조.ifc"
            : "C:\\모델\\구조.ifc";

        Assert.Null(ModelPaths.RelativeTo(project, otherDrive));
    }

    [Fact]
    public void 같은_내용이면_같은_fingerprint다()
    {
        var one = Make("a.ifc", "ISO-10303-21;\nDATA;\nENDSEC;");
        var two = Make("이름만다름.ifc", "ISO-10303-21;\nDATA;\nENDSEC;");

        Assert.Equal(ModelPaths.Fingerprint(one), ModelPaths.Fingerprint(two));
    }

    [Fact]
    public void 내용이_다르면_fingerprint도_다르다()
    {
        var one = Make("a.ifc", "ISO-10303-21;");
        var two = Make("b.ifc", "ISO-10303-21; 한 글자 다름");

        Assert.NotEqual(ModelPaths.Fingerprint(one), ModelPaths.Fingerprint(two));
    }

    [Fact]
    public void fingerprint는_소문자_hex_64자다()
    {
        // 웹의 sha256Hex와 같은 모양이어야 견줄 수 있다 (ADR-0008).
        var value = ModelPaths.Fingerprint(Make("a.ifc"));

        Assert.Equal(64, value.Length);
        Assert.Matches("^[0-9a-f]{64}$", value);
    }
}
