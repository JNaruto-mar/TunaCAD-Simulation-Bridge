// Compiled by the existing supervisor together with TunaCadJobObject. This is
// its opt-in native creation primitive, not a second launcher or a public port.
public sealed class TunaCadSuspendedChild : IDisposable {
    [StructLayout(LayoutKind.Sequential)] private struct SA {
        public int Size; public IntPtr Descriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool Inherit;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] private struct SI {
        public int cb; public string reserved, desktop, title;
        public uint x,y,xsize,ysize,xchars,ychars,fill,flags;
        public ushort show,reservedBytes; public IntPtr reservedPointer,input,output,error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct SIX { public SI info; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct PI { public IntPtr process,thread; public uint pid,tid; }
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SA sa,uint size);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetHandleInformation(IntPtr handle,out uint flags);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern IntPtr CreateFile(string name,uint access,uint share,ref SA sa,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processSA,IntPtr threadSA,bool inherit,uint flags,IntPtr environment,string cwd,ref SIX startup,out PI pi);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool TerminateProcess(IntPtr handle,uint code);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool TerminateJobObject(IntPtr job,uint code);
    private IntPtr process,thread;
    private bool assigned,resumed;
    public int Id {get;private set;}
    public System.IO.FileStream StandardOutput {get;private set;}
    public System.IO.FileStream StandardError {get;private set;}
    private static void Check(bool ok) {if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error());}
    private static void Close(ref IntPtr h) {if(h!=IntPtr.Zero&&h!=new IntPtr(-1))TunaCadJobObject.CloseHandle(h);h=IntPtr.Zero;}
    public static bool HandleInheritable(IntPtr handle) {uint flags;Check(GetHandleInformation(handle,out flags));return (flags&1)!=0;}
    public static TunaCadSuspendedChild Create(string executable,string[] args,string cwd,IntPtr job) {
        var child=new TunaCadSuspendedChild();
        IntPtr outRead=IntPtr.Zero,outWrite=IntPtr.Zero,errRead=IntPtr.Zero,errWrite=IntPtr.Zero,input=IntPtr.Zero,list=IntPtr.Zero,values=IntPtr.Zero,jobValue=IntPtr.Zero;
        bool initialized=false;
        try {
            var sa=new SA {Size=Marshal.SizeOf(typeof(SA)),Inherit=true};
            Check(CreatePipe(out outRead,out outWrite,ref sa,0));Check(SetHandleInformation(outRead,1,0));
            Check(CreatePipe(out errRead,out errWrite,ref sa,0));Check(SetHandleInformation(errRead,1,0));
            // The supervisor's private bootstrap stdin is NEVER inherited.
            input=CreateFile("NUL",0x80000000,3,ref sa,3,0,IntPtr.Zero);if(input==new IntPtr(-1))Check(false);
            IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);
            if(size==IntPtr.Zero)Check(false);list=Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(list,2,0,ref size));initialized=true;
            values=Marshal.AllocHGlobal(3*IntPtr.Size);
            Marshal.WriteIntPtr(values,0,input);Marshal.WriteIntPtr(values,IntPtr.Size,outWrite);Marshal.WriteIntPtr(values,2*IntPtr.Size,errWrite);
            Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x20002),values,new IntPtr(3*IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
            // JOB_LIST performs assignment atomically with creation (Windows10+).
            // It references the parent's handle; it does NOT inherit/duplicate it.
            jobValue=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobValue,job);
            Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x2000D),jobValue,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
            var si=new SIX {info=new SI {cb=Marshal.SizeOf(typeof(SIX)),flags=0x100,input=input,output=outWrite,error=errWrite},attributes=list};
            var command=new StringBuilder(TunaCadJobObject.QuoteArguments(new[]{executable})+(args.Length==0?"":" "+TunaCadJobObject.QuoteArguments(args)));
            if(command.Length>=32767)throw new ArgumentException("Provider command exceeds Windows limit");
            PI pi;
            // CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW.
            // No BREAKAWAY flag. Environment NULL inherits the supervisor's exact environment.
            Check(CreateProcessW(executable,command,IntPtr.Zero,IntPtr.Zero,true,0x08080004,IntPtr.Zero,cwd,ref si,out pi));
            child.process=pi.process;child.thread=pi.thread;child.Id=checked((int)pi.pid);
            child.StandardOutput=new System.IO.FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(outRead,true),System.IO.FileAccess.Read,4096,false);outRead=IntPtr.Zero;
            child.StandardError=new System.IO.FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(errRead,true),System.IO.FileAccess.Read,4096,false);errRead=IntPtr.Zero;
            return child;
        } catch {child.Dispose();throw;}
        finally {if(initialized)DeleteProcThreadAttributeList(list);if(list!=IntPtr.Zero)Marshal.FreeHGlobal(list);if(values!=IntPtr.Zero)Marshal.FreeHGlobal(values);if(jobValue!=IntPtr.Zero)Marshal.FreeHGlobal(jobValue);
            Close(ref outRead);Close(ref outWrite);Close(ref errRead);Close(ref errWrite);Close(ref input);}
    }
    public void AssignAndVerify(IntPtr job) {
        if(resumed||assigned)throw new InvalidOperationException("Assignment must precede resume exactly once");
        bool member;Check(IsProcessInJob(process,job,out member));
        if(!member||HandleInheritable(job))throw new InvalidOperationException("Job ownership/membership invalid");assigned=true;
    }
    public void Resume() {
        if(!assigned||resumed)throw new InvalidOperationException("Resume requires verified assignment");
        uint previous=ResumeThread(thread);if(previous!=1)throw new InvalidOperationException("Unexpected primary-thread suspend count: "+previous);
        resumed=true;Close(ref thread);
    }
    public bool HasExited {get {uint result=WaitForSingleObject(process,0);if(result==0xFFFFFFFF)Check(false);return result==0;}}
    public void WaitForExit() {uint result=WaitForSingleObject(process,60000);if(result!=0)throw new InvalidOperationException("Bounded child wait failed: "+result);}
    public int ExitCode {get {if(!HasExited)throw new InvalidOperationException("Child still active");uint code;Check(GetExitCodeProcess(process,out code));return unchecked((int)code);}}
    public static TunaCadJobObject.BASIC_ACCOUNTING WaitForEmpty(IntPtr job) {
        var deadline=DateTime.UtcNow.AddSeconds(2);
        do {var info=TunaCadJobObject.Accounting(job);if(info.ActiveProcesses==0)return info;System.Threading.Thread.Sleep(20);}while(DateTime.UtcNow<deadline);
        throw new InvalidOperationException("Owned job did not become empty within 2s");
    }
    public static void StopJob(IntPtr job) {Check(TerminateJobObject(job,1));WaitForEmpty(job);}
    public void Dispose() {
        try {if(process!=IntPtr.Zero&&!HasExited) {Check(TerminateProcess(process,1));if(WaitForSingleObject(process,2000)!=0)throw new InvalidOperationException("Suspended/active child termination unverified");}}
        finally {if(StandardOutput!=null)StandardOutput.Dispose();if(StandardError!=null)StandardError.Dispose();Close(ref thread);Close(ref process);}
    }
}
