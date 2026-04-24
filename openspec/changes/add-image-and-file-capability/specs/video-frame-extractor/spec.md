## ADDED Requirements

### Requirement: Video frame extraction via ffmpeg
Kawa SHALL extract key frames from received video files using ffmpeg so they can be sent to vision models as image sequences.

#### Scenario: Short video frame extraction
- **WHEN** a video file transfer completes in `KAWA_FILES_DIR/videos/`
- **AND** ffmpeg is available on the system
- **THEN** Kawa SHALL run `ffmpeg -i <video> -vf fps=1 <output_dir>/%04d.jpg` to extract frames at 1 frame per second
- **AND** frames SHALL be saved in a subdirectory named `<video_name>_frames/` under `KAWA_FILES_DIR/videos/`
- **AND** each extracted frame SHALL be resized to max 2048px on the longest side using the `sharp` npm package (the pi agent's internal `resizeImage` utility is not part of its public API and cannot be imported)
- **AND** the resized frame `ImageContent[]` SHALL be passed to the agent via `session.prompt(text, { images })`

#### Scenario: ffmpeg not available
- **WHEN** ffmpeg is not found on the system (checked via `KAWA_FFMPEG_BIN` or PATH)
- **THEN** Kawa SHALL log a warning: "ffmpeg not found, video frame extraction disabled"
- **AND** Kawa SHALL NOT attempt frame extraction
- **AND** Kawa SHALL prompt the agent with the text message only, noting "[Video received but frame extraction unavailable]"
- **AND** image and file handling SHALL continue to work normally

#### Scenario: Video frame extraction fails
- **WHEN** ffmpeg exits with a non-zero exit code during frame extraction
- **THEN** Kawa SHALL log the error
- **AND** Kawa SHALL prompt the agent with the text message only, noting "[Video received but frame extraction failed]"

#### Scenario: Large video with many frames
- **WHEN** a video longer than 60 seconds is received
- **AND** frame extraction produces more than 60 frames
- **THEN** Kawa SHALL send only the first 60 frames to the agent
- **AND** the agent prompt SHALL include a note: "[Video is longer than 60s; showing first 60 frames]"

#### Scenario: ffmpeg binary path is configurable
- **WHEN** the `KAWA_FFMPEG_BIN` environment variable is set
- **THEN** Kawa SHALL use that path as the ffmpeg binary
- **AND** when `KAWA_FFMPEG_BIN` is not set, Kawa SHALL default to `ffmpeg` (looking up via PATH)

#### Scenario: Frame extraction cleanup
- **WHEN** frames have been extracted, resized, and passed to the agent successfully
- **THEN** the original unresized frame files in `<video_name>_frames/` SHALL be kept on disk for potential future use
- **AND** Kawa SHALL NOT delete extracted frames after sending them to the agent