"""core.audio.tts — TTS 统一接口：ElevenLabs、EdgeTTS 与静音引擎

数字人流水线使用 ElevenLabs 生成最终旁白；EdgeTTS 保留给其他旧流水线。
"""

import asyncio
import base64
import re
import logging
import os
from abc import ABC, abstractmethod
from types import SimpleNamespace
from typing import Optional, Tuple

import edge_tts
import requests

from core.async_io import async_open

logger = logging.getLogger(__name__)


_ELEVENLABS_VOICE_IDS = {
    # ElevenLabs multilingual_v2 accepts French for these built-in voices.
    # The UI keeps its existing French voice labels; this mapping keeps the
    # client contract stable while moving synthesis to ElevenLabs.
    "fr-FR-DeniseNeural": "EXAVITQu4vr4xnSDxMaL",
    "fr-FR-HenriNeural": "pNInz6obpgDQGcFmaJgB",
    "fr-FR-EloiseNeural": "21m00Tcm4TlvDq8ikWAM",
    "fr-FR-BrigitteNeural": "MF3mGyEYCl7XYWbV9V6",
}


class TTSEngine(ABC):
    """TTS 抽象基类。"""

    @abstractmethod
    async def generate(
        self, text: str, output_path: str, voice: str = "zh-CN-XiaoxiaoNeural", rate: str = "+0%"
    ) -> Tuple[str, object]:
        """生成音频文件，返回 (audio_path, sub_maker_or_cues)。"""
        ...


