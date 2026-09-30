import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

function runPowerShell(script, input) {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('Secure provider-key storage currently requires Windows DPAPI.'));
  }
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Windows secure storage did not respond in time.'));
    }, 10000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('PowerShell could not access Windows secure storage.'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(errors.trim() || 'Windows could not access secure provider-key storage.'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input, 'utf8');
  });
}

export async function encryptProviderKey(key) {
  const script = dpapiPowerShellScript('Protect');
  return (await runPowerShell(script, String(key))).trim();
}

export async function decryptProviderKey(ciphertext) {
  const script = dpapiPowerShellScript('Unprotect');
  return await runPowerShell(script, String(ciphertext));
}

function dpapiPowerShellScript(operation) {
  const source = String.raw`
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

public static class ForgeDpapi {
    [StructLayout(LayoutKind.Sequential)]
    private struct DATA_BLOB { public int cbData; public IntPtr pbData; }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(ref DATA_BLOB input, string description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out DATA_BLOB output);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(ref DATA_BLOB input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out DATA_BLOB output);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LocalFree(IntPtr memory);

    private static DATA_BLOB MakeBlob(byte[] data) {
        DATA_BLOB blob = new DATA_BLOB();
        blob.cbData = data.Length;
        blob.pbData = Marshal.AllocHGlobal(data.Length);
        Marshal.Copy(data, 0, blob.pbData, data.Length);
        return blob;
    }

    private static void ClearAndFree(ref DATA_BLOB blob) {
        if (blob.pbData == IntPtr.Zero) return;
        byte[] zeroes = new byte[blob.cbData];
        Marshal.Copy(zeroes, 0, blob.pbData, blob.cbData);
        Marshal.FreeHGlobal(blob.pbData);
        blob.pbData = IntPtr.Zero;
    }

    public static string Protect(string value) {
        byte[] plaintext = Encoding.Unicode.GetBytes(value + "\0");
        DATA_BLOB input = MakeBlob(plaintext);
        DATA_BLOB output = new DATA_BLOB();
        try {
            if (!CryptProtectData(ref input, "Forge provider credential", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            byte[] encrypted = new byte[output.cbData];
            Marshal.Copy(output.pbData, encrypted, 0, output.cbData);
            StringBuilder hex = new StringBuilder(encrypted.Length * 2);
            foreach (byte item in encrypted) hex.Append(item.ToString("x2"));
            return hex.ToString();
        } finally {
            Array.Clear(plaintext, 0, plaintext.Length);
            ClearAndFree(ref input);
            if (output.pbData != IntPtr.Zero) LocalFree(output.pbData);
        }
    }

    public static string Unprotect(string value) {
        if (String.IsNullOrWhiteSpace(value) || (value.Length % 2) != 0)
            throw new FormatException("The encrypted provider key is malformed.");
        byte[] encrypted = new byte[value.Length / 2];
        for (int i = 0; i < encrypted.Length; i++) encrypted[i] = Convert.ToByte(value.Substring(i * 2, 2), 16);
        DATA_BLOB input = MakeBlob(encrypted);
        DATA_BLOB output = new DATA_BLOB();
        try {
            if (!CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            byte[] plaintext = new byte[output.cbData];
            try {
                Marshal.Copy(output.pbData, plaintext, 0, output.cbData);
                return Encoding.Unicode.GetString(plaintext).TrimEnd('\0');
            } finally {
                Array.Clear(plaintext, 0, plaintext.Length);
            }
        } finally {
            Array.Clear(encrypted, 0, encrypted.Length);
            ClearAndFree(ref input);
            if (output.pbData != IntPtr.Zero) LocalFree(output.pbData);
        }
    }
}`;
  return `$ErrorActionPreference='Stop'; $source=@'\n${source}\n'@; Add-Type -TypeDefinition $source -Language CSharp; $inputText=[Console]::In.ReadToEnd(); [Console]::Out.Write([ForgeDpapi]::${operation}($inputText))`;
}

export async function readEncryptedProviderKeys(filePath) {
  try {
    const value = JSON.parse(await readFile(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export async function writeEncryptedProviderKeys(filePath, values) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(values, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, filePath);
}
