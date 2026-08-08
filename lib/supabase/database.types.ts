/**
 * Schema types for supabase/migrations/0001_init.sql.
 *
 * Regenerate after a migration with:
 *   npx supabase gen types typescript --project-id <ref> > lib/supabase/database.types.ts
 *
 * Without this generic every query row infers as `never`.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      source_videos: {
        Row: {
          id: string;
          owner_id: string;
          source_url: string;
          title: string | null;
          status: string;
          storage_path: string | null;
          duration_seconds: number | null;
          loudness_envelope: number[] | null;
          error_message: string | null;
          claimed_at: string | null;
          attempts: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          source_url: string;
          title?: string | null;
          status?: string;
          storage_path?: string | null;
          duration_seconds?: number | null;
          loudness_envelope?: number[] | null;
          error_message?: string | null;
          claimed_at?: string | null;
          attempts?: number;
        };
        Update: Partial<Database["public"]["Tables"]["source_videos"]["Insert"]>;
        Relationships: [];
      };
      clips: {
        Row: {
          id: string;
          owner_id: string;
          source_video_id: string;
          start_seconds: number;
          end_seconds: number;
          peak_score: number | null;
          storage_path: string | null;
          status: string;
          transcript: Json | null;
          caption_style: string | null;
          caption_burned_path: string | null;
          caption_paths: Record<string, string>;
          error_message: string | null;
          claimed_at: string | null;
          attempts: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          source_video_id: string;
          start_seconds: number;
          end_seconds: number;
          peak_score?: number | null;
          storage_path?: string | null;
          status?: string;
          transcript?: Json | null;
          caption_style?: string | null;
          caption_burned_path?: string | null;
          caption_paths?: Record<string, string>;
          error_message?: string | null;
          claimed_at?: string | null;
          attempts?: number;
        };
        Update: Partial<Database["public"]["Tables"]["clips"]["Insert"]>;
        Relationships: [];
      };
      hooks: {
        Row: {
          id: string;
          owner_id: string;
          clip_id: string;
          hook_text: string;
          is_selected: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          clip_id: string;
          hook_text: string;
          is_selected?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["hooks"]["Insert"]>;
        Relationships: [];
      };
      uploads: {
        Row: {
          id: string;
          owner_id: string;
          clip_id: string;
          youtube_video_id: string | null;
          youtube_url: string | null;
          title: string | null;
          description: string | null;
          tags: string[] | null;
          decision: string | null;
          quota_units: number;
          uploaded_at: string | null;
          status: string;
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          clip_id: string;
          youtube_video_id?: string | null;
          youtube_url?: string | null;
          title?: string | null;
          description?: string | null;
          tags?: string[] | null;
          decision?: string | null;
          quota_units?: number;
          uploaded_at?: string | null;
          status?: string;
          error_message?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["uploads"]["Insert"]>;
        Relationships: [];
      };
      quota_usage: {
        Row: { owner_id: string; usage_date: string; units_used: number };
        Insert: { owner_id: string; usage_date: string; units_used?: number };
        Update: Partial<Database["public"]["Tables"]["quota_usage"]["Insert"]>;
        Relationships: [];
      };
      app_settings: {
        Row: {
          owner_id: string;
          auto_upload_enabled: boolean;
          default_caption_style: string;
          clip_length_seconds: number;
          max_clips_per_source: number;
          daily_quota_limit: number;
          youtube_privacy_status: string;
          updated_at: string;
        };
        Insert: {
          owner_id: string;
          auto_upload_enabled?: boolean;
          default_caption_style?: string;
          clip_length_seconds?: number;
          max_clips_per_source?: number;
          daily_quota_limit?: number;
          youtube_privacy_status?: string;
        };
        Update: Partial<Database["public"]["Tables"]["app_settings"]["Insert"]>;
        Relationships: [];
      };
      youtube_accounts: {
        Row: {
          owner_id: string;
          channel_id: string | null;
          channel_title: string | null;
          refresh_token: string;
          access_token: string | null;
          token_expires_at: string | null;
          scope: string | null;
          connected_at: string;
          updated_at: string;
        };
        Insert: {
          owner_id: string;
          channel_id?: string | null;
          channel_title?: string | null;
          refresh_token: string;
          access_token?: string | null;
          token_expires_at?: string | null;
          scope?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["youtube_accounts"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      reserve_quota: {
        Args: {
          p_owner: string;
          p_date: string;
          p_units: number;
          p_ceiling: number;
        };
        Returns: boolean;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
