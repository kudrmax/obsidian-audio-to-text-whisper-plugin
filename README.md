# Audio to Text via Whisper

An Obsidian plugin that transcribes audio in your notes with a **local, offline Whisper** and replaces the audio with text. Only audio marked with a tag on the same line is processed:

```
- ![[Recording_1.m4a]] #transcribe   ← transcribed
- ![[Recording_2.m4a]]               ← left untouched
```

Embeds `![[rec.m4a]]`, wiki links `[[rec.m4a]]` and markdown links `[…](rec.m4a)` are supported. The reference is replaced with the transcript, the tag is optionally removed from that line, and the audio is moved to the system trash once nothing references it anymore.

Desktop only (macOS, Linux). Nothing leaves your machine.

## Requirements

The plugin never installs Whisper and never downloads models — set them up once beforehand.

### whisper.cpp (recommended, fastest on Apple Silicon)

```bash
brew install whisper-cpp ffmpeg
```

```bash
mkdir -p ~/whisper-models && curl -L -o ~/whisper-models/ggml-large-v3-turbo.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
```

A voice activity detection (VAD) model is required too: without it Whisper invents phrases like "Subtitles by…" on silence and quiet speech.

```bash
curl -L -o ~/whisper-models/ggml-silero-v5.1.2.bin https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin
```

### openai-whisper (alternative)

```bash
pipx install openai-whisper && brew install ffmpeg
```

```bash
mkdir -p ~/.cache/whisper && curl -L -o ~/.cache/whisper/large-v3-turbo.pt https://openaipublic.azureedge.net/main/whisper/models/aff26ae408abcba5fbf8813c21e62b0941638c5f6eebfb145be0c9839262a19a/large-v3-turbo.pt
```

Executables are auto-detected in `/opt/homebrew/bin`, `/usr/local/bin` and `~/.local/bin`; models in `~/whisper-models` (whisper.cpp) and `~/.cache/whisper` (openai-whisper). Any path can be set explicitly in the settings.

## Installation

Via [BRAT](https://github.com/TfTHacker/obsidian42-brat): *Add beta plugin* → `kudrmax/obsidian-audio-to-text-whisper-plugin`.

## Usage

1. Set the folder to scan (subfolders included) and the tags in the plugin settings.
2. Put a tag next to the audio you want transcribed.
3. Run **Transcribe tagged audio** from the command palette or the ribbon.

Progress is shown in a notice and the status bar: files done, percentage, current file and estimated time left. The estimate uses audio durations (via `ffprobe`) and the transcription speed remembered from previous runs. Run **Stop transcription** to cancel.

## Data safety

Each audio goes through strictly ordered steps:

1. transcription (no side effects);
2. a journal entry in the plugin data: audio, note, transcript;
3. atomic replacement of the reference on the tagged line (`vault.process`). If that line was changed during transcription, the run reports an error and keeps the audio; edits elsewhere in the note are preserved;
4. the audio is moved to the system trash only if nothing references it anymore;
5. the journal entry is removed.

An interruption at any step never loses audio: the next run finishes pending deletions, trashing audio only if its transcript is really in the note. If Whisper fails or returns empty text, the note and the audio stay as they were.

## Development

```bash
npm install
```

```bash
npm test && npm run build
```
