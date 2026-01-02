import 'dotenv/config';
import { scrapeNaverPlace } from './lib/scraper';
import { 
  getActiveKeywords, 
  saveScrapingResult, 
  updateKeywordTimestamp,
  createScrapingLog,
  updateScrapingLog 
} from './lib/keyword-service';
import { ScrapingTarget } from './lib/database.types';

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
 * 단일 키워드 스크래핑 처리
 */
async function processTarget(target: ScrapingTarget): Promise<{
  target: ScrapingTarget;
  success: boolean;
  result?: any;
  error?: string;
}> {
  console.log(`🔍 처리 시작: "${target.keyword}" - ${target.clientName}`);
  
  try {
    // 스크래핑 실행
    const scrapingResult = await scrapeNaverPlace({
      keyword: target.keyword,
      placeId: target.placeId,
    });

    // 결과를 keyword_ranking_history에 저장
    await saveScrapingResult(target.keywordId, scrapingResult, {
      keyword: target.keyword,
      placeId: target.placeId,
      clientName: target.clientName,
      customerId: target.customerId,
      businessType: target.businessType,
    });

    // 키워드 업데이트 시간 갱신
    await updateKeywordTimestamp(target.keywordId);

    console.log(`✅ "${target.keyword}" 완료 - 순위: ${scrapingResult.rank || '순위권 밖'}`);

    return {
      target,
      success: true,
      result: {
        keywordId: target.keywordId,
        customerId: target.customerId,
        clientName: target.clientName,
        keyword: target.keyword,
        placeId: target.placeId,
        success: scrapingResult.success,
        rank: scrapingResult.rank,
        reviewCount: scrapingResult.reviewCount,
        blogCount: scrapingResult.blogCount,
      },
    };

  } catch (error: any) {
    console.error(`❌ "${target.keyword}" 실패:`, error.message);
    
    // 에러가 발생해도 결과 기록
    await saveScrapingResult(target.keywordId, {
      success: false,
      keyword: target.keyword,
      placeId: target.placeId,
      timestamp: new Date().toISOString(),
      error: error.message,
    }, {
      keyword: target.keyword,
      placeId: target.placeId,
      clientName: target.clientName,
      customerId: target.customerId,
      businessType: target.businessType,
    });

    return {
      target,
      success: false,
      error: error.message,
      result: {
        keywordId: target.keywordId,
        customerId: target.customerId,
        clientName: target.clientName,
        keyword: target.keyword,
        placeId: target.placeId,
        success: false,
        error: error.message,
      },
    };
  }
}

/**
 * 배치 스크래핑 실행 (병렬 처리)
 * GitHub Actions에서 정기적으로 호출
 * Supabase에 등록된 모든 활성 키워드에 대해 스크래핑 수행
 */
async function runBatchScraping(): Promise<{ success: boolean; processed: number; failed: number; logId?: string; results: any[] }> {
  console.log('🚀 배치 스크래핑 시작 (병렬 처리)');
  console.log(`⚡ 동시 처리 수: ${CONCURRENCY_LIMIT}개`);

  const startTime = Date.now();
  const results: any[] = [];
  let processed = 0;
  let failed = 0;
  let logId: string | undefined;

  try {
    // 1. Supabase에서 활성 키워드 조회 (customers + customer_keywords 조인)
    const targets: ScrapingTarget[] = await getActiveKeywords();
    
    if (targets.length === 0) {
      console.log('📭 처리할 키워드가 없습니다.');
      return { success: true, processed: 0, failed: 0, results: [] };
    }

    console.log(`📋 ${targets.length}개의 키워드 처리 예정`);

    // 2. 스크래핑 로그 생성
    try {
      logId = await createScrapingLog(targets.length, 'scheduled');
    } catch (logError) {
      console.warn('⚠️ 로그 생성 실패 (계속 진행):', logError);
    }

    // 3. 청크 단위로 병렬 처리
    const chunks = chunkArray(targets, CONCURRENCY_LIMIT);
    console.log(`📦 ${chunks.length}개의 청크로 분할 (청크당 최대 ${CONCURRENCY_LIMIT}개)`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`\n🔄 청크 ${i + 1}/${chunks.length} 처리 중... (${chunk.length}개 키워드)`);

      // 청크 내 모든 키워드 병렬 처리
      const chunkResults = await Promise.all(
        chunk.map(target => processTarget(target))
      );

      // 결과 집계
      for (const result of chunkResults) {
        results.push(result.result);
        if (result.success) {
          processed++;
        } else {
          failed++;
        }
      }

      console.log(`✅ 청크 ${i + 1} 완료 (누적: 성공 ${processed}, 실패 ${failed})`);

      // 청크 간 딜레이 (네이버 차단 방지)
      if (i < chunks.length - 1) {
        console.log('⏳ 다음 청크까지 3초 대기...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    const executionTime = Date.now() - startTime;
    console.log(`\n🎉 배치 처리 완료: 성공 ${processed}개, 실패 ${failed}개`);
    console.log(`⏱️ 총 실행 시간: ${(executionTime / 1000).toFixed(1)}초`);

    // 4. 스크래핑 로그 업데이트 (성공)
    if (logId) {
      await updateScrapingLog(logId, {
        processedCount: processed,
        failedCount: failed,
        status: 'completed',
        metadata: {
          resultsCount: results.length,
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
  console.log('='.repeat(50));

  const result = await runBatchScraping();

  console.log('\n' + '='.repeat(50));
  console.log('📊 최종 결과:');
  console.log(`   - 성공: ${result.processed}개`);
  console.log(`   - 실패: ${result.failed}개`);
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
