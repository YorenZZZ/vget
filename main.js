const { app, BrowserWindow, ipcMain, clipboard, shell, dialog, nativeImage } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

const BASE = __dirname
const USER_DATA = app.getPath('userData') // ~/Library/Application Support/vget（可写）
const CONFIG_FILE = path.join(USER_DATA, 'config.json')
const DEFAULT_OUTDIR = path.join(os.homedir(), 'Downloads')
// 默认 cookies 位置：~/Library/Application Support/vget/cookies.txt（可在设置中修改）
const DEFAULT_COOKIES = path.join(USER_DATA, 'cookies.txt')

const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const UA_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

let mainWindow = null

// ---------- 配置 ----------
function loadConfig() {
  try {
    return { outdir: DEFAULT_OUTDIR, cookies: DEFAULT_COOKIES, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }
  } catch {
    return { outdir: DEFAULT_OUTDIR, cookies: DEFAULT_COOKIES }
  }
}
function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)) } catch { /* 写入失败时忽略，下次仍用默认配置 */ }
}

// yt-dlp 路径：优先 Homebrew（Apple Silicon / Intel），否则走 PATH
function ytdlpBin() {
  for (const p of ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp']) {
    if (fs.existsSync(p)) return p
  }
  return 'yt-dlp'
}

// ---------- URL 提取（从分享文案解析） ----------
const _TAIL = String.raw`[^\s\u4e00-\u9fff，。；：！？、""''（）【】《》〈〉,.!?;:)]`
const URL_PATTERNS = [
  String.raw`https?://(?:v\.douyin\.com|www\.douyin\.com|www\.iesdouyin\.com|m\.douyin\.com)/` + _TAIL + '+',
  String.raw`https?://(?:www\.)?tiktok\.com/` + _TAIL + '+',
  String.raw`https?://(?:vm|vt)\.tiktok\.com/` + _TAIL + '+',
  String.raw`https?://(?:www\.)?bilibili\.com/` + _TAIL + '+',
  String.raw`https?://b23\.tv/` + _TAIL + '+',
  String.raw`https?://(?:www\.)?youtube\.com/` + _TAIL + '+',
  String.raw`https?://youtu\.be/` + _TAIL + '+',
]

function extractUrl(text) {
  if (!text) return null
  text = text.trim()
  for (const p of URL_PATTERNS) {
    const m = text.match(new RegExp(p, 'i'))
    if (m) return m[0].replace(/[，。；：""''（）【】,.!?;:)]+$/, '')
  }
  const m = text.match(/https?:\/\/[^\s]+/)
  if (m) return m[0].replace(/[，。；：""''（）【】,.!?;:)]+$/, '')
  return null
}

function detectPlatform(url) {
  const u = (url || '').toLowerCase()
  if (u.includes('douyin.com') || u.includes('iesdouyin.com')) return 'douyin'
  if (u.includes('tiktok.com')) return 'tiktok'
  if (u.includes('bilibili.com') || u.includes('b23.tv')) return 'bilibili'
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube'
  return 'other'
}

// ---------- 抖音解析 ----------
async function resolveRedirect(url) {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA_WEB } })
    return r.url
  } catch { return url }
}

async function douyinVideoId(url) {
  let m = url.match(/\/(?:video|note|share\/video|share\/note)\/(\d+)/)
  if (m) return m[1]
  const final = await resolveRedirect(url)
  m = final.match(/\/(?:video|note)\/(\d+)/)
  return m ? m[1] : null
}

async function resolveDouyin(videoId) {
  const nodes = [
    `https://api5-normal-c-hl.amemv.com/aweme/v1/feed/?aweme_id=${videoId}&aid=1128`,
    `https://aweme.snssdk.com/aweme/v1/feed/?aweme_id=${videoId}&aid=1128`,
  ]
  for (const node of nodes) {
    try {
      const r = await fetch(node, { headers: { 'User-Agent': UA_APP } })
      const j = await r.json()
      const items = j.aweme_list || []
      for (const a of items) if (String(a.aweme_id) === String(videoId)) return a
      if (items.length) return items[0]
    } catch { /* 当前节点失败，尝试下一个 */ }
  }
  return null
}

