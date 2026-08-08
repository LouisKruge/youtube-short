export type CaptionStyle = "karaoke" | "static";

export type SourceStatus =
  | "pending_download"
  | "downloading"
  | "downloaded"
  | "analyzing"
  | "analyzed"
  | "failed";

export type ClipStatus =
  | "pending_segment"
  | "segmented"
  | "cropping"
  | "transcribing"
  | "ready_for_review"
  | "rendering"
  | "queued"
  | "uploading"
  | "uploaded"
  | "failed"
  | "rejected";

export type UploadStatus = "pending" | "uploading" | "success" | "failed";

export interface SourceVideo {
  id: string;
  owner_id: string;
  source_url: string;
  title: string | null;
  status: SourceStatus;
  storage_path: string | null;
  duration_seconds: number | null;
  loudness_envelope: number[] | null;
  error_message: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface Transcript {
  text: string;
  words: TranscriptWord[];
}

export interface Clip {
  id: string;
  owner_id: string;
  source_video_id: string;
  start_seconds: number;
  end_seconds: number;
  peak_score: number | null;
  storage_path: string | null;
  status: ClipStatus;
  transcript: Transcript | null;
  caption_style: CaptionStyle | null;
  caption_burned_path: string | null;
  caption_paths: Partial<Record<CaptionStyle, string>>;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface Hook {
  id: string;
  clip_id: string;
  hook_text: string;
  is_selected: boolean;
  created_at: string;
}

export interface Upload {
  id: string;
  clip_id: string;
  youtube_video_id: string | null;
  youtube_url: string | null;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  decision: string | null;
  quota_units: number;
  uploaded_at: string | null;
  status: UploadStatus;
  error_message: string | null;
  created_at: string;
}

export interface AppSettings {
  owner_id: string;
  auto_upload_enabled: boolean;
  default_caption_style: CaptionStyle;
  clip_length_seconds: number;
  max_clips_per_source: number;
  daily_quota_limit: number;
  youtube_privacy_status: "public" | "unlisted" | "private";
  updated_at: string;
}

export interface QuotaSnapshot {
  date: string;
  unitsUsed: number;
  limit: number;
  unitsPerUpload: number;
  uploadsRemaining: number;
  uploadsPerDay: number;
}

/** A clip joined with the data the review grid needs to render one card. */
export interface ClipWithContext extends Clip {
  hooks: Hook[];
  source: Pick<
    SourceVideo,
    "id" | "title" | "source_url" | "duration_seconds" | "loudness_envelope"
  > | null;
  previewUrl: string | null;
}
