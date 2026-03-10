/**
 * 키워드 및 스크래핑 결과 관련 데이터베이스 서비스
 * 실제 Supabase 스키마 기반
 */
import { getSupabaseClient } from './supabase';
import { 
  ScrapingTarget, 
  KeywordRankingHistoryInsert,
  KeywordAnalysisSnapshotInsert,
  CustomerKeywordRankingInsert,
  CustomerKeywordWithLatestRanking,
  RankingItemJson
} from './database.types';
import { ScrapingResult, FullRankingResult, RankingItem } from './types';

/**
 * 활성화된 모든 키워드 조회 (customers + customer_keywords 조인)
 * place_id가 있는 고객의 활성 키워드만 조회
 * 오늘 이미 스크래핑된 customer_keyword_id는 제외
 */
export async function getActiveKeywords(): Promise<ScrapingTarget[]> {
  const supabase = getSupabaseClient();
  
  console.log('📋 활성 키워드 조회 중...');
  
  // 오늘 날짜 (YYYY-MM-DD)
  const today = new Date().toISOString().split('T')[0];
  
  // customer_keywords와 customers 조인 쿼리 (left join으로 customer_id가 null인 키워드도 포함)
  // user_id는 customer_keywords 테이블에 직접 있을 수도 있고, customers 테이블에서 가져올 수도 있음
  const { data, error } = await supabase
    .from('customer_keywords')
    .select(`
      id,
      customer_id,
      keyword,
      user_id,
      customers (
        id,
        client_name,
        place_id,
        business_type,
        user_id
      )
    `)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ 키워드 조회 실패:', error.message);
    throw new Error(`키워드 조회 실패: ${error.message}`);
  }

  // 결과를 ScrapingTarget 형태로 변환 (customer_id가 null인 경우도 처리)
  // user_id는 customer_keywords 테이블의 값을 우선 사용, 없으면 customers 테이블에서 가져옴
  const allTargets: ScrapingTarget[] = (data || []).map((item: any) => ({
    keywordId: item.id,
    customerId: item.customer_id || null,
    keyword: item.keyword,
    placeId: item.customers?.place_id || null,
    clientName: item.customers?.client_name || null,
    businessType: item.customers?.business_type || null,
    userId: item.user_id || item.customers?.user_id || null,
  }));

  console.log(`📊 전체 활성 키워드: ${allTargets.length}개`);
  
  // 오늘 이미 스크래핑된 키워드 ID 조회 (keyword_analysis_snapshots에서)
  const keywordIds = allTargets.map(t => t.keywordId);
  
  if (keywordIds.length === 0) {
    return [];
  }
  
  const { data: todayRecords, error: historyError } = await supabase
    .from('keyword_analysis_snapshots')
    .select('customer_keyword_id')
    .in('customer_keyword_id', keywordIds)
    .eq('measured_date', today);

  if (historyError) {
    console.error('⚠️ 오늘 스크래핑 이력 조회 실패:', historyError.message);
    // 이력 조회 실패 시에도 전체 키워드 반환 (안전하게)
    return allTargets;
  }

  // 오늘 이미 스크래핑된 키워드 ID Set
  const alreadyScrapedIds = new Set(
    (todayRecords || []).map((r: any) => r.customer_keyword_id)
  );

  // 오늘 스크래핑되지 않은 키워드만 필터링
  const targets = allTargets.filter(t => !alreadyScrapedIds.has(t.keywordId));

  console.log(`✅ 오늘 스크래핑 필요한 키워드: ${targets.length}개 (이미 완료: ${alreadyScrapedIds.size}개)`);
  return targets;
}

/**
 * 오늘 이미 스크래핑된 키워드의 rankings 데이터 조회 (키워드 텍스트 기준)
 * 다른 유저가 같은 키워드를 스크래핑했으면 재사용 가능
 */
