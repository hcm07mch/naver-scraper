import 'dotenv/config';
import { scrapeKeywordRankings } from './lib/scraper';
import { scrapePlaceDetailReviews } from './lib/detail-review-scraper';
import { 
  getActiveKeywords, 
  saveAnalysisSnapshot, 
  updateKeywordTimestamp,
  createScrapingLog,
  updateScrapingLog,
  getTodaySnapshotByKeyword
} from './lib/keyword-service';
import { ScrapingTarget } from './lib/database.types';
import { FullRankingResult, PlaceReviewDetail } from './lib/types';

// 병렬 처리 설정
const CONCURRENCY_LIMIT = 3; // 동시에 실행할 크롬 인스턴스 수

/**
 * 배열을 청크로 분할
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * 키워드별로 타겟 그룹화
 * 동일 키워드는 1회만 스크래핑하기 위함
 */
function groupByKeyword(targets: ScrapingTarget[]): Map<string, ScrapingTarget[]> {
  const groups = new Map<string, ScrapingTarget[]>();
  
  for (const target of targets) {
    const keyword = target.keyword.toLowerCase().trim();
    const existing = groups.get(keyword) || [];
    existing.push(target);
    groups.set(keyword, existing);
  }
  
  return groups;
}

/**
 * 키워드 그룹 처리 (스냅샷 재사용 또는 새 스크래핑)
 * 다른 유저가 오늘 이미 스크래핑했으면 해당 데이터 재사용
 * 타겟 업체들의 정확한 리뷰 수는 상세 페이지 방문하여 수집
 */
async function processKeywordGroup(
  keyword: string,
  targets: ScrapingTarget[],
  sharedDetailReviews?: Map<string, PlaceReviewDetail>  // 청크 레벨에서 미리 수집된 상세 리뷰
): Promise<{
  keyword: string;
  success: boolean;
  savedCount: number;
  failedCount: number;
  reused: boolean;  // 기존 스냅샷 재사용 여부
  results: any[];
}> {
  console.log(`🔍 키워드 "${keyword}" 처리 시작 (${targets.length}개 업체)`);
  
  const results: any[] = [];
  let savedCount = 0;
  let failedCount = 0;
  let reused = false;

  try {
    // 1단계: 다른 유저가 오늘 이미 스크래핑했는지 확인
    let scrapingResult = await getTodaySnapshotByKeyword(keyword);
    
    if (scrapingResult) {
      console.log(`♻️ "${keyword}" 기존 스냅샷 재사용 (${scrapingResult.totalResults}개 업체)`);
      reused = true;
    } else {
      // 2단계: 없으면 새로 스크래핑
      console.log(`🌐 "${keyword}" 새로 스크래핑 시작...`);
      scrapingResult = await scrapeKeywordRankings(keyword, targets[0].placeId);
      
      if (!scrapingResult.success) {
        console.error(`❌ "${keyword}" 스크래핑 실패: ${scrapingResult.error}`);
        
        // 모든 타겟에 에러 기록
        for (const target of targets) {
          try {
            await saveAnalysisSnapshot(target, scrapingResult);
          } catch (e) {
            console.error(`⚠️ 에러 스냅샷 저장 실패: ${target.clientName}`);
          }
          failedCount++;
          results.push({
            keywordId: target.keywordId,
            keyword: target.keyword,
            clientName: target.clientName,
            success: false,
            error: scrapingResult.error,
          });
        }
        
        return { keyword, success: false, savedCount, failedCount, reused, results };
      }

      console.log(`📊 "${keyword}" 스크래핑 완료 - ${scrapingResult.totalResults}개 업체 수집`);
    }

    // 3단계: 타겟 업체들의 상세 리뷰 수 (청크 레벨에서 미리 수집된 것 사용)
    let detailReviews: Map<string, PlaceReviewDetail> = sharedDetailReviews || new Map();
    
    // 공유 리뷰가 없으면 개별 수집 (fallback)
    if (!sharedDetailReviews) {
      const targetPlaceIds = targets
        .map(t => t.placeId)
        .filter((id): id is string => !!id);
      
      if (targetPlaceIds.length > 0) {
        console.log(`📝 ${targetPlaceIds.length}개 타겟 업체 상세 리뷰 수집 중...`);
        detailReviews = await scrapePlaceDetailReviews(targetPlaceIds);
      }
    }

    // 4단계: 각 타겟별로 저장 (rankings에서 해당 업체 순위 추출 + 상세 리뷰 반영)
    for (const target of targets) {
      try {
        // rankings에서 해당 타겟의 place_id 찾기
        const targetRanking = scrapingResult.rankings.find(
          r => r.place_id === target.placeId
        );
        
        // 상세 페이지에서 수집한 리뷰 수
        const detailReview = target.placeId ? detailReviews.get(target.placeId) : undefined;

        // 타겟별 맞춤 결과 생성
        // 상세 리뷰 수가 있으면 그걸 사용, 없으면 rankings에서 가져온 대략 수치 또는 0
        const targetResult: FullRankingResult = {
          ...scrapingResult,
          targetPlaceRank: targetRanking?.rank,
          targetPlaceReviewCount: detailReview?.visitor_review_count ?? targetRanking?.visitor_review_count ?? 0,
          targetPlaceBlogCount: detailReview?.blog_review_count ?? targetRanking?.blog_review_count ?? 0,
        };

        await saveAnalysisSnapshot(target, targetResult);
        await updateKeywordTimestamp(target.keywordId);

        const rankInfo = targetRanking ? `${targetRanking.rank}위` : '순위권 밖';
        const reviewInfo = detailReview 
          ? `(방문자: ${detailReview.visitor_review_count}, 블로그: ${detailReview.blog_review_count})`
          : '';
        const reuseTag = reused ? ' (재사용)' : '';
        console.log(`  ✅ ${target.clientName}: ${rankInfo} ${reviewInfo}${reuseTag}`);

        savedCount++;
        results.push({
          keywordId: target.keywordId,
          keyword: target.keyword,
          clientName: target.clientName,
          placeId: target.placeId,
          success: true,
          rank: targetRanking?.rank,
          visitorReviewCount: detailReview?.visitor_review_count,
          blogReviewCount: detailReview?.blog_review_count,
          totalResults: scrapingResult.totalResults,
          reused,
        });

      } catch (error: any) {
        console.error(`  ❌ ${target.clientName} 저장 실패: ${error.message}`);
        failedCount++;
        results.push({
          keywordId: target.keywordId,
          keyword: target.keyword,
          clientName: target.clientName,
          success: false,
          error: error.message,
        });
      }
    }

    return { keyword, success: true, savedCount, failedCount, reused, results };

  } catch (error: any) {
    console.error(`❌ 키워드 "${keyword}" 처리 중 오류:`, error.message);
    
    return { 
      keyword, 
      success: false, 
      savedCount, 
      failedCount: targets.length,
      reused,
      results 
    };
  }
}

