# 任务产物说明（自动生成）

> 本文件由系统自动生成，说明任务目录内各产物的含义、格式与可修改性。
> 修改产物后可通过网页操作或直接覆盖同名文件；修改 JSON / 文本 / SRT
> 后需重新生成受影响的下游步骤（见各产物的「说明」）。

## 任务信息

- 任务 ID：`f1d91a8dc104`
- 任务类型：`anchor`
- 任务状态：`completed`
- 工作目录：`/home/runner/workspace/artifacts/studio-avatar/agnes-engine/.working_dir/20260926_102604_f1d91a8dc104`

## 产物清单

| 文件（相对路径） | 类型 | 说明 |
|---|---|---|
| — `anchor.png` | image | 数字人形象 PNG。可替换后影响数字人视频。 |
| ✅ `prompts.json` | json | 数字人视频 prompt JSON（prompts.json）。 |
| ✅ `clip/clip.mp4` | video | 数字人循环视频 MP4。 |

## 目录文件树

```
clip/clip.mp4
clip/curl.sh
clip/task.json
final_video.mp4
prompts.json
```

## 协作提示

- 文本 / JSON / SRT 产物可直接用编辑器或外部 AI Agent（如 TraeWork、opencode、workbuddy）修改。
- 图片 / 视频产物可用 ffmpeg、Python 等外部工具处理后覆盖同名文件。
- 产物字段说明见 `docs/dev/artifact_standard.md`。
