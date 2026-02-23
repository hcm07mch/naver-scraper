-- ============================================
-- 키워드 순위 데이터 통합 마이그레이션
-- 
-- 목적: keyword_analysis_snapshots에 전체 순위(1~300위)를 저장하고,
--       keyword_ranking_history를 뷰로 전환하여 특정 업체 순위 자동 추출
--
-- 실행 전 주의사항:
-- 1. 반드시 백업 후 실행
-- 2. 프로덕션 환경에서는 점검 시간에 실행
-- ============================================

BEGIN;

-- ============================================
-- 1단계: 기존 keyword_ranking_history 백업
-- ============================================
CREATE TABLE IF NOT EXISTS keyword_ranking_history_backup AS 
SELECT * FROM keyword_ranking_history;

COMMENT ON TABLE keyword_ranking_history_backup IS '마이그레이션 전 keyword_ranking_history 백업 (안전하게 삭제 가능)';

-- ============================================
-- 2단계: 의존성 있는 뷰 삭제
-- ============================================
DROP VIEW IF EXISTS customer_keywords_with_latest_ranking CASCADE;

-- ============================================
-- 3단계: 기존 테이블 트리거 및 테이블 삭제
-- ============================================
DROP TRIGGER IF EXISTS trigger_ranking_history_updated_at ON keyword_ranking_history;
DROP TABLE IF EXISTS keyword_ranking_history CASCADE;

-- ============================================
-- 4단계: keyword_ranking_history 뷰 생성
-- keyword_analysis_snapshots.rankings에서 해당 업체 순위 추출
-- ============================================
CREATE OR REPLACE VIEW keyword_ranking_history AS
SELECT
  kas.id,
  kas.customer_keyword_id,
  kas.measured_date,
  matched_ranking.exposure_rank,
  matched_ranking.visitor_review_count,
  matched_ranking.blog_review_count,
  kas.metadata,
  kas.created_at,
  kas.updated_at
FROM keyword_analysis_snapshots kas
JOIN customer_keywords ck ON ck.id = kas.customer_keyword_id
JOIN customers c ON c.id = ck.customer_id
CROSS JOIN LATERAL (
  SELECT 
    (elem->>'rank')::integer as exposure_rank,
    COALESCE((elem->>'visitor_review_count')::integer, 0) as visitor_review_count,
    COALESCE((elem->>'blog_review_count')::integer, 0) as blog_review_count
  FROM jsonb_array_elements(kas.rankings) elem
  WHERE elem->>'place_id' = c.place_id
  LIMIT 1
) matched_ranking
WHERE c.place_id IS NOT NULL;

COMMENT ON VIEW keyword_ranking_history IS '특정 업체의 키워드별 순위 (keyword_analysis_snapshots에서 자동 추출)';

-- ============================================
-- 5단계: customer_keywords_with_latest_ranking 뷰 재생성
-- ============================================
CREATE OR REPLACE VIEW customer_keywords_with_latest_ranking AS
SELECT
  ck.id,
  ck.customer_id,
  ck.keyword,
  ck.is_active,
  ck.is_main,
  ck.created_at,
  ck.updated_at,
  ck.deleted_at,
  c.client_name,
  c.place_id,
  c.place_url,
  c.user_id,
  (
    SELECT jsonb_build_object(
      'measured_date', krh.measured_date,
      'exposure_rank', krh.exposure_rank,
      'visitor_review_count', krh.visitor_review_count,
      'blog_review_count', krh.blog_review_count
    )
    FROM keyword_ranking_history krh
    WHERE krh.customer_keyword_id = ck.id
      AND krh.exposure_rank IS NOT NULL
    ORDER BY krh.measured_date DESC
    LIMIT 1
  ) as latest_ranking
FROM customer_keywords ck
JOIN customers c ON c.id = ck.customer_id
WHERE ck.deleted_at IS NULL;

COMMENT ON VIEW customer_keywords_with_latest_ranking IS '최신 순위 정보 포함 키워드 목록';

-- ============================================
-- 6단계: keyword_analysis_snapshots 업데이트 트리거 함수 확인/생성
-- ============================================
CREATE OR REPLACE FUNCTION update_keyword_analysis_snapshots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거가 없으면 생성
DROP TRIGGER IF EXISTS trigger_keyword_analysis_snapshots_updated_at ON keyword_analysis_snapshots;
CREATE TRIGGER trigger_keyword_analysis_snapshots_updated_at
  BEFORE UPDATE ON keyword_analysis_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION update_keyword_analysis_snapshots_updated_at();

-- ============================================
-- 7단계: 권한 설정
-- ============================================
GRANT SELECT ON keyword_ranking_history TO authenticated;
GRANT SELECT ON customer_keywords_with_latest_ranking TO authenticated;

-- ============================================
-- 8단계: 기존 데이터 마이그레이션 (선택적)
-- 기존 keyword_ranking_history_backup 데이터를 
-- keyword_analysis_snapshots로 변환하려면 아래 주석 해제
-- ============================================
INSERT INTO keyword_analysis_snapshots (
  user_id,
  customer_keyword_id,
  keyword,
  measured_date,
  total_results,
  rankings,
  metadata
)
SELECT 
  c.user_id,
  krh.customer_keyword_id,
  ck.keyword,
  krh.measured_date,
  1, -- 기존 데이터는 단일 업체 정보만 있음
  jsonb_build_array(
    jsonb_build_object(
      'rank', krh.exposure_rank,
      'place_id', c.place_id,
      'name', c.client_name,
      'visitor_review_count', krh.visitor_review_count,
      'blog_review_count', krh.blog_review_count
    )
  ),
  krh.metadata
FROM keyword_ranking_history_backup krh
JOIN customer_keywords ck ON ck.id = krh.customer_keyword_id
JOIN customers c ON c.id = ck.customer_id
ON CONFLICT (customer_keyword_id, measured_date) DO NOTHING;

COMMIT;

-- ============================================
-- 검증 쿼리 (마이그레이션 후 실행)
-- ============================================
-- 1. 뷰 테스트
SELECT * FROM keyword_ranking_history LIMIT 5;
SELECT * FROM customer_keywords_with_latest_ranking LIMIT 5;

-- 2. 스냅샷 테이블 확인
SELECT id, keyword, measured_date, total_results, jsonb_array_length(rankings) as ranking_count 
FROM keyword_analysis_snapshots 
ORDER BY measured_date DESC LIMIT 10;