export async function getTodaySnapshotByKeyword(keyword: string): Promise<FullRankingResult | null> {
  const supabase = getSupabaseClient();
  const today = new Date().toISOString().split('T')[0];
  
  // 키워드 텍스트로 오늘 스크래핑된 스냅샷 조회 (가장 최근 것)
  const { data, error } = await supabase
    .from('keyword_analysis_snapshots')
    .select('*')
    .ilike('keyword', keyword)  // 대소문자 무시
    .eq('measured_date', today)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('⚠️ 오늘 스냅샷 조회 실패:', error.message);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  const snapshot = data[0];
  
  // DB 데이터를 FullRankingResult로 변환
  const rankings: RankingItem[] = (snapshot.rankings || []).map((r: RankingItemJson) => ({
    rank: r.rank,
    place_id: r.place_id,
    name: r.name,
    visitor_review_count: r.visitor_review_count,
    blog_review_count: r.blog_review_count,
    category: r.category,
    href: r.href,
  }));

  return {
    success: true,
    keyword: snapshot.keyword,
    measuredDate: snapshot.measured_date,
    totalResults: snapshot.total_results,
    rankings,
    timestamp: snapshot.created_at,
  };
}

/**
 * 특정 사용자의 키워드 조회
 */
export async function getKeywordsByUserId(userId: string): Promise<ScrapingTarget[]> {
  const supabase = getSupabaseClient();
  
  const { data, error } = await supabase
    .from('customer_keywords')
    .select(`
      id,
      customer_id,
      keyword,
      customers!inner (
        id,
        client_name,
        place_id,
        business_type,
        user_id
      )
    `)
    .eq('is_active', true)
    .is('deleted_at', null)
    .eq('customers.user_id', userId)
    .not('customers.place_id', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ 사용자 키워드 조회 실패:', error.message);
    throw new Error(`사용자 키워드 조회 실패: ${error.message}`);
  }

  const targets: ScrapingTarget[] = (data || []).map((item: any) => ({
    keywordId: item.id,
    customerId: item.customer_id,
    keyword: item.keyword,
    placeId: item.customers.place_id,
    clientName: item.customers.client_name,
    businessType: item.customers.business_type,
  }));

  return targets;
}

/**
 * 스크래핑 컨텍스트 정보
 */
export interface ScrapingContext {
  keyword: string;
  placeId?: string | null;
  clientName?: string | null;
  customerId?: string | null;
  businessType?: string | null;
}

/**
 * 스크래핑 결과를 keyword_ranking_history에 저장
 * 같은 날짜에 이미 데이터가 있으면 저장하지 않음 (중복 방지)
 */
export async function saveScrapingResult(
  customerKeywordId: string,
  result: ScrapingResult,
  context?: ScrapingContext
): Promise<void> {
  const supabase = getSupabaseClient();
  
  // 오늘 날짜 (YYYY-MM-DD)
  const today = new Date().toISOString().split('T')[0];
  
  // 오늘 이미 저장된 데이터가 있는지 확인
  const { data: existingData, error: checkError } = await supabase
    .from('keyword_ranking_history')
    .select('id')
    .eq('customer_keyword_id', customerKeywordId)
    .eq('measured_date', today)
    .limit(1);

  if (checkError) {
    console.error('⚠️ 중복 체크 실패:', checkError.message);
    // 체크 실패 시에도 계속 진행 (안전하게)
  } else if (existingData && existingData.length > 0) {
    console.log(`⏭️ 이미 오늘(${today}) 데이터가 있어 저장 건너뜀: ${context?.keyword || customerKeywordId}`);
    return;
  }
  
  const insertData: KeywordRankingHistoryInsert = {
    customer_keyword_id: customerKeywordId,
    measured_date: today,
    exposure_rank: result.rank || null,
    visitor_review_count: result.reviewCount || 0,
    blog_review_count: result.blogCount || 0,
    metadata: {
      // 컨텍스트 정보
      keyword: context?.keyword || result.keyword || null,
      place_id: context?.placeId || result.placeId || null,
      client_name: context?.clientName || null,
      customer_id: context?.customerId || null,
      business_type: context?.businessType || null,
      // 스크래핑 결과 정보
      success: result.success,
      error: result.error || null,
      scraped_at: result.timestamp,
    },
  };

  // INSERT: 오늘 데이터가 없을 때만 저장
  const { error } = await supabase
    .from('keyword_ranking_history')
    .insert(insertData as any);

  if (error) {
    console.error('❌ 결과 저장 실패:', error.message);
    throw new Error(`결과 저장 실패: ${error.message}`);
  }
}

/**
 * 전체 순위 스냅샷을 keyword_analysis_snapshots에 저장
 * 같은 날짜에 이미 데이터가 있으면 업데이트
 */
