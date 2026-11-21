# Install Guide — claude-manager (Windows)

Hướng dẫn build + cài đặt trên Windows 10/11 (x64).

## Prerequisites

Cài theo thứ tự:

### 1. Rust toolchain (MSVC)
```powershell
# Chạy trong PowerShell
winget install --id Rustlang.Rustup -e
# Sau khi cài, mở PowerShell mới:
rustup default stable-msvc
rustc --version   # ≥ 1.75
```

### 2. Microsoft C++ Build Tools
Cần MSVC linker + Windows SDK để build native Rust code.

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e
```

Trong Visual Studio Installer, chọn workload **"Desktop development with C++"**:
- MSVC v143 build tools
- Windows 11 SDK (hoặc Windows 10 SDK)
- C++ CMake tools for Windows

### 3. Node + pnpm
```powershell
winget install --id OpenJS.NodeJS.LTS -e     # Node ≥ 20
node --version
npm install -g pnpm@latest                    # pnpm ≥ 10
pnpm --version
```

### 4. WebView2 Runtime
Windows 11: đã có sẵn. Windows 10: cài Evergreen runtime:
```powershell
winget install --id Microsoft.EdgeWebView2Runtime -e
```

### 5. Git + Claude Code
```powershell
winget install --id Git.Git -e
# Claude Code: theo hướng dẫn chính thức của Anthropic
```

Verify:
```powershell
node --version && pnpm --version && rustc --version && cargo --version
```

## Build từ source

```powershell
git clone <repo-url> claude-manager
cd claude-manager
pnpm install --ignore-scripts
pnpm tauri build
```

Lần build đầu ~15-30 phút (Rust deps + WiX toolset auto-download).

**Output**: `src-tauri\target\release\bundle\`
- `msi\claude-manager_0.1.0_x64_en-US.msi` — MSI installer chính
- `nsis\claude-manager_0.1.0_x64-setup.exe` — NSIS installer (nếu bật)

## Install steps

### 1. Stop dev server nếu đang chạy
Ctrl+C trong terminal đang chạy `pnpm tauri dev`.

### 2. Cài app qua MSI
Double-click `claude-manager_0.1.0_x64_en-US.msi` → next → install.

Mặc định cài vào `C:\Program Files\claude-manager\`.

Binary chính: `C:\Program Files\claude-manager\claude-manager.exe`.

Shortcut Start Menu: `claude-manager`.

### 3. Mở app lần đầu
Chạy từ Start Menu hoặc:
```powershell
& "C:\Program Files\claude-manager\claude-manager.exe"
```

App khởi tạo `%APPDATA%\theanh1810\claude-manager\data\`:
- `db.sqlite`
- `blobs\`
- `logs\`
- `backups\`

Đường dẫn đầy đủ: `C:\Users\<username>\AppData\Roaming\theanh1810\claude-manager\data\`.

#### Nâng cấp từ bản build dùng identifier trước đó
Tên thư mục dữ liệu đã đổi. Để giữ lịch sử, trước lần mở đầu tiên của bản mới, đổi tên thư mục mà bản build trước đã tạo dưới `%APPDATA%` (đường dẫn kết thúc bằng `\claude-manager\data`) thành `%APPDATA%\theanh1810\claude-manager\data`. Không đổi tên thì app tạo thư mục dữ liệu mới, trống; thư mục cũ vẫn còn nguyên trên đĩa. Cài đặt giao diện do webview lưu (project đang chọn, chế độ sidebar, chế độ xem diff) bị đặt lại sau khi đổi identifier, và đổi tên thư mục dữ liệu không mang chúng sang. Nếu bản cũ từng bật "launch at login", hãy kiểm tra lại mục này sau khi nâng cấp, vì login item có thể vẫn còn đăng ký trong khi app hiển thị là tắt.

### 4. Install hook vào Claude Code
```powershell
& "C:\Program Files\claude-manager\claude-manager.exe" install
```

Bước này sẽ:
1. **Backup** `%USERPROFILE%\.claude\settings.json` → `%APPDATA%\theanh1810\claude-manager\data\backups\settings.json.<timestamp>.bak`
2. **Add hook entry** namespaced với marker `claude-manager:managed-hook` vào `PostToolUse` cho `Edit|Write|NotebookEdit`
3. **Restart Claude Code** sau bước này để hook có hiệu lực

### 5. Verify hook installed
```powershell
Get-Content $env:USERPROFILE\.claude\settings.json | Select-String claude-manager
```

Phải thấy hook entry mới.

## E2E Test Checklist

### Test 1: Capture flow
```powershell
# Terminal 1: Mở app
& "C:\Program Files\claude-manager\claude-manager.exe"

