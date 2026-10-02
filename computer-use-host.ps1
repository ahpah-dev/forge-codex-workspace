$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$nativeInput = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class ForgeDesktopInput
{
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort virtualKey;
        public ushort scanCode;
        public uint flags;
        public uint time;
        public IntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MouseInput mouse;
        [FieldOffset(0)] public KeyboardInput keyboard;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Input
    {
        public uint type;
        public InputUnion data;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int x;
        public int y;
    }

    private const uint InputMouse = 0;
    private const uint InputKeyboard = 1;
    private const uint MouseMove = 0x0001;
    private const uint MouseLeftDown = 0x0002;
    private const uint MouseLeftUp = 0x0004;
    private const uint MouseRightDown = 0x0008;
    private const uint MouseRightUp = 0x0010;
    private const uint MouseMiddleDown = 0x0020;
    private const uint MouseMiddleUp = 0x0040;
    private const uint MouseWheel = 0x0800;
    private const uint MouseHorizontalWheel = 0x1000;
    private const uint KeyUp = 0x0002;
    private const uint KeyUnicode = 0x0004;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] inputs, int size);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    private delegate bool WindowCallback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    public sealed class WindowInfo
    {
        public string handle;
        public string title;
        public int processId;
        public bool minimized;
    }

    public static WindowInfo[] Windows()
    {
        var windows = new System.Collections.Generic.List<WindowInfo>();
        EnumWindows(delegate(IntPtr window, IntPtr parameter) {
            if (!IsWindowVisible(window)) return true;
            var text = new StringBuilder(512);
            GetWindowText(window, text, text.Capacity);
            if (text.Length == 0) return true;
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            windows.Add(new WindowInfo { handle = window.ToInt64().ToString(), title = text.ToString(), processId = unchecked((int)processId), minimized = IsIconic(window) });
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static string Focus(string target)
    {
        var windows = Windows();
        var matches = Array.FindAll(windows, window => window.handle == target || String.Equals(window.title, target, StringComparison.OrdinalIgnoreCase));
        if (matches.Length == 0) matches = Array.FindAll(windows, window => window.title.IndexOf(target, StringComparison.OrdinalIgnoreCase) >= 0);
        if (matches.Length == 0) throw new InvalidOperationException("No open window matches. Inspect computer_use_state for current window handles.");
        if (matches.Length > 1) throw new InvalidOperationException("Several windows match. Use an exact window handle from computer_use_state.");
        var handle = new IntPtr(Int64.Parse(matches[0].handle));
        if (IsIconic(handle)) ShowWindow(handle, 9);
        SetForegroundWindow(handle);
        Thread.Sleep(150);
        if (GetForegroundWindow() != handle) throw new InvalidOperationException("Windows prevented focus switching. Use the desktop screenshot or Alt+Tab to select the intended app.");
        return matches[0].title;
    }

    private static void EnsureSent(Input[] inputs)
    {
        var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
        if (sent != inputs.Length)
            throw new InvalidOperationException("Windows rejected the input event (error " + Marshal.GetLastWin32Error() + "). The target app may be running as administrator.");
    }

    private static Input MouseEvent(uint flags, uint mouseData = 0)
    {
        return new Input { type = InputMouse, data = new InputUnion { mouse = new MouseInput { flags = flags, mouseData = mouseData } } };
    }

    private static Input KeyEvent(ushort virtualKey, ushort scanCode, uint flags)
    {
        return new Input { type = InputKeyboard, data = new InputUnion { keyboard = new KeyboardInput { virtualKey = virtualKey, scanCode = scanCode, flags = flags } } };
    }

    public static void Move(int x, int y)
    {
        if (!SetCursorPos(x, y)) throw new InvalidOperationException("Windows could not move the pointer (error " + Marshal.GetLastWin32Error() + ").");
    }

    public static void Click(int x, int y, string button, int count)
    {
        Move(x, y);
        uint down, up;
        switch ((button ?? "left").ToLowerInvariant())
        {
            case "right": down = MouseRightDown; up = MouseRightUp; break;
            case "middle": down = MouseMiddleDown; up = MouseMiddleUp; break;
            default: down = MouseLeftDown; up = MouseLeftUp; break;
        }
        for (var i = 0; i < Math.Max(1, Math.Min(2, count)); i++)
        {
            EnsureSent(new[] { MouseEvent(down) });
            Thread.Sleep(45);
            EnsureSent(new[] { MouseEvent(up) });
            if (i == 0 && count > 1) Thread.Sleep(80);
        }
    }

    public static void Drag(int fromX, int fromY, int toX, int toY, string button)
    {
        Move(fromX, fromY);
        uint down, up;
        switch ((button ?? "left").ToLowerInvariant())
        {
            case "right": down = MouseRightDown; up = MouseRightUp; break;
            case "middle": down = MouseMiddleDown; up = MouseMiddleUp; break;
            default: down = MouseLeftDown; up = MouseLeftUp; break;
        }
        EnsureSent(new[] { MouseEvent(down) });
        try
        {
            const int steps = 18;
            for (var step = 1; step <= steps; step++)
            {
                var progress = (double)step / steps;
                Move((int)Math.Round(fromX + (toX - fromX) * progress), (int)Math.Round(fromY + (toY - fromY) * progress));
                Thread.Sleep(12);
            }
        }
        finally { EnsureSent(new[] { MouseEvent(up) }); }
    }

    public static void Scroll(int x, int y, int horizontal, int vertical)
    {
        if (x >= 0 && y >= 0) Move(x, y);
        var inputs = new System.Collections.Generic.List<Input>();
        if (vertical != 0) inputs.Add(MouseEvent(MouseWheel, unchecked((uint)(-vertical * 120))));
        if (horizontal != 0) inputs.Add(MouseEvent(MouseHorizontalWheel, unchecked((uint)(-horizontal * 120))));
        if (inputs.Count > 0) EnsureSent(inputs.ToArray());
    }

    public static void TypeText(string text)
    {
        if (String.IsNullOrEmpty(text)) return;
        for (var offset = 0; offset < text.Length; offset += 160)
        {
            var end = Math.Min(text.Length, offset + 160);
            var inputs = new Input[(end - offset) * 2];
            var index = 0;
            for (var i = offset; i < end; i++)
            {
                var character = text[i];
                inputs[index++] = KeyEvent(0, character, KeyUnicode);
                inputs[index++] = KeyEvent(0, character, KeyUnicode | KeyUp);
            }
            EnsureSent(inputs);
        }
    }

    public static void PressKeys(ushort[] keys)
    {
        if (keys == null || keys.Length == 0) throw new InvalidOperationException("Choose a key to press.");
        var inputs = new Input[keys.Length * 2];
        var index = 0;
        foreach (var key in keys) inputs[index++] = KeyEvent(key, 0, 0);
        for (var i = keys.Length - 1; i >= 0; i--) inputs[index++] = KeyEvent(keys[i], 0, KeyUp);
        EnsureSent(inputs);
    }

    public static int CursorX() { Point point; return GetCursorPos(out point) ? point.x : -1; }
    public static int CursorY() { Point point; return GetCursorPos(out point) ? point.y : -1; }

    public static string ForegroundTitle()
    {
        var window = GetForegroundWindow();
        var text = new StringBuilder(512);
        GetWindowText(window, text, text.Capacity);
        return text.ToString();
    }

    public static int ForegroundProcessId()
    {
        uint processId;
        GetWindowThreadProcessId(GetForegroundWindow(), out processId);
        return unchecked((int)processId);
    }
}
'@

Add-Type -TypeDefinition $nativeInput

while ($null -ne ($line = [Console]::In.ReadLine())) {
    $id = $null
    try {
        $request = $line | ConvertFrom-Json -ErrorAction Stop
        $id = $request.id
        $result = switch ([string]$request.action) {
            'state' {
                @{
                    cursor = @{ x = [ForgeDesktopInput]::CursorX(); y = [ForgeDesktopInput]::CursorY() }
                    foregroundWindow = [ForgeDesktopInput]::ForegroundTitle()
                    processId = [ForgeDesktopInput]::ForegroundProcessId()
                    windows = @([ForgeDesktopInput]::Windows())
                }
            }
            'focus' { @{ foregroundWindow = [ForgeDesktopInput]::Focus([string]$request.target) } }
            'move' { [ForgeDesktopInput]::Move([int]$request.x, [int]$request.y); @{ moved = $true } }
            'click' { [ForgeDesktopInput]::Click([int]$request.x, [int]$request.y, [string]$request.button, [int]$request.count); @{ clicked = $true } }
            'drag' { [ForgeDesktopInput]::Drag([int]$request.fromX, [int]$request.fromY, [int]$request.toX, [int]$request.toY, [string]$request.button); @{ dragged = $true } }
            'scroll' { [ForgeDesktopInput]::Scroll([int]$request.x, [int]$request.y, [int]$request.horizontal, [int]$request.vertical); @{ scrolled = $true } }
            'type' { [ForgeDesktopInput]::TypeText([string]$request.text); @{ typed = $true } }
            'press-keys' { [ForgeDesktopInput]::PressKeys([UInt16[]]@($request.keys | ForEach-Object { [UInt16]$_ })); @{ pressed = $true } }
            default { throw "Unsupported native desktop action: $($request.action)" }
        }
        $response = @{ id = $id; result = $result }
    } catch {
        $response = @{ id = $id; error = $_.Exception.Message }
    }
    [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 8))
}