export async function saveAnalysisSnapshot(
  target: ScrapingTarget,
  result: FullRankingResult
): Promise<void> {
  const supabase = getSupabaseClient();
  
  if (!target.userId) {
    console.error('❌ userId가 없어서 스냅샷 저장 불가');
    return;
  }

  const today = result.measuredDate;
  
  // rankings를 JSONB 형식으로 변환
  const rankingsJson: RankingItemJson[] = result.rankings.map(r => ({
    rank: r.rank,
    place_id: r.place_id,
    name: r.name,
    visitor_review_count: r.visitor_review_count,
    blog_review_count: r.blog_review_count,
    category: r.category,
    href: r.href,
    review_count: r.review_count,
    review_count_raw: r.review_count_raw,
  }));

  // 오늘 이미 저장된 데이터가 있는지 확인
  const { data: existingData, error: checkError } = await supabase
    .from('keyword_analysis_snapshots')
    .select('id')
    .eq('customer_keyword_id', target.keywordId)
    .eq('measured_date', today)
    .limit(1);

  if (checkError) {
    console.error('⚠️ 중복 체크 실패:', checkError.message);
  }

  const metadata = {
    client_name: target.clientName,
    customer_id: target.customerId,
    place_id: target.placeId,
    business_type: target.businessType,
    target_rank: result.targetPlaceRank || null,
    target_review_count: result.targetPlaceReviewCount || null,
    target_blog_count: result.targetPlaceBlogCount || null,
    success: result.success,
    error: result.error || null,
    scraped_at: result.timestamp,
  };

  if (existingData && existingData.length > 0) {
    // UPDATE: 기존 데이터 업데이트
    const { error } = await supabase
      .from('keyword_analysis_snapshots')
      .update({
        total_results: result.totalResults,
        rankings: rankingsJson,
        metadata,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', existingData[0].id);

    if (error) {
      console.error('❌ 스냅샷 업데이트 실패:', error.message);
      throw new Error(`스냅샷 업데이트 실패: ${error.message}`);
    }
    
    console.log(`🔄 스냅샷 업데이트 완료: ${target.keyword}`);
  } else {
    // INSERT: 새 데이터 삽입
    const insertData: KeywordAnalysisSnapshotInsert = {
      user_id: target.userId,
      customer_keyword_id: target.keywordId,
      keyword: target.keyword,
      measured_date: today,
      total_results: result.totalResults,
      rankings: rankingsJson,
      metadata,
    };

    const { error } = await supabase
      .from('keyword_analysis_snapshots')
      .insert(insertData as any);

    if (error) {
      console.error('❌ 스냅샷 저장 실패:', error.message);
      throw new Error(`스냅샷 저장 실패: ${error.message}`);
    }
    
    console.log(`💾 스냅샷 저장 완료: ${target.keyword} (${result.totalResults}개 업체)`);
  }

  // customer_keyword_rankings에도 해당 업체의 순위 저장
  await saveCustomerKeywordRanking(target, result);
}

/**
 * customer_keyword_rankings 테이블에 개별 업체 순위 저장
 * keyword_analysis_snapshots의 rankings에서 해당 업체의 순위를 추출하여 저장
 */
export async function saveCustomerKeywordRanking(
  target: ScrapingTarget,
  result: FullRankingResult
): Promise<void> {
  const supabase = getSupabaseClient();
  
  // placeId가 없으면 저장하지 않음
  if (!target.placeId) {
    console.log(`⏭️ placeId가 없어서 customer_keyword_rankings 저장 건너뜀: ${target.keyword}`);
    return;
  }

  const today = result.measuredDate;
  
  // rankings에서 해당 업체의 순위 찾기
  const targetRanking = result.rankings.find(r => r.place_id === target.placeId);
  
  // 순위 정보 (rankings에서 찾거나, 순위 밖이면 result에서 직접 가져옴)
  const exposureRank = targetRanking?.rank || null;
  // 순위 밖 업체도 상세 페이지에서 수집한 리뷰수 사용
  const visitorReviewCount = targetRanking?.visitor_review_count 
    ?? result.targetPlaceReviewCount 
    ?? 0;
  const blogReviewCount = targetRanking?.blog_review_count 
    ?? result.targetPlaceBlogCount 
    ?? 0;
  
  // 오늘 이미 저장된 데이터가 있는지 확인
  const { data: existingData, error: checkError } = await supabase
    .from('customer_keyword_rankings')
    .select('id')
    .eq('customer_keyword_id', target.keywordId)
    .eq('measured_date', today)
    .limit(1);

  if (checkError) {
    console.error('⚠️ customer_keyword_rankings 중복 체크 실패:', checkError.message);
  }

  const metadata = {
    client_name: target.clientName,
    customer_id: target.customerId,
    place_id: target.placeId,
    business_type: target.businessType,
    total_results: result.totalResults,
    found_in_rankings: !!targetRanking,
    scraped_at: result.timestamp,
  };

  if (existingData && existingData.length > 0) {
    // UPDATE: 기존 데이터 업데이트
    const { error } = await supabase
      .from('customer_keyword_rankings')
      .update({
        exposure_rank: exposureRank,
        visitor_review_count: visitorReviewCount,
        blog_review_count: blogReviewCount,
        metadata,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', existingData[0].id);

    if (error) {
      console.error('❌ customer_keyword_rankings 업데이트 실패:', error.message);
      // 에러 발생해도 메인 프로세스 계속 진행
    } else {
      console.log(`🔄 customer_keyword_rankings 업데이트: ${target.keyword} (순위: ${exposureRank || '미노출'})`);
    }
  } else {
    // INSERT: 새 데이터 삽입
    const insertData: CustomerKeywordRankingInsert = {
      customer_keyword_id: target.keywordId,
      measured_date: today,
      exposure_rank: exposureRank,
      visitor_review_count: visitorReviewCount,
      blog_review_count: blogReviewCount,
      metadata,
    };

    const { error } = await supabase
      .from('customer_keyword_rankings')
      .insert(insertData as any);

    if (error) {
      console.error('❌ customer_keyword_rankings 저장 실패:', error.message);
      // 에러 발생해도 메인 프로세스 계속 진행
    } else {
      console.log(`💾 customer_keyword_rankings 저장: ${target.keyword} (순위: ${exposureRank || '미노출'})`);
    }
  }
}

/**
 * 여러 스크래핑 결과 일괄 저장
 * 같은 날짜에 이미 데이터가 있는 키워드는 제외하고 저장
 */
export async function saveScrapingResults(
  results: Array<{
    customerKeywordId: string;
    result: ScrapingResult;
    context?: ScrapingContext;
  }>
): Promise<{ success: number; failed: number; skipped: number }> {
  const supabase = getSupabaseClient();
  const today = new Date().toISOString().split('T')[0];
  
  // 오늘 이미 저장된 키워드 ID 조회
  const keywordIds = results.map(r => r.customerKeywordId);
  const { data: existingRecords, error: checkError } = await supabase
    .from('keyword_ranking_history')
    .select('customer_keyword_id')
    .in('customer_keyword_id', keywordIds)
    .eq('measured_date', today);

  if (checkError) {
    console.error('⚠️ 중복 체크 실패:', checkError.message);
  }

  // 이미 저장된 키워드 ID Set
  const alreadySavedIds = new Set(
    (existingRecords || []).map((r: any) => r.customer_keyword_id)
  );

  // 저장이 필요한 결과만 필터링
  const resultsToSave = results.filter(r => !alreadySavedIds.has(r.customerKeywordId));
  const skippedCount = results.length - resultsToSave.length;

  if (skippedCount > 0) {
    console.log(`⏭️ 이미 오늘 데이터가 있어 ${skippedCount}개 건너뜀`);
  }

  if (resultsToSave.length === 0) {
    console.log('💡 저장할 새로운 데이터가 없습니다.');
    return { success: 0, failed: 0, skipped: skippedCount };
  }
  
  const insertData: KeywordRankingHistoryInsert[] = resultsToSave.map(({ customerKeywordId, result, context }) => ({
    customer_keyword_id: customerKeywordId,
    measured_date: today,
    exposure_rank: result.rank || null,
    visitor_review_count: result.reviewCount || 0,
    blog_review_count: result.blogCount || 0,
    metadata: {
      // 컨텍스트 정보
      keyword: context?.keyword || result.keyword || null,
      place_id: context?.placeId || result.placeId || null,
      client_name: context?.clientName || null,
      customer_id: context?.customerId || null,
      business_type: context?.businessType || null,
      // 스크래핑 결과 정보
      success: result.success,
      error: result.error || null,
      scraped_at: result.timestamp,
    },
  }));

  console.log(`💾 ${insertData.length}개의 스크래핑 결과 일괄 저장 중...`);

  // INSERT: 오늘 데이터가 없는 것만 저장
  const { error } = await supabase
    .from('keyword_ranking_history')
    .insert(insertData as any);

  if (error) {
    console.error('❌ 일괄 저장 실패:', error.message);
    return { success: 0, failed: resultsToSave.length, skipped: skippedCount };
  }

  console.log(`✅ ${insertData.length}개의 결과 저장 완료`);
  return { success: resultsToSave.length, failed: 0, skipped: skippedCount };
}

/**
 * 키워드의 최근 순위 이력 조회
 */
export async function getRecentRankingHistory(
  customerKeywordId: string,
  limit: number = 30
): Promise<KeywordRankingHistoryInsert[]> {
  const supabase = getSupabaseClient();
  
  const { data, error } = await supabase
    .from('keyword_ranking_history')
    .select('*')
    .eq('customer_keyword_id', customerKeywordId)
    .order('measured_date', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('❌ 이력 조회 실패:', error.message);
    throw new Error(`이력 조회 실패: ${error.message}`);
  }

  return (data as KeywordRankingHistoryInsert[]) || [];
}

/**
 * 키워드 업데이트 시간 갱신
 */
export async function updateKeywordTimestamp(customerKeywordId: string): Promise<void> {
  const supabase = getSupabaseClient();
  
  const { error } = await supabase
    .from('customer_keywords')
    .update({ updated_at: new Date().toISOString() } as any)
    .eq('id', customerKeywordId);

  if (error) {
    console.error('❌ 키워드 업데이트 실패:', error.message);
  }
}

/**
 * 최신 순위 정보가 포함된 키워드 목록 조회 (뷰 사용)
 */
export async function getKeywordsWithLatestRanking(
  userId?: string
): Promise<CustomerKeywordWithLatestRanking[]> {
  const supabase = getSupabaseClient();
  
  let query = supabase
    .from('customer_keywords_with_latest_ranking')
    .select('*')
    .eq('is_active', true);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query.order('created_at', { ascending: true });

  if (error) {
    console.error('❌ 키워드 조회 실패:', error.message);
    throw new Error(`키워드 조회 실패: ${error.message}`);
  }

  return (data as CustomerKeywordWithLatestRanking[]) || [];
}

// ============================================
// 스크래핑 로그 관련 함수
// ============================================

/**
 * 스크래핑 로그 생성 (시작 시점)
 */
export async function createScrapingLog(
  totalKeywords: number,
  triggerType: 'scheduled' | 'manual' | 'api' = 'scheduled'
): Promise<string> {
  const supabase = getSupabaseClient();
  
  const insertData = {
    started_at: new Date().toISOString(),
    total_keywords: totalKeywords,
    processed_count: 0,
    failed_count: 0,
    status: 'running' as const,
    trigger_type: triggerType,
    metadata: {},
  };

  const { data, error } = await supabase
    .from('scraping_logs')
    .insert(insertData as any)
    .select('id')
    .single();

  if (error) {
    console.error('❌ 로그 생성 실패:', error.message);
    throw new Error(`로그 생성 실패: ${error.message}`);
  }
  return data.id;
}

/**
 * 스크래핑 로그 업데이트 (완료 시점)
 */
export async function updateScrapingLog(
  logId: string,
  params: {
    processedCount: number;
    failedCount: number;
    status: 'completed' | 'failed';
    errorMessage?: string;
    metadata?: Record<string, any>;
  },
  startTime: number
): Promise<void> {
  const supabase = getSupabaseClient();
  
  const executionTimeMs = Date.now() - startTime;
  
  const updateData = {
    completed_at: new Date().toISOString(),
    processed_count: params.processedCount,
    failed_count: params.failedCount,
    status: params.status,
    error_message: params.errorMessage || null,
    execution_time_ms: executionTimeMs,
    metadata: params.metadata || {},
  };

  const { error } = await supabase
    .from('scraping_logs')
    .update(updateData as any)
    .eq('id', logId);

  if (error) {
    console.error('❌ 로그 업데이트 실패:', error.message);
  }
}

/**
 * 최근 스크래핑 로그 조회
 */
export async function getRecentScrapingLogs(limit: number = 10): Promise<any[]> {
  const supabase = getSupabaseClient();
  
  const { data, error } = await supabase
    .from('scraping_logs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('❌ 로그 조회 실패:', error.message);
    throw new Error(`로그 조회 실패: ${error.message}`);
  }

  return data || [];
}
