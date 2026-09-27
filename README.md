<p align="center">
  <img src="icon-1024.png" width="128" alt="VGET">
</p>

<h1 align="center">VGET</h1>

<p align="center">全平台无水印视频下载工具 · 抖音 / B站 / YouTube / TikTok</p>

---

VGET 提供两种用法：

- **桌面应用**（Electron，macOS）：粘贴分享文案或读取剪贴板，一键解析、预览并下载，实时显示进度。
- **命令行脚本**（`vget.py`，纯 Python 标准库）：支持批量下载，适合脚本和自动化。

## 功能

| 平台 | 引擎 | 是否需要 cookies |
| --- | --- | --- |
| 抖音 | 内置解析，下载最高画质原视频 | 不需要 |
| B站 | [yt-dlp](https://github.com/yt-dlp/yt-dlp) | 建议提供，否则可能遇到 412 |
| YouTube | yt-dlp | 通常需要 |
| TikTok | yt-dlp | 通常需要 |

- 支持从整段分享文案中自动提取链接（如抖音「复制打开抖音，看看…」）
- 支持短链自动展开（`v.douyin.com`、`b23.tv`、`youtu.be` 等）
- 音视频自动合并为 mp4
- 其他 yt-dlp 支持的站点也可以尝试直接粘贴链接

## 环境要求

- macOS（桌面应用；命令行脚本在 Linux/Windows 上同样可用）
- [Node.js](https://nodejs.org/) 18+（桌面应用）
- Python 3.8+（命令行脚本）
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) 与 [ffmpeg](https://ffmpeg.org/)（B站/YouTube/TikTok 需要）

```bash
brew install yt-dlp ffmpeg
```

## 桌面应用

### 一键安装（推荐）

不想每次用命令行启动？执行一次下面的命令，VGET 就会像普通 App 一样出现在「应用程序」和 Dock 里，以后直接点图标打开：

```bash
curl -fsSL https://raw.githubusercontent.com/YorenZZZ/vget/main/install.sh | bash
```

已经 clone 了仓库的话，在仓库目录里执行：

```bash
bash install.sh
```

脚本会自动完成：

1. 检查依赖：缺少 Node.js / yt-dlp / ffmpeg 时通过 Homebrew 安装（没有 Homebrew 会提示你先装）
2. 下载源码（curl 方式，存放在 `~/.vget`）
3. 安装 Electron 等 npm 依赖
4. 构建 `VGET.app` 并安装到 `/Applications`（没有写权限时改装到 `~/Applications`）
5. 固定到 Dock 并打开应用

可选参数：

| 参数 / 环境变量 | 作用 |
| --- | --- |
| `--no-dock` | 不固定到 Dock |
| `--no-open` | 安装后不自动打开 |
| `VGET_INSTALL_DIR=路径` | 自定义安装目录 |
| `VGET_SRC=路径` | 自定义源码存放目录（curl 方式） |

curl 方式传参写法：

```bash
curl -fsSL https://raw.githubusercontent.com/YorenZZZ/vget/main/install.sh | bash -s -- --no-dock
```

**更新**：重新执行一次安装命令即可，会覆盖为最新版本（设置和 cookies 不受影响）。

**卸载**：在 Dock 图标上右键 →「选项」→「从程序坞中移除」，然后把「应用程序」里的 VGET 拖到废纸篓；如需彻底清理，再删除 `~/.vget` 和 `~/Library/Application Support/vget`。

### 开发运行

```bash
git clone https://github.com/YorenZZZ/vget.git
cd vget
npm install
npm start
```

改完代码后执行 `bash build.sh`，即可重新构建并覆盖安装到 `/Applications/VGET.app`（旧版本会移到 `/tmp` 而不是直接删除）。

### 使用

1. 在抖音/B站等 App 中点「分享 → 复制链接」
2. 打开 VGET，点 **读取剪贴板**（或直接把文案粘贴到输入框）
3. 点 **解析视频**，确认标题、封面、作者、时长
4. 点 **下载**，在下方任务列表查看进度；完成后会显示文件路径

右上角 **设置** 可修改：

- **输出目录**：默认 `~/Downloads`
- **Cookies 文件**：默认 `~/Library/Application Support/vget/cookies.txt`

配置保存在 `~/Library/Application Support/vget/config.json`。

## 命令行

```bash
# 单个视频
python3 vget.py "https://v.douyin.com/xxxxx/"

# 批量下载到指定目录
python3 vget.py url1 url2 url3 -o ~/Downloads

# 指定 cookies
python3 vget.py "https://www.bilibili.com/video/BVxxxx" --cookies ~/cookies.txt
```

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `urls` | 一个或多个视频链接 | — |
| `-o, --outdir` | 输出目录 | `~/Downloads` |
| `--cookies` | Netscape 格式 cookies 文件 | 脚本同目录下的 `cookies.txt` |

## 获取 cookies.txt

B站/YouTube/TikTok 通常需要登录态。任选一种方式导出 Netscape 格式的 cookies：

- 浏览器扩展，如 “Get cookies.txt LOCALLY”，在已登录的网站页面导出
- 或用 yt-dlp 直接从浏览器读取：

  ```bash
  yt-dlp --cookies-from-browser chrome --cookies cookies.txt --skip-download "https://www.youtube.com"
  ```

> ⚠️ **cookies.txt 等同于你的账号登录凭据。** 不要分享、不要提交到 Git（本仓库的 `.gitignore` 已排除它）。

## 项目结构

```
.
├── main.js            # Electron 主进程：链接提取、抖音解析、yt-dlp 调度、IPC
├── preload.js         # 通过 contextBridge 向渲染进程暴露安全 API
├── renderer/
│   └── index.html     # 界面（Material 3 深色主题）
├── vget.py            # 独立命令行版本
├── install.sh         # 一键安装：依赖 → 构建 → 应用程序 → Dock
├── build.sh           # 构建 VGET.app 并部署（开发时使用）
├── VGET.icns          # 应用图标
└── package.json
```

## 常见问题

**B站提示 HTTP 412？** 提供有效的 cookies.txt。

**提示找不到 yt-dlp？** 执行 `brew install yt-dlp`。VGET 会依次查找 `/opt/homebrew/bin`、`/usr/local/bin` 和 `PATH`。

**抖音解析失败？** 视频可能已删除或设为私密；也可能是接口临时不可用，稍后重试。

**安装时 Electron 下载很慢或失败？** 可以使用镜像后重新执行安装命令：

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
curl -fsSL https://raw.githubusercontent.com/YorenZZZ/vget/main/install.sh | bash
```

**下载的 B站/YouTube 视频没有声音或是分开的两个文件？** 安装 ffmpeg 以便 yt-dlp 合并音视频。

## 免责声明

本项目仅供学习交流和个人备份使用。请尊重内容创作者的版权，遵守各平台的用户协议及所在地法律法规，不要将下载内容用于商业用途或二次传播。因使用本工具产生的任何后果由使用者自行承担。

## 许可证

[MIT](LICENSE)