function pickDouyinUrl(aweme) {
  const v = aweme.video || {}
  const pa = v.play_addr || {}
  const url = pa.url_list || []
  if (url[0]) return url[0]
  const brs = v.bit_rate || []
  if (brs.length) {
    const best = brs.slice().sort((a, b) => ((b.is_h265 ? 0 : 1) - (a.is_h265 ? 0 : 1)) || ((b.bit_rate || 0) - (a.bit_rate || 0)))[0]
    const u = (best.play_addr || {}).url_list || []
    if (u[0]) return u[0]
  }
  return null
}

function sanitize(name) {
  return (name || '').replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/^[ ._]+|[ ._]+$/g, '').slice(0, 80) || 'video'
}

// ---------- 下载任务 ----------
function emit(taskId, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('task:progress', { taskId, ...data })
  }
}

async function downloadDouyinTask(taskId, url, outdir) {
  emit(taskId, { status: 'parsing', progress: 0, message: '解析中...' })
  const vid = await douyinVideoId(url)
  if (!vid) throw new Error('无法从链接提取视频 ID')
  const aweme = await resolveDouyin(vid)
  if (!aweme) throw new Error('解析失败：视频可能已删除/私密，或网络异常')
  const title = sanitize(aweme.desc || vid)
  const vurl = pickDouyinUrl(aweme)
  if (!vurl) throw new Error('未找到可下载的视频地址')
  emit(taskId, { status: 'downloading', progress: 0, message: '开始下载', title })

  fs.mkdirSync(outdir, { recursive: true })
  const filePath = path.join(outdir, `${title}.mp4`)
  const r = await fetch(vurl, { headers: { 'User-Agent': UA_WEB, 'Referer': 'https://www.douyin.com/' } })
  if (!r.ok) throw new Error(`下载失败：HTTP ${r.status}`)
  const total = parseInt(r.headers.get('content-length') || '0', 10)
  const reader = r.body.getReader()
  // 边下边写，避免大文件整段驻留内存
  const fd = fs.openSync(filePath, 'w')
  let done = 0
  try {
    while (true) {
      const { value, done: finished } = await reader.read()
      if (finished) break
      fs.writeSync(fd, value)
      done += value.length
      if (total) emit(taskId, { progress: Math.min(99, Math.floor(done * 100 / total)), message: `下载中 ${(done / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)} MB` })
    }
  } finally {
    fs.closeSync(fd)
  }
  emit(taskId, { status: 'done', progress: 100, message: '完成', filePath, size: fs.statSync(filePath).size })
}

function downloadYtdlpTask(taskId, url, outdir, cookies) {
  return new Promise((resolve, reject) => {
    const ytdlp = ytdlpBin()
    fs.mkdirSync(outdir, { recursive: true })
    const args = ['--ignore-config', '--no-warnings', '--newline', '--merge-output-format', 'mp4',
      '-o', path.join(outdir, '%(title).80s.%(ext)s')]
    if (cookies && fs.existsSync(cookies)) args.push('--cookies', cookies)
    args.push(url)
    emit(taskId, { status: 'downloading', progress: 0, message: '开始下载' })
    const child = spawn(ytdlp, args)
    child.on('error', (e) => reject(new Error(`无法启动 yt-dlp（${e.message}），请先安装：brew install yt-dlp`)))
    let lastLine = ''
    child.stdout.on('data', (data) => {
      for (const line of data.toString().split('\n')) {
        const s = line.trim()
        if (!s) continue
        lastLine = s
        const m = s.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
        if (m) emit(taskId, { progress: parseFloat(m[1]), message: s.slice(0, 80) })
        else if (s.includes('Merging')) emit(taskId, { progress: 99, message: '合并音视频...' })
        else if (s.includes('Destination')) emit(taskId, { message: s.slice(0, 80) })
      }
    })
    child.on('close', (code) => {
      if (code === 0) { emit(taskId, { status: 'done', progress: 100, message: '完成' }); resolve() }
      else reject(new Error(lastLine || '下载失败'))
    })
  })
}