# Terminal 2: Start Claude Code trong thư mục test
$test = "$env:TEMP\claude-mgr-test"
mkdir $test -Force; cd $test
"hello" | Out-File demo.txt -Encoding utf8
claude
```

Trong Claude prompt: `Edit demo.txt thêm dòng "world"`

**Expected**:
- Claude edit file
- App nhận edit event trong <1s
- Sidebar hiển thị edit mới ở top
- Status `pending`
- Path `C:\Users\<username>\AppData\Local\Temp\claude-mgr-test\demo.txt`

### Test 2: Diff view
- Click edit trong sidebar
- Expected: Monaco diff hiển thị before/after side-by-side
- Header: file path, time, tool, +/- line counts

### Test 3: Accept
- Click **Accept**
- Expected: status đổi `accepted`, button disable
- File `demo.txt` giữ nội dung Claude đã edit

### Test 4: Reject (cho edit khác)
- Tạo edit mới: `"v1" | Out-File test2.txt`, prompt Claude edit thành "v2"
- Trong app: click edit → **Reject**
- Expected: file restore (nếu before_blob captured), status `rejected`

### Test 5: Rollback
- Edit đã Accept → **Rollback** → OK
- Expected: file restore về before_blob, row mới status `rolled_back`

### Test 6: Explain
- Cài đặt → nhập Anthropic API key → Đóng
- Click edit → **Giải thích**
- Expected: panel dưới hiện text Vietnamese

### Test 7: Pause / Resume
- **Pause** trên header → edit mới không capture
- **Resume** → capture tiếp

### Test 8: Mode switch
- Settings → Interactive
- Status bar đổi icon mode

### Test 9: Realtime update
- Trigger edit → list refresh ~200ms không cần reload

### Test 10: Persistence
- Đóng app → tạo edit → mở lại → edit hiện trong list

### Test 11: Export config
- Config tab → **Export**
- Chọn thư mục dest (ví dụ `%USERPROFILE%\Desktop\`)
- Expected: file `.tar.gz` tạo ra, KHÔNG có toast `os error 2`
- Mở archive (7-Zip/WinRAR): KHÔNG chứa `statsig\`, `shell-snapshots\`, `todos\`, `logs\`, `history.jsonl`. CHỨA `settings.json`, `agents\`, `commands\`.

## Uninstall

```powershell
# Remove hook
& "C:\Program Files\claude-manager\claude-manager.exe" uninstall

# Remove app: Settings → Apps → claude-manager → Uninstall
# hoặc:
Get-Package claude-manager | Uninstall-Package

# Remove data (optional)
Remove-Item -Recurse -Force "$env:APPDATA\theanh1810\claude-manager\data"
```

## Troubleshooting

### App không catch được edit
- Verify hook: `Get-Content $env:USERPROFILE\.claude\settings.json`
- Restart Claude Code sau install
- Check log: `Get-Content "$env:APPDATA\theanh1810\claude-manager\data\logs\app.log" -Tail 50 -Wait`

### Hook chạy lỗi
- Test manual:
  ```powershell
  '{"tool_name":"Edit","tool_input":{"file_path":"C:/tmp/test.txt"},"session_id":"manual-test"}' | & "C:\Program Files\claude-manager\claude-manager.exe" hook post
  ```
- Check DB (cần SQLite CLI):
  ```powershell
  sqlite3 "$env:APPDATA\theanh1810\claude-manager\data\db.sqlite" "SELECT * FROM edits ORDER BY created_at DESC LIMIT 5;"
  ```

### Restore settings.json từ backup
```powershell
Get-ChildItem "$env:APPDATA\theanh1810\claude-manager\data\backups\"
Copy-Item "$env:APPDATA\theanh1810\claude-manager\data\backups\settings.json.<timestamp>.bak" "$env:USERPROFILE\.claude\settings.json"
```

### Build fail: `link.exe not found`
Thiếu MSVC linker. Cài lại Visual Studio Build Tools với workload C++ (Prereq §2).

### Build fail: `error: Microsoft Visual C++ 14.0 or greater is required`
Same as trên — cài Build Tools 2022 + Windows SDK.

### Build fail: WiX candle.exe / light.exe
Tauri auto-download WiX v3 vào `%USERPROFILE%\AppData\Local\tauri\WixTools\`. Nếu fail (firewall/proxy):
- Manual: tải WiX v3.11 từ https://github.com/wixtoolset/wix3/releases → extract vào `%USERPROFILE%\AppData\Local\tauri\WixTools\`.

### App không mở, error "WebView2 not found"
Cài WebView2 Runtime (Prereq §4).

### SmartScreen block khi mở installer
App chưa code-sign. Click **More info** → **Run anyway**. Long-term: cần Authenticode cert để ký MSI.

### Antivirus flag `.exe`
Windows Defender / third-party AV có thể quarantine binary chưa ký. Thêm exception cho `C:\Program Files\claude-manager\` hoặc ký binary.

## Known Limitations (Phase-1)

- **PreToolUse hook chưa có** → reject edit cho file đã tồn tại không restore được (before_blob = None).
- **Interactive mode** chưa block thực sự — UI có settings nhưng hook chỉ chạy post phase.
- **Hybrid path rules** chưa apply trong hook logic.
- **Cross-platform testing**: build Windows chưa được QA trên CI. Test flow trên Win10 22H2 + Win11 23H2.
- **Autostart** chưa wire — phải manual mở từ Start Menu.
- **Code signing** chưa có → SmartScreen + AV warnings expected trên máy lần đầu.
- **Path separator**: một số path hardcoded `/` có thể lỗi trên Windows — báo issue kèm log nếu gặp.

## Path reference

| Purpose | macOS | Windows |
|---|---|---|
| App binary | `/Applications/claude-manager.app/Contents/MacOS/claude-manager` | `C:\Program Files\claude-manager\claude-manager.exe` |
| App data | `~/Library/Application Support/io.github.theanh1810.claude-manager/` | `%APPDATA%\theanh1810\claude-manager\data\` |
| Claude settings | `~/.claude/settings.json` | `%USERPROFILE%\.claude\settings.json` |
| Backups | `~/Library/…/backups/` | `%APPDATA%\theanh1810\claude-manager\data\backups\` |
| Logs | `~/Library/…/logs/app.log` | `%APPDATA%\theanh1810\claude-manager\data\logs\app.log` |
| DB | `~/Library/…/db.sqlite` | `%APPDATA%\theanh1810\claude-manager\data\db.sqlite` |
