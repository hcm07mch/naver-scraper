/**
 * Supabase 데이터베이스 타입 정의
 * 실제 Supabase 프로젝트 스키마 기반
 */

/**
 * 순위 목록 내 개별 업체 정보 (JSONB 저장용)
 */
export interface RankingItemJson {
  rank: number;
  place_id: string;
  name: string;
  visitor_review_count?: number;
  blog_review_count?: number;
  category?: string;
  href?: string;
}

export interface Database {
  public: {
    Tables: {
      /**
       * 고객(업체) 테이블
       */
      customers: {
        Row: {
          id: string;
          user_id: string;
          client_name: string;
          place_id: string | null;
          place_url: string | null;
          contact: string | null;
          extra_fields: Record<string, any>;
          business_type: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_name: string;
          place_id?: string | null;
          place_url?: string | null;
          contact?: string | null;
          extra_fields?: Record<string, any>;
          business_type?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          client_name?: string;
          place_id?: string | null;
          place_url?: string | null;
          contact?: string | null;
          extra_fields?: Record<string, any>;
          business_type?: string;
          created_at?: string;
          updated_at?: string;
        };
      };

      /**
       * 고객별 키워드 테이블
       */
      customer_keywords: {
        Row: {
          id: string;
          customer_id: string;
          keyword: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          customer_id: string;
          keyword: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          customer_id?: string;
          keyword?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
      };

      /**
       * 키워드 순위 이력 테이블 (뷰로 전환됨 - keyword_analysis_snapshots에서 추출)
       */
      keyword_ranking_history: {
        Row: {
          id: string;
          customer_keyword_id: string;
          measured_date: string;
          exposure_rank: number | null;
          visitor_review_count: number;
          blog_review_count: number;
          metadata: Record<string, any>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_keyword_id: string;
          measured_date: string;
          exposure_rank?: number | null;
          visitor_review_count?: number;
          blog_review_count?: number;
          metadata?: Record<string, any>;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          customer_keyword_id?: string;
          measured_date?: string;
          exposure_rank?: number | null;
          visitor_review_count?: number;
          blog_review_count?: number;
          metadata?: Record<string, any>;
          created_at?: string;
          updated_at?: string;
        };
      };

      /**
       * 키워드 분석 스냅샷 테이블 (전체 1~300위 데이터)
       */
      keyword_analysis_snapshots: {
        Row: {
          id: string;
          user_id: string;
          customer_keyword_id: string;
          keyword: string;
          measured_date: string;
          total_results: number;
          rankings: RankingItemJson[];
          metadata: Record<string, any>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          customer_keyword_id: string;
          keyword: string;
          measured_date: string;
          total_results?: number;
          rankings: RankingItemJson[];
          metadata?: Record<string, any>;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          customer_keyword_id?: string;
          keyword?: string;
          measured_date?: string;
          total_results?: number;
          rankings?: RankingItemJson[];
          metadata?: Record<string, any>;
          created_at?: string;
          updated_at?: string;
        };
      };

      /**
       * 스크래핑 실행 로그 테이블
       */
      scraping_logs: {
        Row: {
          id: string;
          started_at: string;
          completed_at: string | null;
          total_keywords: number;
          processed_count: number;
          failed_count: number;
          status: 'running' | 'completed' | 'failed';
          error_message: string | null;
          trigger_type: 'scheduled' | 'manual' | 'api';
          execution_time_ms: number | null;
          metadata: Record<string, any>;
          created_at: string;
        };
        Insert: {
          id?: string;
          started_at?: string;
          completed_at?: string | null;
          total_keywords?: number;
          processed_count?: number;
          failed_count?: number;
          status?: 'running' | 'completed' | 'failed';
          error_message?: string | null;
          trigger_type?: 'scheduled' | 'manual' | 'api';
          execution_time_ms?: number | null;
          metadata?: Record<string, any>;
          created_at?: string;
        };
        Update: {
          id?: string;
          started_at?: string;
          completed_at?: string | null;
          total_keywords?: number;
          processed_count?: number;
          failed_count?: number;
          status?: 'running' | 'completed' | 'failed';
          error_message?: string | null;
          trigger_type?: 'scheduled' | 'manual' | 'api';
          execution_time_ms?: number | null;
          metadata?: Record<string, any>;
          created_at?: string;
        };
      };
    };
    Views: {
      /**
       * 최신 순위 정보가 포함된 키워드 뷰
       */
      customer_keywords_with_latest_ranking: {
        Row: {
          id: string;
          customer_id: string;
          keyword: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          client_name: string;
          place_id: string | null;
          place_url: string | null;
          user_id: string;
          latest_ranking: {
            measured_date: string;
            exposure_rank: number | null;
            visitor_review_count: number;
            blog_review_count: number;
          } | null;
        };
      };
    };
    Functions: {};
    Enums: {};
  };
}

/**
 * 편의를 위한 타입 별칭
 */
export type Customer = Database['public']['Tables']['customers']['Row'];
export type CustomerInsert = Database['public']['Tables']['customers']['Insert'];

export type CustomerKeyword = Database['public']['Tables']['customer_keywords']['Row'];
export type CustomerKeywordInsert = Database['public']['Tables']['customer_keywords']['Insert'];

export type KeywordRankingHistory = Database['public']['Tables']['keyword_ranking_history']['Row'];
export type KeywordRankingHistoryInsert = Database['public']['Tables']['keyword_ranking_history']['Insert'];

export type ScrapingLog = Database['public']['Tables']['scraping_logs']['Row'];
export type ScrapingLogInsert = Database['public']['Tables']['scraping_logs']['Insert'];
export type ScrapingLogUpdate = Database['public']['Tables']['scraping_logs']['Update'];

export type CustomerKeywordWithLatestRanking = Database['public']['Views']['customer_keywords_with_latest_ranking']['Row'];

export type KeywordAnalysisSnapshot = Database['public']['Tables']['keyword_analysis_snapshots']['Row'];
export type KeywordAnalysisSnapshotInsert = Database['public']['Tables']['keyword_analysis_snapshots']['Insert'];
export type KeywordAnalysisSnapshotUpdate = Database['public']['Tables']['keyword_analysis_snapshots']['Update'];

/**
 * 스크래핑 대상 키워드 (customers + customer_keywords 조인 결과)
 */
export interface ScrapingTarget {
  keywordId: string;        // customer_keywords.id
  customerId: string;       // customers.id
  keyword: string;          // customer_keywords.keyword
  placeId: string;          // customers.place_id
  clientName: string;       // customers.client_name
  businessType: string;     // customers.business_type
  userId?: string;          // customers.user_id (추가)
}