/**
 * 배치 스크래핑 실행 (키워드 중복 최적화 + 스냅샷 재사용)
 * GitHub Actions에서 정기적으로 호출
 * - 같은 배치 내 동일 키워드: 1회만 스크래핑
 * - 다른 유저가 오늘 이미 스크래핑한 키워드: 기존 스냅샷 재사용
 */
async function runBatchScraping(): Promise<{ success: boolean; processed: number; failed: number; logId?: string; results: any[] }> {
  console.log('🚀 배치 스크래핑 시작 (크로스-유저 최적화)');
  console.log(`⚡ 동시 처리 수: ${CONCURRENCY_LIMIT}개`);

  const startTime = Date.now();
  const results: any[] = [];
  let processed = 0;
  let failed = 0;
  let reusedCount = 0;  // 재사용된 스냅샷 수
  let scrapedCount = 0; // 새로 스크래핑한 키워드 수
  let logId: string | undefined;

  try {
    // 1. Supabase에서 활성 키워드 조회
    const targets: ScrapingTarget[] = await getActiveKeywords();
    
    if (targets.length === 0) {
      console.log('📭 처리할 키워드가 없습니다.');
      return { success: true, processed: 0, failed: 0, results: [] };
    }

    // 2. 키워드별로 그룹화
    const keywordGroups = groupByKeyword(targets);
    const uniqueKeywords = Array.from(keywordGroups.keys());
    
    console.log(`📋 전체 타겟: ${targets.length}개`);
    console.log(`🔑 고유 키워드: ${uniqueKeywords.length}개 (중복 제거: ${targets.length - uniqueKeywords.length}개)`);

    // 3. 스크래핑 로그 생성
    try {
      logId = await createScrapingLog(targets.length, 'scheduled');
    } catch (logError) {
      console.warn('⚠️ 로그 생성 실패 (계속 진행):', logError);
    }

    // 4. 키워드 그룹 단위로 청크 분할 및 병렬 처리
    const keywordChunks = chunkArray(uniqueKeywords, CONCURRENCY_LIMIT);
    console.log(`📦 ${keywordChunks.length}개의 청크로 분할 (청크당 최대 ${CONCURRENCY_LIMIT}개 키워드)`);

    for (let i = 0; i < keywordChunks.length; i++) {
      const chunk = keywordChunks[i];
      console.log(`\n🔄 청크 ${i + 1}/${keywordChunks.length} 처리 중... (${chunk.length}개 키워드)`);

      // 청크 내 모든 타겟 place_id 수집 (중복 제거)
      const chunkPlaceIds = new Set<string>();
      for (const keyword of chunk) {
        const groupTargets = keywordGroups.get(keyword) || [];
        for (const target of groupTargets) {
          if (target.placeId) {
            chunkPlaceIds.add(target.placeId);
          }
        }
      }

      // 청크 단위로 상세 리뷰 한 번에 수집
      let sharedDetailReviews: Map<string, PlaceReviewDetail> = new Map();
      if (chunkPlaceIds.size > 0) {
        console.log(`📝 청크 내 ${chunkPlaceIds.size}개 업체 상세 리뷰 일괄 수집 중...`);
        sharedDetailReviews = await scrapePlaceDetailReviews(Array.from(chunkPlaceIds));
      }

      // 청크 내 키워드 그룹 병렬 처리 (상세 리뷰 공유)
      const chunkResults = await Promise.all(
        chunk.map(keyword => {
          const groupTargets = keywordGroups.get(keyword) || [];
          return processKeywordGroup(keyword, groupTargets, sharedDetailReviews);
        })
      );

      // 결과 집계
      for (const groupResult of chunkResults) {
        results.push(...groupResult.results);
        processed += groupResult.savedCount;
        failed += groupResult.failedCount;
        if (groupResult.reused) {
          reusedCount++;
        } else if (groupResult.success) {
          scrapedCount++;
        }
      }

      console.log(`✅ 청크 ${i + 1} 완료 (누적: 성공 ${processed}, 실패 ${failed})`);

      // 청크 간 딜레이 (새로 스크래핑한 경우에만)
      const hasNewScraping = chunkResults.some(r => !r.reused && r.success);
      if (i < keywordChunks.length - 1 && hasNewScraping) {
        console.log('⏳ 다음 청크까지 3초 대기...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    const executionTime = Date.now() - startTime;
    console.log(`\n🎉 배치 처리 완료`);
    console.log(`   - 새 스크래핑: ${scrapedCount}개 키워드`);
    console.log(`   - 스냅샷 재사용: ${reusedCount}개 키워드 ♻️`);
    console.log(`   - 저장: 성공 ${processed}개, 실패 ${failed}개`);
    console.log(`⏱️ 총 실행 시간: ${(executionTime / 1000).toFixed(1)}초`);

    // 5. 스크래핑 로그 업데이트 (성공)
    if (logId) {
      await updateScrapingLog(logId, {
        processedCount: processed,
        failedCount: failed,
        status: 'completed',
        metadata: {
          totalTargets: targets.length,
          uniqueKeywords: uniqueKeywords.length,
          newlyScraped: scrapedCount,
          snapshotsReused: reusedCount,
          duplicatesSkipped: targets.length - uniqueKeywords.length,
          concurrency: CONCURRENCY_LIMIT,
        },
      }, startTime);
    }

    return {
      success: true,
      processed,
      failed,
      logId,
      results,
    };

  } catch (error: any) {
    console.error('❌ 배치 핸들러 에러:', error);

    // 스크래핑 로그 업데이트 (실패)
    if (logId) {
      await updateScrapingLog(logId, {
        processedCount: processed,
        failedCount: failed,
        status: 'failed',
        errorMessage: error.message,
      }, startTime);
    }

    return {
      success: false,
      processed,
      failed,
      logId,
      results,
    };
  }
}

/**
 * 메인 실행 함수
 */
async function main() {
  console.log('='.repeat(50));
  console.log('🕐 실행 시간:', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
  console.log('🔧 크로스-유저 키워드 최적화 활성화');
  console.log('='.repeat(50));

  const result = await runBatchScraping();

  console.log('\n' + '='.repeat(50));
  console.log('📊 최종 결과:');
  console.log(`   - 저장 성공: ${result.processed}개`);
  console.log(`   - 저장 실패: ${result.failed}개`);
  console.log('='.repeat(50));

  // 실패가 있으면 exit code 1
  if (result.failed > 0 && result.processed === 0) {
    process.exit(1);
  }
}

// 실행
main().catch((error) => {
  console.error('❌ 치명적 오류:', error);
  process.exit(1);
});
