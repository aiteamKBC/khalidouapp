using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

internal static class KhaliduoInputProbe
{
    private const int WhKeyboardLl = 13;
    private const int WhMouseLl = 14;
    private const int WmKeyDown = 0x0100;
    private const int WmSysKeyDown = 0x0104;
    private const int WmMouseMove = 0x0200;
    private const uint LlkHfInjected = 0x10;
    private const uint LlmHfInjected = 0x01;

    private static long _realMouse;
    private static long _realKeyboard;
    private static long _injectedMouse;
    private static long _injectedKeyboard;
    private static readonly HookProc MouseCallback = MouseHook;
    private static readonly HookProc KeyboardCallback = KeyboardHook;
    private static IntPtr _mouseHook = IntPtr.Zero;
    private static IntPtr _keyboardHook = IntPtr.Zero;
    private static Timer _reportTimer;

    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseHookData
    {
        public Point Position;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardHookData
    {
        public uint VirtualKey;
        public uint ScanCode;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Message
    {
        public IntPtr Window;
        public uint Value;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public Point Position;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(
        int hookType,
        HookProc callback,
        IntPtr module,
        uint threadId
    );

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(
        IntPtr hook,
        int code,
        IntPtr message,
        IntPtr data
    );

    [DllImport("user32.dll")]
    private static extern sbyte GetMessage(
        out Message message,
        IntPtr window,
        uint minimum,
        uint maximum
    );

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage([In] ref Message message);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage([In] ref Message message);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string moduleName);

    private static IntPtr MouseHook(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            MouseHookData input = (MouseHookData)Marshal.PtrToStructure(
                data,
                typeof(MouseHookData)
            );
            if ((input.Flags & LlmHfInjected) != 0)
            {
                Interlocked.Increment(ref _injectedMouse);
            }
            else
            {
                Interlocked.Increment(ref _realMouse);
            }
        }
        return CallNextHookEx(_mouseHook, code, message, data);
    }

    private static IntPtr KeyboardHook(int code, IntPtr message, IntPtr data)
    {
        int messageValue = message.ToInt32();
        if (code >= 0 && (messageValue == WmKeyDown || messageValue == WmSysKeyDown))
        {
            KeyboardHookData input = (KeyboardHookData)Marshal.PtrToStructure(
                data,
                typeof(KeyboardHookData)
            );
            if ((input.Flags & LlkHfInjected) != 0)
            {
                Interlocked.Increment(ref _injectedKeyboard);
            }
            else
            {
                Interlocked.Increment(ref _realKeyboard);
            }
        }
        return CallNextHookEx(_keyboardHook, code, message, data);
    }

    private static void Report(object state)
    {
        long realMouse = Interlocked.Exchange(ref _realMouse, 0);
        long realKeyboard = Interlocked.Exchange(ref _realKeyboard, 0);
        long injectedMouse = Interlocked.Exchange(ref _injectedMouse, 0);
        long injectedKeyboard = Interlocked.Exchange(ref _injectedKeyboard, 0);
        Console.WriteLine(
            "{\"real_mouse\":" + realMouse
            + ",\"real_keyboard\":" + realKeyboard
            + ",\"injected_mouse\":" + injectedMouse
            + ",\"injected_keyboard\":" + injectedKeyboard
            + "}"
        );
        Console.Out.Flush();
    }

    public static int Main()
    {
        using (Process process = Process.GetCurrentProcess())
        using (ProcessModule module = process.MainModule)
        {
            IntPtr moduleHandle = GetModuleHandle(module.ModuleName);
            _mouseHook = SetWindowsHookEx(WhMouseLl, MouseCallback, moduleHandle, 0);
            _keyboardHook = SetWindowsHookEx(
                WhKeyboardLl,
                KeyboardCallback,
                moduleHandle,
                0
            );
        }

        if (_mouseHook == IntPtr.Zero || _keyboardHook == IntPtr.Zero)
        {
            if (_mouseHook != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_mouseHook);
            }
            if (_keyboardHook != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_keyboardHook);
            }
            return 2;
        }

        _reportTimer = new Timer(Report, null, 1000, 1000);
        Message message;
        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }

        _reportTimer.Dispose();
        UnhookWindowsHookEx(_mouseHook);
        UnhookWindowsHookEx(_keyboardHook);
        return 0;
    }
}
