#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
vget — 无水印原视频下载工具

支持平台：
  - 抖音   ：内置解析，获取视频信息并下载最高画质原视频
  - B站     ：yt-dlp 引擎（建议带 cookies，避免 412）
  - YouTube ：yt-dlp 引擎（需要 cookies）
  - TikTok  ：yt-dlp 引擎（需要 cookies）

用法：
  python3 vget.py <视频链接> [-o 输出目录] [--cookies cookies.txt]

示例：
  python3 vget.py "https://v.douyin.com/xxxxx/"
  python3 vget.py "https://www.bilibili.com/video/BVxxxx" --cookies ~/Downloads/cookies.txt
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request

UA_WEB = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
UA_APP = ("Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 "
          "(KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1")

# 抖音视频信息接口（按顺序尝试）
FEED_NODES = [
    "https://api5-normal-c-hl.amemv.com/aweme/v1/feed/?aweme_id={id}&aid=1128",
    "https://aweme.snssdk.com/aweme/v1/feed/?aweme_id={id}&aid=1128",
]


def http_get(url, ua=UA_WEB, headers=None, timeout=30):
    """GET 请求，返回 (bytes, final_url)"""
    req = urllib.request.Request(url, headers={"User-Agent": ua, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.geturl()


def resolve_redirect(url):
    """跟随重定向，返回最终 URL（短链展开用）"""
    try:
        _, final = http_get(url, timeout=20)
        return final
    except Exception:
        return url


def douyin_video_id(url):
    """从抖音链接提取 video/note id，短链自动展开"""
    m = re.search(r"/(?:video|note|share/video|share/note)/(\d+)", url)
    if m:
        return m.group(1)
    final = resolve_redirect(url)
    m = re.search(r"/(?:video|note)/(\d+)", final)
    if m:
        return m.group(1)
    return None


def resolve_douyin(video_id):
    """根据视频 ID 获取视频详情"""
    last_err = None
    for node in FEED_NODES:
        try:
            data, _ = http_get(node.format(id=video_id), ua=UA_APP, timeout=20)
            j = json.loads(data.decode("utf-8", errors="ignore"))
            items = j.get("aweme_list") or []
            for a in items:
                if str(a.get("aweme_id")) == str(video_id):
                    return a
            if items:
                return items[0]
        except Exception as e:
            last_err = e
            continue
    if last_err:
        print(f"[抖音] 解析失败: {last_err}", file=sys.stderr)
    return None


def pick_douyin_url(aweme):
    """选择最优直链：优先 play_addr（抖音默认推荐，码率最高、无水印、兼容性最好），兜底 bit_rate"""
    v = aweme.get("video") or {}
    # 1. play_addr 通常是最高码率的无水印版本
    pa = v.get("play_addr") or {}
    url = pa.get("url_list") or []
    if url:
        return url[0]
    # 2. 兜底 bit_rate：H.264 优先，码率越高越靠前
    brs = v.get("bit_rate") or []
    if brs:
        def rank(b):
            return (0 if b.get("is_h265") else 1, b.get("bit_rate") or 0)
        best = max(brs, key=rank)
        u = (best.get("play_addr") or {}).get("url_list") or []
        if u:
            return u[0]
    return None


def sanitize(name):
    """清理文件名非法字符"""
    s = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", name or "").strip(" ._")
    return s[:80] or "video"


def download_file(url, path, referer="https://www.douyin.com/"):
    """流式下载文件到本地"""
    req = urllib.request.Request(url, headers={"User-Agent": UA_WEB, "Referer": referer})
    with urllib.request.urlopen(req, timeout=180) as r, open(path, "wb") as f:
        shutil.copyfileobj(r, f)
    size = os.path.getsize(path)
    print(f"  下载完成: {size/1024/1024:.2f} MB")
    return path


def download_douyin(url, outdir):
    vid = douyin_video_id(url)
    if not vid:
        raise RuntimeError("无法从链接提取视频 ID，请检查链接")
    aweme = resolve_douyin(vid)
    if not aweme:
        raise RuntimeError("解析失败：视频可能已删除/私密，或网络异常")
    title = sanitize(aweme.get("desc") or vid)
    vurl = pick_douyin_url(aweme)
    if not vurl:
        raise RuntimeError("未找到可下载的视频地址")
    print(f"[抖音] {aweme.get('desc', '')[:50]}")
    path = os.path.join(outdir, f"{title}.mp4")
    download_file(vurl, path)
    print(f"[完成] {path}")
    return path


def download_ytdlp(url, outdir, cookies):
    ytdlp = shutil.which("yt-dlp") or "/opt/homebrew/bin/yt-dlp"
    if not os.path.exists(ytdlp):
        raise RuntimeError("未找到 yt-dlp，请先安装: brew install yt-dlp")
    cmd = [
        ytdlp, "--ignore-config", "--no-warnings", "--newline",
        "--merge-output-format", "mp4",
        "-o", os.path.join(outdir, "%(title).80s.%(ext)s"),
    ]
    if cookies and os.path.exists(cookies):
        cmd += ["--cookies", cookies]
    else:
        print("[提示] 未指定 cookies，部分平台可能失败（B站/YouTube 建议带 cookies）")
    cmd.append(url)
    print("[yt-dlp] 开始下载...")
    code = subprocess.call(cmd)
    if code != 0:
        raise RuntimeError(f"yt-dlp 退出码 {code}")


def detect_platform(url):
    u = url.lower()
    if any(x in u for x in ["douyin.com", "iesdouyin.com"]):
        return "douyin"
    return "ytdlp"


def main():
    ap = argparse.ArgumentParser(
        description="vget — 下载抖音/B站/YouTube/TikTok 无水印原视频",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n"
               '  python3 vget.py "https://v.douyin.com/xxxx/"\n'
               '  python3 vget.py "https://www.bilibili.com/video/BVxxxx" "https://www.youtube.com/watch?v=xxxx"\n'
               '  python3 vget.py url1 url2 url3 -o ~/Downloads   # 批量下载',
    )
    ap.add_argument("urls", nargs="+", help="视频链接（可多个，批量下载）")
    ap.add_argument("-o", "--outdir", default=os.path.expanduser("~/Downloads"),
                    help="输出目录（默认 ~/Downloads）")
    ap.add_argument("--cookies", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.txt"),
                    help="cookies.txt 路径（B站/YouTube/TikTok 用，默认工具目录下的 cookies.txt）")
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)

    ok = fail = 0
    for i, url in enumerate(args.urls, 1):
        print(f"\n[{i}/{len(args.urls)}] {url}")
        try:
            if detect_platform(url) == "douyin":
                download_douyin(url, args.outdir)
            else:
                download_ytdlp(url, args.outdir, args.cookies)
            ok += 1
        except Exception as e:
            print(f"  [失败] {e}")
            fail += 1
    print(f"\n批量完成：成功 {ok} 个，失败 {fail} 个")


if __name__ == "__main__":
    main()