async function runTask(taskId, url, outdir, cookies) {
  try {
    const platform = detectPlatform(url)
    if (platform === 'douyin') await downloadDouyinTask(taskId, url, outdir)
    else await downloadYtdlpTask(taskId, url, outdir, cookies)
  } catch (e) {
    emit(taskId, { status: 'error', message: e.message || '下载失败' })
  }
}

// ---------- 窗口 ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    title: 'VGET 视频下载',
    backgroundColor: '#141218',
    webPreferences: {
      preload: path.join(BASE, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile(path.join(BASE, 'renderer', 'index.html'))
  mainWindow.on('closed', () => { mainWindow = null })
}

// ---------- IPC ----------
function registerIpcHandlers() {
  ipcMain.handle('clipboard:read', () => {
    const text = clipboard.readText()
    const url = extractUrl(text)
    return { text, url, platform: url ? detectPlatform(url) : null }
  })

  ipcMain.handle('parse', async (_e, url) => {
    const platform = detectPlatform(url)
    if (platform === 'douyin') {
      const vid = await douyinVideoId(url)
      if (vid) {
        const aweme = await resolveDouyin(vid)
        if (aweme) {
          const cover = ((aweme.video || {}).cover || {}).url_list || ['']
          return {
            platform, title: aweme.desc || vid, thumbnail: cover[0] || '',
            uploader: (aweme.author || {}).nickname || '', duration: Math.floor(((aweme.video || {}).duration || 0) / 1000),
          }
        }
      }
    }
    return new Promise((resolve) => {
      const fallback = { platform, title: url, thumbnail: '', uploader: '', duration: 0 }
      const child = spawn(ytdlpBin(), ['--ignore-config', '--no-warnings', '--dump-json', '--no-playlist', url])
      child.on('error', () => resolve(fallback))
      let out = ''
      child.stdout.on('data', (d) => { out += d.toString() })
      child.on('close', () => {
        try {
          const j = JSON.parse(out)
          resolve({ platform, title: j.title || url, thumbnail: j.thumbnail || '', uploader: j.uploader || j.channel || '', duration: j.duration || 0 })
        } catch { resolve(fallback) }
      })
    })
  })

  ipcMain.handle('download:start', (_e, url, opts) => {
    const cfg = loadConfig()
    const outdir = (opts && opts.outdir) || cfg.outdir
    const cookies = (opts && opts.cookies) || cfg.cookies
    const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    runTask(taskId, url, outdir, cookies)
    return taskId
  })

  ipcMain.handle('config:get', () => loadConfig())
  ipcMain.handle('config:set', (_e, cfg) => {
    const merged = { ...loadConfig(), ...cfg }
    saveConfig(merged)
    return merged
  })

  // 仅允许打开 http(s) 链接，防止渲染进程借此执行本地文件/自定义协议
  ipcMain.handle('shell:open', (_e, url) => {
    if (/^https?:\/\//i.test(String(url))) return shell.openExternal(url)
  })
  ipcMain.handle('dialog:selectFile', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'] })
    return r.canceled ? null : r.filePaths[0]
  })
}

// ---------- 单实例 + 生命周期 ----------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    registerIpcHandlers()
    // Dock 图标
    const iconPath = path.join(BASE, 'VGET.icns')
    if (fs.existsSync(iconPath)) {
      try { app.dock.setIcon(nativeImage.createFromPath(iconPath)) } catch { /* 非 macOS 无 dock */ }
    }
    createWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}
