# Install + E2E Test Guide — claude-manager

## Prerequisites
- macOS arm64 (Phase-1 target)
- Claude Code đã cài
- Anthropic API key (cho Explain feature) — optional

## Build từ source

```bash
source "$HOME/.cargo/env"
# chạy từ thư mục gốc của bản clone
pnpm install --ignore-scripts
pnpm tauri build
```

Output: `src-tauri/target/release/bundle/`
- `dmg/claude-manager_0.1.0_aarch64.dmg`
- `macos/claude-manager.app`

## Install steps

### 1. Stop dev server nếu đang chạy
```bash
# Trong terminal đang chạy pnpm tauri dev, nhấn Ctrl+C
```

### 2. Install app vào /Applications
```bash
# chạy từ thư mục gốc của bản clone
cp -r src-tauri/target/release/bundle/macos/claude-manager.app /Applications/
```

### 3. Mở app lần đầu
```bash
open /Applications/claude-manager.app
```

App khởi tạo `~/Library/Application Support/io.github.theanh1810.claude-manager/`:
- `db.sqlite`
- `blobs/`
- `logs/`

#### Nâng cấp từ bản build dùng identifier trước đó
Tên thư mục dữ liệu đã đổi. Để giữ lịch sử, trước lần mở đầu tiên của bản mới, đổi tên thư mục cũ trong `~/Library/Application Support/` thành `io.github.theanh1810.claude-manager`. Không đổi tên thì app tạo thư mục dữ liệu mới, trống; thư mục cũ vẫn còn nguyên trên đĩa. Cài đặt giao diện do webview lưu (project đang chọn, chế độ sidebar, chế độ xem diff) bị đặt lại sau khi đổi identifier, và đổi tên thư mục dữ liệu không mang chúng sang. Nếu bản cũ từng bật "launch at login", hãy kiểm tra lại mục này sau khi nâng cấp, vì login item có thể vẫn còn đăng ký trong khi app hiển thị là tắt.

### 4. Gỡ hook cũ (chỉ khi máy từng cài)
```bash
/Applications/claude-manager.app/Contents/MacOS/claude-manager uninstall
```

Lệnh này gỡ mọi entry mang marker `claude-manager:managed-hook` khỏi `~/.claude/settings.json`, sau khi lưu bản sao `settings.json.claude-manager-bak.<timestamp>` cạnh file. Hook của bạn không mang marker được giữ nguyên. App không còn tự cài hook vào Claude Code.

## E2E Test Checklist

### Test 1: Capture flow
```bash
# Terminal 1: Mở app
open /Applications/claude-manager.app

# Terminal 2: Start Claude Code trong thư mục test
cd /tmp && mkdir -p claude-mgr-test && cd claude-mgr-test
echo "hello" > demo.txt
claude
```

Trong Claude prompt: `Edit demo.txt thêm dòng "world"`

**Expected**:
- Claude edit file
- App nhận edit event trong <1s
- Sidebar hiển thị edit mới ở top
- Status `pending`
- Path `/tmp/claude-mgr-test/demo.txt`

### Test 2: Diff view
- Click edit trong sidebar
- Expected: Monaco diff hiển thị before/after side-by-side
- Header hiển thị: file path, time, tool, +/- line counts

### Test 3: Accept
- Click **Accept**
- Expected: status đổi `accepted`, button disable
- File `demo.txt` giữ nội dung Claude đã edit

### Test 4: Reject (cho edit khác)
- Tạo edit mới: `echo "v1" > test2.txt; claude` → edit test2.txt thành "v2"
- Trong app: click edit, click **Reject**
- Expected: file restore nội dung trước edit (nếu before_blob captured), status `rejected`

### Test 5: Rollback
- Edit đã Accept → click **Rollback**
- Confirm dialog → OK
- Expected: file restore về before_blob, edit row mới với status `rolled_back`

### Test 6: Explain
- Vào Cài đặt → nhập Anthropic API key → Đóng
- Click edit → click **Giải thích**
- Expected: panel mở dưới, hiện text giải thích Vietnamese từ Claude API

### Test 7: Pause / Resume
- Click **Pause** trên header
- Tạo edit mới qua Claude
- Expected: app KHÔNG capture (hook đọc paused flag, no-op)
- Click **Resume**, edit mới sẽ được capture

### Test 8: Mode switch
- Settings → chọn Interactive
- Expected: status bar đổi icon mode
- (Phase 2 feature: actual gate behavior — TBD)

### Test 9: Realtime update
- App mở
- Trigger edit từ Claude
- Expected: list refresh sau ~200ms (debounced) không cần manual reload

### Test 10: Persistence
- Đóng app
- Tạo edit qua Claude
- Mở lại app
- Expected: edit mới hiện trong list (DB persist)

## Uninstall

```bash
# Remove an old claude-manager hook (marked entries only; a backup stays beside settings.json)
/Applications/claude-manager.app/Contents/MacOS/claude-manager uninstall

# Remove app
rm -rf /Applications/claude-manager.app

# Remove data (optional)
rm -rf "$HOME/Library/Application Support/io.github.theanh1810.claude-manager"
```

## Troubleshooting

### App không catch được edit
- Kiểm tra `~/.claude/settings.json` không còn hook cũ: `grep claude-manager:managed-hook ~/.claude/settings.json` (còn thì chạy `claude-manager uninstall`)
- Khởi động lại Claude Code sau khi gỡ hook cũ
- Check log: `tail -f ~/Library/Application Support/io.github.theanh1810.claude-manager/logs/app.log`

### Hook chạy lỗi
- Test manual: lệnh `hook` chỉ đọc hết stdin rồi thoát 0, không mở app và không ghi gì:
  ```bash
  echo '{}' | /Applications/claude-manager.app/Contents/MacOS/claude-manager hook post; echo $?
  ```
- Check DB: `sqlite3 ~/Library/Application\ Support/io.github.theanh1810.claude-manager/db.sqlite "SELECT * FROM edits ORDER BY created_at DESC LIMIT 5;"`

### Restore settings.json từ backup
```bash
ls ~/Library/Application\ Support/io.github.theanh1810.claude-manager/backups/
cp ~/Library/Application\ Support/io.github.theanh1810.claude-manager/backups/settings.json.<timestamp>.bak ~/.claude/settings.json
```

## Known Limitations (Phase-1)

- **PreToolUse hook chưa có** → reject edit cho file đã tồn tại sẽ không restore được nội dung cũ (before_blob = None). Chỉ accept/rollback cho edit có before captured.
- **Interactive mode** chưa block thực sự — UI có settings nhưng hook chỉ chạy post phase.
- **Hybrid path rules** chưa apply trong hook logic.
- **Cross-platform** chỉ test trên macOS arm64. Windows/Linux cần build trên OS đó.
- **Autostart** chưa wire — phải manual `open /Applications/claude-manager.app`.
