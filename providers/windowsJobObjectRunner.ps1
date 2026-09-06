param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$WorkingDirectory,
  [Parameter(Mandatory = $true)][long]$CpuTimeLimitMs,
  [Parameter(Mandatory = $true)][long]$MemoryLimitBytes,
  [Parameter(Mandatory = $true)][string]$ArgumentListBase64
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class TunaCadJobObject {
    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);

    public static IntPtr Create(long cpuTimeLimitMs, long memoryLimitBytes) {
        const uint JOB_OBJECT_LIMIT_PROCESS_TIME = 0x00000002;
        const uint JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
        const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (cpuTimeLimitMs > 0) {
            limits.BasicLimitInformation.PerProcessUserTimeLimit = checked(cpuTimeLimitMs * 10000L);
            limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_TIME;
        }
        if (memoryLimitBytes > 0) {
            limits.ProcessMemoryLimit = (UIntPtr)(ulong)memoryLimitBytes;
            limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY;
        }
        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr pointer = Marshal.AllocHGlobal(size);
        try {
            Marshal.StructureToPtr(limits, pointer, false);
            if (!SetInformationJobObject(job, 9, pointer, (uint)size))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            return job;
        } catch {
            CloseHandle(job);
            throw;
        } finally {
            Marshal.FreeHGlobal(pointer);
        }
    }

    public static string QuoteArguments(string[] args) {
        var result = new StringBuilder();
        for (int index = 0; index < args.Length; index++) {
            if (index > 0) result.Append(' ');
            string arg = args[index] ?? "";
            if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) {
                result.Append(arg);
                continue;
            }
            result.Append('"');
            int slashes = 0;
            foreach (char character in arg) {
                if (character == '\\') { slashes++; continue; }
                if (character == '"') {
                    result.Append('\\', slashes * 2 + 1).Append('"');
                    slashes = 0;
                    continue;
                }
                result.Append('\\', slashes).Append(character);
                slashes = 0;
            }
            result.Append('\\', slashes * 2).Append('"');
        }
        return result.ToString();
    }
}
'@

$argumentJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ArgumentListBase64))
$decodedArguments = $argumentJson | ConvertFrom-Json
$providerArguments = New-Object 'System.Collections.Generic.List[string]'
foreach ($argument in $decodedArguments) { [void]$providerArguments.Add([string]$argument) }
$job = [TunaCadJobObject]::Create($CpuTimeLimitMs, $MemoryLimitBytes)
$process = New-Object Diagnostics.Process
$process.StartInfo = New-Object Diagnostics.ProcessStartInfo
$process.StartInfo.FileName = $Executable
$process.StartInfo.Arguments = [TunaCadJobObject]::QuoteArguments($providerArguments.ToArray())
$process.StartInfo.WorkingDirectory = $WorkingDirectory
$process.StartInfo.UseShellExecute = $false
$process.StartInfo.CreateNoWindow = $true
$process.StartInfo.RedirectStandardOutput = $true
$process.StartInfo.RedirectStandardError = $true
$started = $false

try {
  if (-not $process.Start()) { throw 'Provider process did not start.' }
  $started = $true
  if (-not [TunaCadJobObject]::AssignProcessToJobObject($job, $process.Handle)) {
    $process.Kill()
    throw "Could not assign provider to Windows Job Object (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
  }
  $stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
  $stderrTask = $process.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
  $process.WaitForExit()
  [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdoutTask, $stderrTask))
  exit $process.ExitCode
} finally {
  if ($started -and -not $process.HasExited) { $process.Kill() }
  [void][TunaCadJobObject]::CloseHandle($job)
  $process.Dispose()
}
