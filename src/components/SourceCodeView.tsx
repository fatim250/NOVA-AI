import React, { useMemo, useState } from "react";
import JSZip from "jszip";
import { Check, Copy, Download, FileCode2, FolderTree } from "lucide-react";
import { SOURCE_CORE_FILES } from "../data/sourceCoreFiles";
import { SOURCE_SYSTEM_FILES } from "../data/sourceSystemFiles";
import type { SourceFileEntry } from "../types/notch";

const ALL_SOURCE_FILES: SourceFileEntry[] = [...SOURCE_CORE_FILES, ...SOURCE_SYSTEM_FILES];

export async function downloadWindowsNotchZip(): Promise<void> {
  const zip = new JSZip();
  const root = zip.folder("WindowsNotchPro");
  if (!root) return;

  // Include __init__.py files so Python package imports work out of the box
  const packages = [
    "windows_notch_pro/__init__.py",
    "windows_notch_pro/ui/__init__.py",
    "windows_notch_pro/ai/__init__.py",
    "windows_notch_pro/voice/__init__.py",
    "windows_notch_pro/automation/__init__.py",
    "windows_notch_pro/sandbox/__init__.py",
    "windows_notch_pro/security/__init__.py",
    "windows_notch_pro/platform_abstraction/__init__.py",
    "windows_notch_pro/service/__init__.py",
  ];
  for (const initPath of packages) {
    root.file(initPath, '"""WindowsNotch Pro package."""\n');
  }

  for (const file of ALL_SOURCE_FILES) {
    root.file(file.path, file.content);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "WindowsNotchPro-Windows-x64.zip";
  a.click();
  URL.revokeObjectURL(url);
}

export const SourceCodeView: React.FC = () => {
  const [selectedPath, setSelectedPath] = useState<string>(ALL_SOURCE_FILES[0].path);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<SourceFileEntry["group"], SourceFileEntry[]>();
    for (const file of ALL_SOURCE_FILES) {
      const list = map.get(file.group) ?? [];
      list.push(file);
      map.set(file.group, list);
    }
    return Array.from(map.entries());
  }, []);

  const activeFile = useMemo(
    () => ALL_SOURCE_FILES.find((f) => f.path === selectedPath) ?? ALL_SOURCE_FILES[0],
    [selectedPath]
  );

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadWindowsNotchZip();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">
            Windows 10 &amp; 11 Native Source Package
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {ALL_SOURCE_FILES.length} modular files · PyQt6 Dynamic Island · 5-turn sliding-window
            memory · Session-0 LocalSystem Service · C++ ICredentialProvider COM DLL · unittest
            suite · PyInstaller EXE &amp; PowerShell installers.
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="flex h-9 items-center gap-2 rounded-lg bg-sky-500 px-4 text-xs font-semibold text-slate-950 whitespace-nowrap transition-colors hover:bg-sky-400 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {downloading ? "Building Archive..." : "Download Full Package (.zip)"}
        </button>
      </div>

      {/* File Explorer Split View */}
      <div className="grid min-h-[560px] flex-1 grid-cols-1 overflow-hidden rounded-xl border border-slate-800 bg-[#101520] lg:grid-cols-12">
        {/* Left Tree */}
        <div className="overflow-y-auto border-b border-slate-800 p-3 lg:col-span-4 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center gap-2 px-2 text-xs font-semibold text-slate-300">
            <FolderTree className="h-3.5 w-3.5 text-sky-400" />
            <span className="font-display">WindowsNotchPro/</span>
          </div>

          <div className="space-y-4">
            {grouped.map(([groupName, files]) => (
              <div key={groupName}>
                <p className="mb-1 px-2 text-[11px] font-medium text-slate-500">{groupName}</p>
                <div className="space-y-0.5">
                  {files.map((file) => {
                    const active = file.path === activeFile.path;
                    const shortName = file.path.replace(/^windows_notch_pro\//, "");
                    return (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => setSelectedPath(file.path)}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[11px] transition-colors ${
                          active
                            ? "bg-sky-500/15 text-sky-200"
                            : "text-slate-300 hover:bg-white/[0.04] hover:text-white"
                        }`}
                      >
                        <FileCode2 className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                        <span className="truncate">{shortName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Code Viewer */}
        <div className="flex flex-col overflow-hidden lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/50 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs font-semibold text-slate-100">
                {activeFile.path}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">{activeFile.summary}</p>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-700 px-3 text-xs font-medium text-slate-200 hover:border-slate-500 hover:text-white"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>

          <pre className="flex-1 overflow-auto bg-[#0B0F17] p-4 font-mono text-xs leading-relaxed text-slate-200">
            <code>{activeFile.content}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
