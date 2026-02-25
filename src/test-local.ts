/**
 * 로컬 테스트용 스크립트
 * 스크래핑을 로컬에서 테스트할 수 있습니다.
 */
import 'dotenv/config';
import { scrapeNaverPlace } from './lib/scraper';
import { 
  getActiveKeywords, 
  saveScrapingResult, 
  updateKeywordTimestamp 
} from './lib/keyword-service';
import { ScrapingTarget } from './lib/database.types';

// ============================================
// 테스트 설정
// ============================================

// 테스트 모드: 'single' = 단일 키워드, 'batch' = Supabase에서 전체 조회
const TEST_MODE: 'single' | 'batch' = 'single';

/**
 * 단일 스크래핑 테스트
 */
async function testSingleScraping() {
  console.log('🧪 단일 스크래핑 테스트 시작...\n');

  try {
    const result = await scrapeNaverPlace({
      keyword: '강남 카페',
      placeId: '1234567890', // 실제 Place ID로 변경
    });
    
    console.log('\n✅ 테스트 완료!');
    console.log('결과:', result);
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
  }
}

/**
 * 배치 스크래핑 테스트
 * Supabase에서 모든 활성 키워드를 조회하여 스크래핑
 */
async function testBatchScraping() {
  console.log('🧪 배치 스크래핑 테스트 시작...\n');
  
  try {
    // Supabase에서 활성 키워드 조회
    const targets: ScrapingTarget[] = await getActiveKeywords();
    
    if (targets.length === 0) {
      console.log('📭 처리할 키워드가 없습니다.');
      return;
    }

    console.log(`📋 ${targets.length}개의 키워드 처리 예정\n`);

    for (const target of targets) {
      console.log(`\n🔍 처리 중: "${target.keyword}" - ${target.clientName}`);
      
      try {
        const result = await scrapeNaverPlace({
          keyword: target.keyword,
          placeId: target.placeId ?? undefined,
        });

        await saveScrapingResult(target.keywordId, result, {
          keyword: target.keyword,
          placeId: target.placeId ?? undefined,
          clientName: target.clientName ?? undefined,
          customerId: target.customerId ?? undefined,
          businessType: target.businessType ?? undefined,
        });

        await updateKeywordTimestamp(target.keywordId);

        console.log(`✅ "${target.keyword}" 완료 - 순위: ${result.rank || '순위권 밖'}`);
      } catch (error: any) {
        console.error(`❌ "${target.keyword}" 실패:`, error.message);
      }

      // 다음 키워드까지 대기 (차단 방지)
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    console.log('\n🎉 배치 테스트 완료!');
  } catch (error) {
    console.error('❌ 배치 테스트 실패:', error);
  }
}

/**
 * 메인 실행
 */
async function main() {
  console.log('='.repeat(50));
  console.log(`테스트 모드: ${TEST_MODE}`);
  console.log('='.repeat(50));

  if (TEST_MODE === 'single') {
    await testSingleScraping();
  } else {
    await testBatchScraping();
  }
}

main().catch(console.error);
