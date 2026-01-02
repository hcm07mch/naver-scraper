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
