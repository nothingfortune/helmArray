# Spike 1 (docs/plans/04-roadmap.md, M0): can Windows tell which device sent a key?
#
# FOR THE OWNER TO RUN, BY HAND. It listens to keyboard input from every device for 60 seconds
# (Raw Input, read-only: it cannot block, change or send a key). Agents and tests never run it.
# Don't type anything private while it runs: it prints the name of every key pressed, from any app.
#
#   powershell -ExecutionPolicy Bypass -File tools\spikes\raw-input.ps1
#
# Then press, in order: a few keys on the LEFT unit, a few on the RIGHT unit, a few on the keyboard.
# Paste the whole output into docs/spikes/01-per-device-input.md.

param([int]$Seconds = 60)

$ErrorActionPreference = 'Stop'

Write-Host '== Azeron interfaces (USB 16D0:12F7), with the container each belongs to'
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match 'VID_16D0&PID_12F7' } | ForEach-Object {
    $container = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_ContainerId' -ErrorAction SilentlyContinue).Data
    '{0,-12} {1,-45} container {2}' -f $_.Class, $_.FriendlyName, $container
    '             {0}' -f $_.InstanceId
}
Write-Host ''

Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public class RawKeySpy : NativeWindow {
    const int WM_INPUT = 0x00FF;
    const uint RID_INPUT = 0x10000003;
    const uint RIDI_DEVICENAME = 0x20000007;
    const int RIM_TYPEKEYBOARD = 1;
    const int RIDEV_INPUTSINK = 0x100;

    [StructLayout(LayoutKind.Sequential)]
    struct RAWINPUTDEVICE { public ushort UsagePage; public ushort Usage; public int Flags; public IntPtr Target; }
    [StructLayout(LayoutKind.Sequential)]
    struct RAWINPUTHEADER { public int Type; public int Size; public IntPtr Device; public IntPtr WParam; }
    [StructLayout(LayoutKind.Sequential)]
    struct RAWKEYBOARD { public ushort MakeCode; public ushort Flags; public ushort Reserved; public ushort VKey; public uint Message; public uint ExtraInformation; }
    [StructLayout(LayoutKind.Sequential)]
    struct RAWINPUTDEVICELIST { public IntPtr Device; public int Type; }

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices, uint count, uint size);
    [DllImport("user32.dll")]
    static extern uint GetRawInputData(IntPtr rawInput, uint command, IntPtr data, ref uint size, uint headerSize);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern uint GetRawInputDeviceInfo(IntPtr device, uint command, StringBuilder data, ref uint size);
    [DllImport("user32.dll", SetLastError = true)]
    static extern uint GetRawInputDeviceList([Out] RAWINPUTDEVICELIST[] list, ref uint count, uint size);

    readonly Dictionary<IntPtr, int> counts = new Dictionary<IntPtr, int>();

    public RawKeySpy() {
        CreateParams cp = new CreateParams();
        cp.Parent = new IntPtr(-3); // HWND_MESSAGE: a hidden, message-only window
        CreateHandle(cp);
        RAWINPUTDEVICE[] wanted = new RAWINPUTDEVICE[1];
        wanted[0].UsagePage = 0x01; // generic desktop
        wanted[0].Usage = 0x06;     // keyboard
        wanted[0].Flags = RIDEV_INPUTSINK;
        wanted[0].Target = Handle;
        if (!RegisterRawInputDevices(wanted, 1, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE))))
            throw new Exception("RegisterRawInputDevices failed: " + Marshal.GetLastWin32Error());
    }

    public static string Name(IntPtr device) {
        if (device == IntPtr.Zero) return "(no device: injected by software)";
        uint size = 0;
        GetRawInputDeviceInfo(device, RIDI_DEVICENAME, null, ref size);
        StringBuilder sb = new StringBuilder((int)size + 1);
        GetRawInputDeviceInfo(device, RIDI_DEVICENAME, sb, ref size);
        return sb.ToString();
    }

    public static void ListKeyboards() {
        uint count = 0;
        uint itemSize = (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICELIST));
        GetRawInputDeviceList(null, ref count, itemSize);
        RAWINPUTDEVICELIST[] list = new RAWINPUTDEVICELIST[count];
        GetRawInputDeviceList(list, ref count, itemSize);
        foreach (RAWINPUTDEVICELIST d in list)
            if (d.Type == RIM_TYPEKEYBOARD) Console.WriteLine("  0x{0:X}  {1}", d.Device.ToInt64(), Name(d.Device));
    }

    protected override void WndProc(ref Message m) {
        if (m.Msg == WM_INPUT) {
            uint headerSize = (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER));
            uint size = 0;
            GetRawInputData(m.LParam, RID_INPUT, IntPtr.Zero, ref size, headerSize);
            IntPtr buffer = Marshal.AllocHGlobal((int)size);
            try {
                if (GetRawInputData(m.LParam, RID_INPUT, buffer, ref size, headerSize) == size) {
                    RAWINPUTHEADER header = (RAWINPUTHEADER)Marshal.PtrToStructure(buffer, typeof(RAWINPUTHEADER));
                    if (header.Type == RIM_TYPEKEYBOARD) {
                        RAWKEYBOARD kb = (RAWKEYBOARD)Marshal.PtrToStructure(new IntPtr(buffer.ToInt64() + headerSize), typeof(RAWKEYBOARD));
                        bool down = (kb.Flags & 1) == 0;
                        if (down) {
                            int n;
                            counts.TryGetValue(header.Device, out n);
                            counts[header.Device] = n + 1;
                            Console.WriteLine("{0:HH:mm:ss.fff}  {1,-12} 0x{2:X}  {3}", DateTime.Now, (Keys)kb.VKey, header.Device.ToInt64(), Name(header.Device));
                        }
                    }
                }
            } finally {
                Marshal.FreeHGlobal(buffer);
            }
        }
        base.WndProc(ref m);
    }

    public void Summary() {
        Console.WriteLine();
        Console.WriteLine("== Key presses per device");
        foreach (KeyValuePair<IntPtr, int> e in counts)
            Console.WriteLine("  {0,4}  0x{1:X}  {2}", e.Value, e.Key.ToInt64(), Name(e.Key));
    }
}
'@

Write-Host '== Keyboards Raw Input can see'
[RawKeySpy]::ListKeyboards()
Write-Host ''
Write-Host "== Listening for $Seconds seconds. Press keys on the LEFT unit, then the RIGHT unit, then the keyboard."
$spy = New-Object RawKeySpy
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $Seconds * 1000
$timer.add_Tick({ $timer.Stop(); [System.Windows.Forms.Application]::ExitThread() })
$timer.Start()
[System.Windows.Forms.Application]::Run()
$spy.Summary()
$spy.DestroyHandle()