class ElevenLabsTTSEngine(TTSEngine):
    """ElevenLabs multilingual French voice generation.

    The API is called only after Agnes has finished the silent visual clips.
    ``with-timestamps`` gives us character alignment which is converted into
    word cues for the existing subtitle pipeline.
    """

    endpoint = "https://api.elevenlabs.io/v1/text-to-speech"
    model_id = "eleven_multilingual_v2"

    async def generate(
        self, text: str, output_path: str, voice: str = "fr-FR-DeniseNeural", rate: str = "+0%"
    ) -> Tuple[str, object]:
        return await asyncio.to_thread(
            self._generate_sync,
            text,
            output_path,
            voice,
            rate,
        )

    def _generate_sync(self, text: str, output_path: str, voice: str, rate: str) -> Tuple[str, object]:
        api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("La clé ElevenLabs n’est pas configurée côté serveur.")
        if not text.strip():
            raise RuntimeError("Le texte de la voix off est vide.")

        voice_id = os.environ.get("ELEVENLABS_VOICE_ID", "").strip()
        if not voice_id:
            voice_id = _ELEVENLABS_VOICE_IDS.get(voice, _ELEVENLABS_VOICE_IDS["fr-FR-DeniseNeural"])

        # ElevenLabs accepts an explicit rate only through voice settings in
        # newer API versions. The current UI uses +0%, so omit it unless a
        # future caller provides a non-default rate.
        voice_settings = {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
            "use_speaker_boost": True,
        }
        if rate not in ("", "+0%", "0%"):
            logger.info("[TTS] ElevenLabs rate hint ignored by provider: %s", rate)

        logger.info(
            "[TTS] Generating ElevenLabs audio: voice=%s, text=%d chars",
            voice_id,
            len(text),
        )
        try:
            response = requests.post(
                f"{self.endpoint}/{voice_id}/with-timestamps",
                headers={
                    "xi-api-key": api_key,
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
                json={
                    "text": text,
                    "model_id": self.model_id,
                    "voice_settings": voice_settings,
                },
                timeout=(15, 180),
            )
        except requests.RequestException as exc:
            raise RuntimeError("Impossible de joindre ElevenLabs pour générer la voix off.") from exc

        if not response.ok:
            detail = response.text[:300].replace("\n", " ").strip()
            raise RuntimeError(
                f"ElevenLabs a refusé la synthèse ({response.status_code})."
                + (f" {detail}" if detail else "")
            )

        try:
            payload = response.json()
            audio_base64 = payload.get("audio_base64", "")
            audio_bytes = base64.b64decode(audio_base64, validate=True)
        except (ValueError, TypeError, base64.binascii.Error) as exc:
            raise RuntimeError("ElevenLabs a renvoyé un fichier audio invalide.") from exc
        if not audio_bytes:
            raise RuntimeError("ElevenLabs a renvoyé une voix off vide.")

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        tmp_path = output_path + ".tmp"
        try:
            with open(tmp_path, "wb") as audio_file:
                audio_file.write(audio_bytes)
            os.replace(tmp_path, output_path)
        except OSError as exc:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
            raise RuntimeError("Impossible d’enregistrer la voix off ElevenLabs.") from exc

        cues = self._alignment_to_cues(payload.get("alignment") or payload.get("normalized_alignment"))
        sub_maker = SimpleNamespace(cues=cues) if cues else None
        logger.info("[TTS] ElevenLabs audio saved: %s (%d cues)", output_path, len(cues))
        return output_path, sub_maker

    @staticmethod
    def _alignment_to_cues(alignment: object) -> list:
        if not isinstance(alignment, dict):
            return []
        characters = alignment.get("characters")
        starts = alignment.get("character_start_times_seconds")
        ends = alignment.get("character_end_times_seconds")
        if not isinstance(characters, list) or not isinstance(starts, list) or not isinstance(ends, list):
            return []
        if not (len(characters) == len(starts) == len(ends)):
            return []

        cues = []
        word_start = None
        for index, character in enumerate(characters):
            value = str(character)
            if value.isspace():
                if word_start is not None:
                    cues.append(
                        SimpleNamespace(
                            start=float(starts[word_start]),
                            end=float(ends[index - 1]),
                            content="".join(str(item) for item in characters[word_start:index]),
                        )
                    )
                    word_start = None
                continue
            if word_start is None:
                word_start = index
        if word_start is not None:
            cues.append(
                SimpleNamespace(
                    start=float(starts[word_start]),
                    end=float(ends[-1]),
                    content="".join(str(item) for item in characters[word_start:]),
                )
            )
        return [cue for cue in cues if cue.content.strip() and cue.end > cue.start]


class EdgeTTSEngine(TTSEngine):
    """基于 edge_tts 的免费 TTS 引擎。

    generate() 返回 (audio_path, sub_maker)，其中 sub_maker 是 edge_tts.SubMaker 实例，
    包含逐词时间戳 cues，可用于生成 SRT 字幕。
    """

    async def generate(
        self, text: str, output_path: str, voice: str = "zh-CN-XiaoxiaoNeural", rate: str = "+0%"
    ) -> Tuple[str, "edge_tts.SubMaker"]:
        """生成 TTS 音频 + SubMaker（含 cues 时间戳）。

        Args:
            text: 要朗读的文本
            output_path: 输出音频文件路径（.mp3）
            voice: edge_tts 语音角色
            rate: 语速调节（如 "+0%", "+20%", "-10%"）

        Returns:
            (audio_path, sub_maker) 元组

        Raises:
            RuntimeError: TTS 生成失败时抛出，调用方应降级到 SilentTTSEngine。
        """
        logger.info(f"[TTS] Generating audio: voice={voice}, rate={rate}, text={len(text)} chars...")

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        max_attempts = 2
        for attempt in range(max_attempts):
            try:
                communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
                sub_maker = edge_tts.SubMaker()

                tmp_path = output_path + ".tmp"
                async with await async_open(tmp_path, "wb") as audio_file:
                    async for chunk in communicate.stream():
                        if chunk["type"] == "audio":
                            await audio_file.write(chunk["data"])
                        elif chunk["type"] in ("WordBoundary", "SentenceBoundary"):
                            sub_maker.feed(chunk)

                # 原子替换，避免半成品被误用
                os.replace(tmp_path, output_path)
                logger.info(f"[TTS] Audio saved: {output_path}")
                return output_path, sub_maker
            except Exception as e:
                # 清理半成品文件
                for p in (tmp_path, output_path):
                    if os.path.exists(p):
                        try:
                            os.remove(p)
                        except OSError:
                            pass
                if attempt < max_attempts - 1:
                    logger.warning(f"[TTS] edge_tts attempt {attempt + 1}/{max_attempts} failed: {e}, retrying...")
                    await asyncio.sleep(3)
                    continue
                logger.error(f"[TTS] edge_tts failed after {max_attempts} attempts: {e}")
                raise RuntimeError(f"EdgeTTS generation failed: {e}") from e

    async def harvest_cues(
        self, text: str, voice: str = "zh-CN-XiaoxiaoNeural", rate: str = "+0%"
    ) -> "edge_tts.SubMaker":
        """仅采集逐词时间戳，不生成/不落盘音频字节（路径 B：音频关、字幕开）。

        edge_tts 的 WordBoundary 与音频数据交织于同一 stream，需消费完整 stream
        才能收齐全部 cues；本方法只把 WordBoundary/SentenceBoundary 喂给 SubMaker，
        音频数据直接丢弃。返回含 .cues 的 sub_maker，供 generate_cue_aware_srt 使用。

        字幕只需时间线真值，不需音频字节——这正是「cues 采集」与「音频输出」解耦的核心。

        Args:
            text: 要朗读的文本
            voice: edge_tts 语音角色
            rate: 语速调节

        Returns:
            含逐词 cues 的 edge_tts.SubMaker 实例

        Raises:
            RuntimeError: 采集失败时抛出，调用方应降级到 SilentTTSEngine（字幕回退 legacy）。
        """
        logger.info(
            f"[TTS] Harvesting cues only: voice={voice}, rate={rate}, text={len(text)} chars..."
        )

        max_attempts = 2
        for attempt in range(max_attempts):
            try:
                communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
                sub_maker = edge_tts.SubMaker()
                async for chunk in communicate.stream():
                    if chunk["type"] in ("WordBoundary", "SentenceBoundary"):
                        sub_maker.feed(chunk)
                cue_count = len(getattr(sub_maker, "cues", []) or [])
                logger.info(f"[TTS] Cues harvested: {cue_count} cues")
                return sub_maker
            except Exception as e:
                if attempt < max_attempts - 1:
                    logger.warning(
                        f"[TTS] harvest_cues attempt {attempt + 1}/{max_attempts} "
                        f"failed: {e}, retrying..."
                    )
                    await asyncio.sleep(3)
                    continue
                logger.error(f"[TTS] harvest_cues failed after {max_attempts} attempts: {e}")
                raise RuntimeError(f"EdgeTTS cue harvest failed: {e}") from e


class SilentTTSEngine(TTSEngine):
    """静音占位 TTS 引擎。

    生成指定时长的静音音频，返回空 cues。用于用户关闭旁白时仍需要字幕时间轴的场景。
    """

    async def generate(
        self,
        text: str,
        output_path: str,
        voice: str = "zh-CN-XiaoxiaoNeural",
        rate: str = "+0%",
        duration_sec: Optional[float] = None,
    ) -> Tuple[str, dict]:
        """生成静音音频。

        Args:
            text: 文本（用于估算时长，如果 duration_sec 未提供）
            output_path: 输出音频文件路径
            voice: 忽略（静音模式）
            rate: 忽略（静音模式）
            duration_sec: 指定静音时长（秒），如果不提供则按文本长度估算

        Returns:
            (audio_path, empty_cues_dict) 元组
        """
        if duration_sec is None:
            # 估算时长：中文 4 字/秒
            duration_sec = max(len(text) / 4.0, 1.0)

        logger.info(f"[TTS] Generating silent audio: {duration_sec:.1f}s → {output_path}")

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        # 使用 ffmpeg 生成静音音频
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y",
            "-f", "lavfi",
            "-i", "anullsrc=r=44100:cl=mono",
            "-t", str(duration_sec),
            "-c:a", "libmp3lame",
            "-q:a", "4",
            output_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        # P9: 检查 ffmpeg 返回码，失败时抛出异常而非静默返回
        if proc.returncode != 0:
            err_msg = stderr.decode(errors="replace")[:500] if stderr else ""
            raise RuntimeError(
                f"[TTS] ffmpeg silent generation failed (code {proc.returncode}): {err_msg}"
            )

        # 返回空 cues（用 None 而非 {}，让下游正确识别为无 SubMaker 可用）
        return output_path, None
