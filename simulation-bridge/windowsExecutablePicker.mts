import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

/** Opens one fixed local file picker. The browser selects only the provider
 * kind; it cannot supply commands, arguments, filters or a program to launch. */
export async function browseExternalProviderExecutable(provider: 'gmsh' | 'calculix'): Promise<string> {
  if (process.platform !== 'win32') throw new Error('BRIDGE_BROWSE_UNAVAILABLE');
  const fileName = provider === 'gmsh' ? 'gmsh.exe' : 'ccx*.exe';
  const title = provider === 'gmsh' ? 'Select the externally installed Gmsh executable' : 'Select the externally installed CalculiX executable';
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    `$dialog.Title = '${title}'`,
    `$dialog.Filter = '${fileName}|${fileName}'`,
    '$dialog.CheckFileExists = $true',
    '$dialog.Multiselect = $false',
    '$dialog.RestoreDirectory = $true',
    // Give the modal picker an explicit, topmost owner. Without an owner the
    // dialog can open behind Chrome when PowerShell is launched by the Bridge.
    '$owner = New-Object System.Windows.Forms.Form',
    "$owner.Text = 'TunaCAD Simulation Bridge'",
    '$owner.TopMost = $true',
    '$owner.ShowInTaskbar = $false',
    '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
    '$owner.Size = New-Object System.Drawing.Size(1, 1)',
    '$owner.Opacity = 0',
    '$owner.Show()',
    '$owner.Activate()',
    'try { if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) } } finally { $dialog.Dispose(); $owner.Close(); $owner.Dispose() }',
  ].join('; ');
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true, timeout: 120_000, maxBuffer: 32 * 1024 });
  return stdout.trim();
}
