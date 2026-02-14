/**
 * 크롤링 관련 타입 정의
 */

export interface ScrapingRequest {
  keyword: string;
  placeId?: string;
}

export interface ScrapingResult {
  success: boolean;
  keyword: string;
  placeId?: string;
  rank?: number;
  reviewCount?: number;
  blogCount?: number;
  timestamp: string;
  error?: string;
}

export interface NaverPlaceItem {
  id: string;
  name: string;
  rank: number;
  reviewCount?: number;
  blogCount?: number;
}

/**
 * 순위 목록 내 개별 업체 정보
 */
export interface RankingItem {
  rank: number;                    // 순위 (1~300)
  place_id: string;                // 네이버 플레이스 ID
  name: string;                    // 업체명
  visitor_review_count?: number;   // 방문자 리뷰 수 (상세 페이지에서만)
  blog_review_count?: number;      // 블로그 리뷰 수 (상세 페이지에서만)
  category?: string;               // 카테고리
  href?: string;                   // 상세 페이지 URL
  review_count?: number;           // 검색 결과의 대략 리뷰 수 (숫자로 변환)
  review_count_raw?: string;       // 원본 문자열 (예: "2.2만")
}

/**
 * 업체 상세 페이지 리뷰 수 정보
 */
export interface PlaceReviewDetail {
  place_id: string;
  visitor_review_count: number;    // 방문자 리뷰 수
  blog_review_count: number;       // 블로그 리뷰 수
  total_review_count: number;      // 총 리뷰 수
}

/**
 * 전체 순위 수집 결과
 */
export interface FullRankingResult {
  success: boolean;
  keyword: string;
  measuredDate: string;             // YYYY-MM-DD
  totalResults: number;             // 수집된 총 업체 수
  rankings: RankingItem[];          // 1~300위 전체 목록
  targetPlaceRank?: number;         // 타겟 업체 순위 (있는 경우)
  targetPlaceReviewCount?: number;  // 타겟 업체 방문자 리뷰 수
  targetPlaceBlogCount?: number;    // 타겟 업체 블로그 리뷰 수
  timestamp: string;
  error?: string;
}
