"""core.pipelines.anchor_video -- 数字人口播流水线（类型 4）

Agnes 只生成无声视觉片段；ElevenLabs 生成旁白，最后由 FFmpeg/MoviePy
将音频与画面合成。

v4.0 重构：继承 MultiScenePipeline，复用模板方法 run() 与步骤编排。
锚点形象图生成放入 _build_reference_images，clip prompt 生成放入 _build_scenes，
视频/音频/字幕/合成按模式覆写。
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
from typing import Callable, Optional

from core.api.agnes_image import AgnesImageAPI
from core.api.agnes_video import AgnesVideoAPI, VideoTaskCancelled
from core.audio.tts import ElevenLabsTTSEngine
from core.compositor.concatenator import VideoConcatenator
from core.compositor.ffmpeg_tool import resolve_binary
from core.config import DEFAULT_TEXT_MODEL
from core.pipelines import MultiScenePipeline
from core.screenwriter import Screenwriter
from models.task import (
    AnchorVideoTask,
    SceneTask,
    StepStatus,
)
from utils.video import validate_video_file

logger = logging.getLogger(__name__)

# 单片段重试间隔基数（秒）：delay = 基数 * (attempt + 1)
_CLIP_RETRY_INTERVAL_BASE_SECONDS = 15

# Agnes v2.0 needs one reference image and 361 frames at 24 fps for a
# reliable 15-second image-to-video clip. The final post-stitch step can loop
# this clip to match the spoken audio duration.
_ANCHOR_CLIP_DURATION_SECONDS = 15

# 主播形象生成阶段起始进度
_PROGRESS_ANCHOR_IMAGE = 0.02

# 数字人流水线进度映射（阶段内固定值；保持原有行为不变）
_PROGRESS_ANCHOR_IMAGE_DONE = 0.08
_PROGRESS_CLIP_PROMPTS_START = 0.12
_PROGRESS_CLIP_PROMPTS_DONE = 0.18
_PROGRESS_CLIP_GEN_START = 0.28
_PROGRESS_CLIP_GEN_DONE = 0.55
_PROGRESS_AUDIO_START = 0.55
# 注意：post_stitch 音频完成态回退 0.28（历史行为，保持不变）
_PROGRESS_AUDIO_DONE = 0.28
_PROGRESS_SUBTITLE_START = 0.65
_PROGRESS_SUBTITLE_DONE = 0.75
_PROGRESS_CONCAT_START = 0.80

_DEFAULT_ANCHOR_PROMPT_ZH = (
    "一位专业的新闻主播，穿着正式西装，坐在现代化的新闻演播室中，"
    "面带微笑，正面半身照，高清画质，专业灯光"
)

_DEFAULT_ANCHOR_PROMPT_EN = (
    "A professional news anchor in formal business attire, seated in a modern "
    "news studio, smiling warmly, front-facing half-body shot, high definition, "
    "professional studio lighting"
)

_SENTENCE_END_RE = re.compile(r"(?<=[。！？])")
_CHARS_PER_SEC = 4.0


class AnchorPipeline(MultiScenePipeline):
    """数字人口播视频生成流水线。

    生成一段短 i2v 视频 → 循环播放 → ElevenLabs TTS + 字幕叠加。
    """

    def __init__(
        self,
        api_key: str,
        task_id: str,
        dir_name: Optional[str] = None,
        chat_model: str = DEFAULT_TEXT_MODEL,
        image_model: str = "agnes-image-2.5-flash",
        video_model: str = "agnes-video-v2.0",
        progress_callback: Optional[Callable] = None,
        shutdown_event: Optional[asyncio.Event] = None,
    ):
        super().__init__(api_key, task_id, dir_name, progress_callback, shutdown_event)
        self.image_generator = AgnesImageAPI(api_key=api_key, model=image_model)
        self.video_generator = AgnesVideoAPI(api_key=api_key, model=video_model)
        self.video_generator.shutdown_event = shutdown_event
        self.screenwriter = Screenwriter(api_key=api_key, model=chat_model)
        self._state: Optional[AnchorVideoTask] = None

    @property
    def state(self) -> Optional[AnchorVideoTask]:
        return self._state

    # ------------------------------------------------------------------
    # 模板钩子
    # ------------------------------------------------------------------

    def _get_watermark_language_text(self) -> str:
        return self._state.script_text

    def _get_default_anchor_prompt(self) -> str:
        """根据 script_text 语言返回合适的主播默认描述。"""
        text = (self._state.script_text or "").strip()
        if re.search(r'[\u4e00-\u9fff]', text):
            return _DEFAULT_ANCHOR_PROMPT_ZH
        return _DEFAULT_ANCHOR_PROMPT_EN

    # ------------------------------------------------------------------
    # 数据来源：参考图（主播形象）
    # ------------------------------------------------------------------

    async def _build_reference_images(self) -> None:
        """Step: 保留用户上传的主播原图，或在没有原图时生成形象图。"""
        prompt = self._state.anchor_prompt or self._get_default_anchor_prompt()
        output_path = os.path.join(self.working_dir, "anchor.png")
        ref_image = self._state.anchor_reference_image

        # The uploaded portrait is the source of truth for identity. Do not
        # run an i2i pass here: it can alter the mascot/person before the
        # video API receives it. The API route keeps this file available for
        # the lifetime of the task.
        if ref_image and os.path.isfile(ref_image):
            self._state.anchor_image_path = ref_image
            self.task_manager.update_state(anchor_image_path=ref_image)
            await self._emit(
                "generate_anchor",
                "completed",
                "已保留原始主播图片作为视频参考",
                _PROGRESS_ANCHOR_IMAGE_DONE,
            )
            logger.info("[Anchor] using uploaded portrait as the primary reference")
            return

        if os.path.isfile(output_path):
            self._state.anchor_image_path = output_path
            logger.info("[Anchor] anchor image already exists, skipping")
            return

        size = f"{self._state.video_width}x{self._state.video_height}"

        await self._emit(
            "generate_anchor", "running",
            "生成主播形象图..." if not ref_image else "基于参考图生成主播形象...",
            _PROGRESS_ANCHOR_IMAGE,
        )

        try:
            if ref_image and os.path.exists(ref_image):
                img_output = await self.image_generator.generate_single_image(
                    prompt=prompt,
                    reference_image_paths=[ref_image],
                    size=size,
                )
            else:
                img_output = await self.image_generator.generate_single_image(
                    prompt=prompt,
                    size=size,
                )
            await img_output.save(output_path)
        except Exception as e:
            logger.error(f"[Anchor] Anchor image generation failed: {e}")
            raise RuntimeError(f"主播形象生成失败: {e}")

        self._state.anchor_image_path = output_path
        self.task_manager.update_state(anchor_image_path=output_path)
        await self._emit("generate_anchor", "completed", "主播形象生成完成", _PROGRESS_ANCHOR_IMAGE_DONE)

    # ------------------------------------------------------------------
    # 数据来源：分镜（单段 clip 的 prompt）
    # ------------------------------------------------------------------

    async def _build_scenes(self) -> None:
        """构建单段场景：生成循环优化 / 含口播的视频 prompt。

        v6.1 断点续传：场景 prompt 已生成（scenes 已填充）→ 直接复用，
        避免恢复执行（暂停点继续 / resume）重复调用 LLM。
        """
        if self._state.scenes and self._state.scenes[0].scene_prompt:
            logger.info("[Anchor] _build_scenes: SKIP (scene prompt already exists)")
            return
        audio_source = "post_stitch"
        anchor_prompt = self._state.anchor_prompt or self._get_default_anchor_prompt()

        await self._emit(
            "clip_prompts", "running",
            "生成循环优化动态描述..." if audio_source == "post_stitch"
            else "生成含口播的视频描述...", _PROGRESS_CLIP_PROMPTS_START,
        )

        prompt = await asyncio.to_thread(
            self.screenwriter.generate_anchor_smooth_loop_prompt,
            anchor_prompt=anchor_prompt,
        )
        prompt = prompt.strip()
        self.save_prompts({
            "anchor_prompt": anchor_prompt,
            "smooth_loop_prompt": prompt,
        })

        scene_count = max(1, min(3, int(self._state.scene_count or 1)))
        scene_duration = max(1, round(int(self._state.video_duration or 15) / scene_count))
        camera_variants = [
            "Use a centered medium shot with gentle natural hand movement.",
            "Use a slightly tighter angle with a subtle lateral camera drift.",
            "Use a wider composition with a restrained push-in toward the avatar.",
        ]
        self._state.scenes = [
            SceneTask(
                index=index,
                scene_prompt=f"{prompt}\n{camera_variants[index]}",
                duration=scene_duration,
            )
            for index in range(scene_count)
        ]
        self.task_manager.update_state(scenes=[s.model_dump() for s in self._state.scenes])
        await self._emit(
            "clip_prompts",
            "completed",
            f"{scene_count} 个分镜描述生成完成",
            _PROGRESS_CLIP_PROMPTS_DONE,
        )

    # ------------------------------------------------------------------
    # 视频生成（单段 i2v/keyframes 循环，覆写通用实现）
    # ------------------------------------------------------------------

    async def _generate_videos(self) -> None:
        """为每个分镜生成一个 15 秒视频片段，再在最终合成阶段按目标时长编排。"""
        anchor_image_path = self._state.anchor_image_path
        if not anchor_image_path or not os.path.isfile(anchor_image_path):
            raise RuntimeError("主播原始图片不可用，无法提交 Image-to-Video 请求")
        self.task_manager.update_step("step_clip_generation", StepStatus.RUNNING)
        total_scenes = len(self._state.scenes)
        await self._emit(
            "clip_gen",
            "running",
            f"生成 {total_scenes} 个分镜视频...",
            _PROGRESS_CLIP_GEN_START,
        )

        vw = self._state.video_width
        vh = self._state.video_height

        for scene_index, scene in enumerate(self._state.scenes):
            clip_dir = os.path.join(self.working_dir, f"clip_{scene_index + 1}")
            os.makedirs(clip_dir, exist_ok=True)
            clip_path = os.path.join(clip_dir, "clip.mp4")

            if os.path.exists(clip_path):
                try:
                    validate_video_file(clip_path)
                except Exception as exc:
                    logger.warning("[Anchor] invalid cached scene clip will be regenerated: %s", exc)
                    try:
                        os.remove(clip_path)
                    except OSError:
                        pass
                else:
                    scene.video_file = clip_path
                    logger.info("[Anchor] scene %d clip already exists, skipping", scene_index + 1)
                    continue

            saved_video_id = self._load_task_json(clip_dir)
            if saved_video_id:
                video_id = saved_video_id
            else:
                background_path = (
                    self._state.scene_reference_images[scene_index]
                    if scene_index < len(self._state.scene_reference_images)
                    and os.path.isfile(self._state.scene_reference_images[scene_index])
                    else ""
                )
                reference_images = [anchor_image_path]
                prompt = scene.scene_prompt
                if background_path:
                    reference_images.append(background_path)
                    prompt = (
                        f"{prompt}\n"
                        "Use the second reference image as this scene's background "
                        "and environment. Keep the avatar identity, face, and mascot "
                        "appearance from the first reference image; do not replace "
                        "the avatar with the background subject."
                    )
                    logger.info("[Anchor] scene %d uses one background reference", scene_index + 1)
                else:
                    logger.info("[Anchor] scene %d uses the portrait as its sole ti2vid reference", scene_index + 1)
                video_id = await self.video_generator.submit_video(
                    prompt=prompt,
                    reference_image_paths=reference_images,
                    duration=_ANCHOR_CLIP_DURATION_SECONDS,
                    width=vw,
                    height=vh,
                )
                self._save_task_json(clip_dir, {"video_id": video_id})

            for attempt in range(3):
                try:
                    video_output = await self.video_generator.wait_for_video(video_id)
                    await video_output.save(clip_path)
                    validate_video_file(clip_path)
                    break
                except VideoTaskCancelled:
                    raise
                except Exception as e:
                    if attempt < 2:
                        logger.warning(
                            "[Anchor] scene %d attempt %d failed: %s, retrying...",
                            scene_index + 1, attempt + 1, e,
                        )
                        await asyncio.sleep(_CLIP_RETRY_INTERVAL_BASE_SECONDS * (attempt + 1))
                    else:
                        raise

            scene.video_file = clip_path
            self.task_manager.update_state(scenes=[s.model_dump() for s in self._state.scenes])

        self.task_manager.update_step("step_clip_generation", StepStatus.COMPLETED)
        await self._emit("clip_gen", "completed", "分镜视频生成完成", _PROGRESS_CLIP_GEN_DONE)

    # ------------------------------------------------------------------
    # 音频生成（覆写通用实现）
    # ------------------------------------------------------------------

    def _get_pausable_steps(self) -> set:
        from core.pipelines import _STEP_TO_CHECKPOINT

        return set(_STEP_TO_CHECKPOINT.keys())

    async def _generate_audio(self) -> object:
        """使用 ElevenLabs 生成整段法语/多语言旁白，不调用 Agnes 音频。"""
        full_text = self._state.script_text
        if not full_text:
            raise RuntimeError("Le texte de la voix off est vide.")

        audio_path = os.path.join(self.working_dir, "full_narration.mp3")
        audio_metadata_path = audio_path + ".provider.json"
        audio_config = self._state.audio_config
        requested_voice = "mascot-auto"
        voice_direction = getattr(self._state, "mascot_voice_direction", "") or ""
        voice_description = ElevenLabsTTSEngine.build_mascot_voice_description(
            anchor_prompt=self._state.anchor_prompt or self._get_default_anchor_prompt(),
            script_text=full_text,
            voice_direction=voice_direction,
        )
        voice_fingerprint = hashlib.sha256(voice_description.encode("utf-8")).hexdigest()
        audio_fingerprint = hashlib.sha256(full_text.encode("utf-8")).hexdigest()
        # v5.x 产物规范前置：导出读稿纯文本（供外部 Agent/工具处理）
        self._save_narration_txt(full_text, audio_path)

        if os.path.exists(audio_path) and os.path.getsize(audio_path) > 0:
            try:
                with open(audio_metadata_path, "r", encoding="utf-8") as metadata_file:
                    metadata = json.load(metadata_file)
            except (OSError, ValueError):
                metadata = {}
            if (
                metadata.get("provider") == "elevenlabs"
                and metadata.get("model") == "eleven_multilingual_v2"
                and metadata.get("voice") == requested_voice
                and metadata.get("text_sha256") == audio_fingerprint
                and metadata.get("voice_description_sha256") == voice_fingerprint
            ):
                self._state.combined_audio = audio_path
                logger.info("[Anchor] ElevenLabs audio already exists, skipping")
                return self._load_cues_cache(audio_path)
            logger.info("[Anchor] invalid or legacy audio cache will be regenerated with ElevenLabs")
            for stale_path in (audio_path, audio_path + ".cues.json", audio_metadata_path):
                try:
                    os.remove(stale_path)
                except OSError:
                    pass

        await self._emit("audio", "running", f"生成整段读稿 ({len(full_text)} 字)...", _PROGRESS_AUDIO_START)

        try:
            elevenlabs = ElevenLabsTTSEngine()
            mascot_voice_id = await elevenlabs.design_mascot_voice(
                voice_description=voice_description,
                sample_text=full_text,
                voice_name="Atelier Mascotte",
            )
            _, sub_maker = await ElevenLabsTTSEngine().generate(
                text=full_text,
                output_path=audio_path,
                voice=mascot_voice_id,
                rate=getattr(audio_config, "rate", "+0%"),
            )
        except RuntimeError as exc:
            logger.error("[Anchor] ElevenLabs voice generation failed: %s", exc)
            raise RuntimeError(f"Échec de la voix off ElevenLabs : {exc}") from exc

        self._state.combined_audio = audio_path
        self.task_manager.update_state(combined_audio=audio_path)
        self._save_cues_cache(audio_path, sub_maker)
        try:
            with open(audio_metadata_path, "w", encoding="utf-8") as metadata_file:
                json.dump(
                    {
                        "provider": "elevenlabs",
                        "model": "eleven_multilingual_v2",
                        "voice": requested_voice,
                        "voice_id": mascot_voice_id,
                        "text_sha256": audio_fingerprint,
                        "voice_description_sha256": voice_fingerprint,
                    },
                    metadata_file,
                    ensure_ascii=False,
                    indent=2,
                )
        except OSError as exc:
            logger.warning("[Anchor] failed to save audio provider metadata: %s", exc)
        await self._emit("audio", "completed", "读稿音频生成完成", _PROGRESS_AUDIO_DONE)
        return sub_maker

    # ------------------------------------------------------------------
    # 字幕生成（覆写通用实现）
    # ------------------------------------------------------------------

    async def _generate_subtitles(self, sub_maker: object = None) -> None:
        """根据 ElevenLabs 对齐信息生成整段 SRT 字幕。"""
        full_text = self._state.script_text
        if not full_text:
            logger.warning("[Anchor] subtitle: empty text, skipping")
            return

        subtitle_config = self._state.subtitle_config
        audio_duration = max(len(full_text) / _CHARS_PER_SEC, 2.0)
        segment_texts = [full_text]
        segment_durations = [audio_duration]

        await self._emit("subtitle", "running", f"生成整段字幕 ({len(full_text)} 字)...", _PROGRESS_SUBTITLE_START)

        srt_path, styles_path = await self.generate_subtitles_common(
            segment_texts=segment_texts,
            segment_durations=segment_durations,
            subtitle_config=subtitle_config,
            sub_maker=sub_maker,
            audio_path=self._state.combined_audio or "",
            screenwriter=self.screenwriter,
            video_width=self._state.video_width,
            video_height=self._state.video_height,
            role="anchorperson digital human",
        )

        if styles_path:
            self._state.subtitle_styles_path = styles_path
            self.task_manager.update_state(subtitle_styles_path=styles_path)

        self._state.combined_subtitle = srt_path
        self.task_manager.update_state(combined_subtitle=srt_path)
        await self._emit("subtitle", "completed", "字幕生成完成", _PROGRESS_SUBTITLE_DONE)

    # ------------------------------------------------------------------
    # 合成（覆写通用实现）
    # ------------------------------------------------------------------

    @staticmethod
    def _trim_scene_clip(source_path: str, output_path: str, duration: float) -> None:
        """Trim one generated scene without re-encoding before concatenation."""
        subprocess.run(
            [
                resolve_binary("ffmpeg"), "-y", "-i", source_path,
                "-t", f"{duration:.3f}", "-reset_timestamps", "1",
                "-c", "copy", output_path,
            ],
            stdin=subprocess.DEVNULL,
            check=True,
            capture_output=True,
            timeout=300,
        )

    def _build_scene_reel(self, output_path: str) -> str:
        """Arrange all requested scenes into the selected final duration.

        Agnes always renders reliable 15-second source clips. Shorter targets
        use every requested scene once and trim each segment; longer targets
        cycle through the distinct scenes until the target is covered.
        """
        target_duration = max(15, int(self._state.video_duration or 15))
        scene_paths = [
            scene.video_file
            for scene in self._state.scenes
            if scene.video_file and os.path.isfile(scene.video_file)
        ]
        if not scene_paths:
            raise RuntimeError("Aucun plan vidéo n’a été généré.")

        if os.path.exists(output_path):
            try:
                validate_video_file(output_path)
                return output_path
            except Exception:
                try:
                    os.remove(output_path)
                except OSError:
                    pass

        scene_count = len(scene_paths)
        segments: list[tuple[str, float]] = []
        if target_duration <= scene_count * _ANCHOR_CLIP_DURATION_SECONDS:
            segment_duration = target_duration / scene_count
            segments = [(path, segment_duration) for path in scene_paths]
        else:
            remaining = float(target_duration)
            index = 0
            while remaining > 0.01:
                duration = min(float(_ANCHOR_CLIP_DURATION_SECONDS), remaining)
                segments.append((scene_paths[index % scene_count], duration))
                remaining -= duration
                index += 1

        temporary_paths: list[str] = []
        try:
            for index, (source_path, duration) in enumerate(segments):
                segment_path = os.path.join(
                    self.working_dir, f"_scene_reel_segment_{index + 1}.mp4"
                )
                self._trim_scene_clip(source_path, segment_path, duration)
                temporary_paths.append(segment_path)
            VideoConcatenator.concat_videos(temporary_paths, output_path)
            normalized_path = f"{output_path}.normalized.mp4"
            subprocess.run(
                [
                    resolve_binary("ffmpeg"), "-y", "-i", output_path,
                    "-t", f"{target_duration:.3f}",
                    "-c:v", "libx264", "-preset", "fast",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                    normalized_path,
                ],
                stdin=subprocess.DEVNULL,
                check=True,
                capture_output=True,
                timeout=300,
            )
            os.replace(normalized_path, output_path)
            validate_video_file(output_path)
            return output_path
        finally:
            for path in temporary_paths:
                try:
                    os.remove(path)
                except OSError:
                    pass
            normalized_path = f"{output_path}.normalized.mp4"
            if os.path.exists(normalized_path):
                try:
                    os.remove(normalized_path)
                except OSError:
                    pass

    async def _composite_final(self) -> str:
        """Assemble the distinct scene reel, then add audio and subtitles."""
        reel_path = os.path.join(self.working_dir, "scene_reel.mp4")
        await asyncio.to_thread(self._build_scene_reel, reel_path)
        target_duration = max(15, int(self._state.video_duration or 15))

        output_path = os.path.join(self.working_dir, "final_video.mp4")
        if os.path.exists(output_path):
            try:
                validate_video_file(output_path)
            except Exception as exc:
                logger.warning("[Anchor] invalid cached final video will be recomposed: %s", exc)
                try:
                    os.remove(output_path)
                except OSError:
                    pass
            else:
                logger.info("[Anchor] composite: final video already exists, skipping")
                return output_path

        audio_path = self._state.combined_audio or ""
        audio_duration = 0.0
        if audio_path and os.path.exists(audio_path):
            audio_duration = VideoConcatenator._get_duration(audio_path)

        has_subtitle = (
            self._state.subtitle_config.enabled
            and bool(self._state.combined_subtitle)
        )

        await self._emit("concatenate", "running", "拼接分镜、音频与字幕...", _PROGRESS_CONCAT_START)

        await asyncio.to_thread(
            VideoConcatenator.composite_anchor_video,
            clip_path=reel_path,
            audio_path=audio_path,
            srt_path=self._state.combined_subtitle if has_subtitle else None,
            output_path=output_path,
            audio_duration=audio_duration,
            target_duration=target_duration,
            subtitle_style=self._state.subtitle_config.style if has_subtitle else None,
            subtitle_styles_path=self._state.subtitle_styles_path or None,
            video_width=self._state.video_width,
            video_height=self._state.video_height,
        )

        logger.info("[Anchor] composite: final video → %s", output_path)
        return output_path
