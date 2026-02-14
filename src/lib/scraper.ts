import type { ScrapingRequest, ScrapingResult, FullRankingResult, RankingItem } from './types';

// 환경 감지: 로컬 개발 환경인지 확인 (CI 환경은 headless로 실행)
const isLocalDev = !process.env.CI && !process.env.GITHUB_ACTIONS;

/**
 * 브라우저 인스턴스 생성 (공통)
 */
async function createBrowser() {
  const puppeteer = await import('puppeteer');
  return puppeteer.default.launch({
    headless: !isLocalDev,
    defaultViewport: {
      width: 390,
      height: 844,
    },
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
}

/**
 * 페이지 기본 설정 (공통)
 */
async function setupPage(page: any) {
  // 콘솔 로그 포워딩
  page.on('console', async (msg: any) => {
    try {
      const type = msg.type();
      const text = msg.text();
      if (
        text.includes('ncaptcha') ||
        text.includes('NCaptcha') ||
        text === '{}' ||
        text.includes('JSHandle@') ||
        type === 'debug'
      ) {
        return;
      }
      if (isLocalDev || text.includes('✅') || text.includes('🎯') || text.includes('타겟')) {
        console.log(`  [페이지] ${text}`);
      }
    } catch (err) {
      // 무시
    }
  });

  // 모바일 User Agent
  await page.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
  );

  // HTTP 헤더
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  });
}

/**
 * 키워드 전체 순위 수집 (1~300위) + 타겟 업체 리뷰 수
 * 통합 스크래핑 함수
 */
export async function scrapeKeywordRankings(
  keyword: string,
  targetPlaceId?: string
): Promise<FullRankingResult> {
  let browser;
  const today = new Date().toISOString().split('T')[0];

  try {
    browser = await createBrowser();
    const page = await browser.newPage();
    await setupPage(page);

    // 네이버 플레이스 검색
    const searchUrl = `https://m.place.naver.com/place/list?query=${encodeURIComponent(keyword)}&x=126.9783882&y=37.5666103&level=top`;
    
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
      await page.waitForSelector('ul > li a, a[href*="/restaurant/"]', { timeout: 5000 });
    } catch (e) {
      // 계속 진행
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));

    // 전체 300위까지 스크롤하며 데이터 수집
    const rankingData = await page.evaluate(async (targetPlaceId: string | undefined) => {
      const scrollContainer = document.querySelector('.YluNG');
      
      if (!scrollContainer) {
        console.error('스크롤 컨테이너 .YluNG를 찾을 수 없음');
        return { success: false, rankings: [], targetRank: null };
      }
      
      // 현재 로드된 모든 업체 수집 함수
      const collectAllPlaces = () => {
        const newOpenSection = document.querySelector('.phKao.lLNP9');
        let items: Element[] = [];
        const listItems = document.querySelectorAll('ul > li.VLTHu');

        if (listItems.length > 0) {
          items = Array.from(listItems).filter(item => {
            const isInNewOpenSection = item.closest('.phKao.lLNP9') !== null;
            return !isInNewOpenSection;
          });
        }

        const results: Array<{
          rank: number;
          place_id: string;
          name: string;
          href: string;
          category?: string;
        }> = [];
        
        let targetRank: number | null = null;

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          
          const isAd = item.querySelector('.place_ad_label_text') !== null ||
                      (item.textContent || '').includes('광고');
          
          if (isAd) continue;
          
          const link = item.querySelector('a');
          
          if (link) {
            const href = link.getAttribute('href') || '';
            const regex = /\/(place)\/(\d+)/;
            const match = href.match(regex);
            
            if (match) {
              const placeId = match[2];
              let placeName: string | null = null;
              
              const ywYLLInItem = item.querySelector('.YwYLL');
              if (ywYLLInItem) {
                placeName = ywYLLInItem.textContent?.trim() || null;
              }
              
              if (!placeName) {
                placeName = item.textContent?.trim().split('\n')[0] || '알 수 없음';
              }

              // 카테고리 추출 시도
              let category: string | undefined;
              const categoryEl = item.querySelector('.YzBgS');
              if (categoryEl) {
                category = categoryEl.textContent?.trim();
              }

              const currentRank = results.length + 1;
              
              results.push({
                rank: currentRank,
                place_id: placeId,
                name: (placeName || '').substring(0, 100).replace(/\s+/g, ' ').trim(),
                href: href.startsWith('http') ? href : `https://m.place.naver.com${href}`,
                category,
              });

              // 타겟 업체 순위 확인
              if (targetPlaceId && placeId === targetPlaceId) {
                targetRank = currentRank;
                console.log(`✅ 타겟 업체 발견! ${currentRank}위`);
              }
            }
          }
        }

        return { results, targetRank };
      };

      // 300위까지 스크롤
      let previousCount = 0;
      let stableCount = 0;
      const maxAttempts = 30;
      
      for (let i = 0; i < maxAttempts; i++) {
        const currentData = collectAllPlaces();
        const currentCount = currentData.results.length;
        
        console.log(`[${i + 1}/${maxAttempts}] 현재 ${currentCount}개 업체 로드됨`);
        
        if (currentCount >= 300) {
          console.log('✅ 300개 도달!');
          return { 
            success: true, 
            rankings: currentData.results.slice(0, 300),
            targetRank: currentData.targetRank 
          };
        }
        
        // 스크롤
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
        
        const waitTime = currentCount < 100 ? 800 : currentCount < 200 ? 1200 : 1500;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        if (currentCount === previousCount) {
          stableCount++;
          if (stableCount >= 3) {
            console.log(`⚠️ ${currentCount}개에서 로딩 중단됨`);
            return { 
              success: true, 
              rankings: currentData.results,
              targetRank: currentData.targetRank 
            };
          }
        } else {
          stableCount = 0;
        }
        
        previousCount = currentCount;
      }
      
      // 최종 수집
      const finalData = collectAllPlaces();
      return { 
        success: true, 
        rankings: finalData.results,
        targetRank: finalData.targetRank 
      };
    }, targetPlaceId);

    console.log(`📊 전체 ${rankingData.rankings.length}개 업체 수집 완료`);
    
    // 타겟 업체가 있고 발견된 경우, 리뷰 수 수집
    let targetReviewCount: number | undefined;
    let targetBlogCount: number | undefined;

    if (targetPlaceId && rankingData.targetRank) {
      console.log(`🏪 타겟 업체(${rankingData.targetRank}위) 상세 페이지 이동 중...`);
      
      const detailUrl = `https://m.place.naver.com/place/${targetPlaceId}/home`;
      await page.goto(detailUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      try {
        await page.waitForSelector('.place_section_content, [class*="review"]', { timeout: 3000 });
      } catch (e) {
        console.log('⚠️ 리뷰 섹션 대기 타임아웃');
      }

      const reviewData = await page.evaluate(() => {
        let visitorReviews = 0;
        let blogReviews = 0;

        const reviewLinks = document.querySelectorAll('.dAsGb .PXMot a');
        
        reviewLinks.forEach(link => {
          const text = link.textContent || '';
          
          if (text.includes('방문자')) {
            const match = text.match(/(\d+(?:,\d+)*)/);
            if (match) {
              visitorReviews = parseInt(match[1].replace(/,/g, ''));
            }
          }
          
          if (text.includes('블로그')) {
            const match = text.match(/(\d+(?:,\d+)*)/);
            if (match) {
              blogReviews = parseInt(match[1].replace(/,/g, ''));
            }
          }
        });

        // 보조 방법
        if (visitorReviews === 0 || blogReviews === 0) {
          const bodyText = document.body.innerText;
          
          if (visitorReviews === 0) {
            const visitorMatch = bodyText.match(/방문자\s*리뷰\s*(\d+(?:,\d+)*)/);
            if (visitorMatch) {
              visitorReviews = parseInt(visitorMatch[1].replace(/,/g, ''));
            }
          }
          
          if (blogReviews === 0) {
            const blogMatch = bodyText.match(/블로그\s*리뷰\s*(\d+(?:,\d+)*)/);
            if (blogMatch) {
              blogReviews = parseInt(blogMatch[1].replace(/,/g, ''));
            }
          }
        }

        return { visitorReviews, blogReviews };
      });

      targetReviewCount = reviewData.visitorReviews;
      targetBlogCount = reviewData.blogReviews;
      
      console.log(`✅ 타겟 업체 리뷰: 방문자 ${targetReviewCount}, 블로그 ${targetBlogCount}`);

      // rankings 배열에서 타겟 업체 정보 업데이트
      const targetIndex = rankingData.rankings.findIndex(
        (r: any) => r.place_id === targetPlaceId
      );
      if (targetIndex !== -1) {
        rankingData.rankings[targetIndex].visitor_review_count = targetReviewCount;
        rankingData.rankings[targetIndex].blog_review_count = targetBlogCount;
      }
    }

    await browser.close();

    return {
      success: true,
      keyword,
      measuredDate: today,
      totalResults: rankingData.rankings.length,
      rankings: rankingData.rankings as RankingItem[],
      targetPlaceRank: rankingData.targetRank || undefined,
      targetPlaceReviewCount: targetReviewCount,
      targetPlaceBlogCount: targetBlogCount,
      timestamp: new Date().toISOString(),
    };

  } catch (error: any) {
    console.error('❌ 키워드 순위 수집 에러:', error.message);

    if (browser) {
      await browser.close();
    }

    return {
      success: false,
      keyword,
      measuredDate: today,
      totalResults: 0,
      rankings: [],
      timestamp: new Date().toISOString(),
      error: error.message || '크롤링 중 오류 발생',
    };
  }
}

/**
 * 네이버 플레이스 검색 결과 크롤링 (기존 호환용)
 * 새 코드에서는 scrapeKeywordRankings() 사용 권장
 */
export async function scrapeNaverPlace(
  request: ScrapingRequest
): Promise<ScrapingResult> {
  const { keyword, placeId } = request;

  // 새 함수 활용
  const result = await scrapeKeywordRankings(keyword, placeId);

  if (!result.success) {
    return {
      success: false,
      keyword,
      placeId,
      timestamp: result.timestamp,
      error: result.error,
    };
  }

  // placeId가 없으면 전체 검색 결과 반환
  if (!placeId) {
    return {
      success: true,
      keyword,
      placeId: undefined,
      timestamp: result.timestamp,
    };
  }

  // 순위권 밖
  if (!result.targetPlaceRank) {
    return {
      success: false,
      keyword,
      placeId,
      rank: undefined,
      reviewCount: undefined,
      timestamp: result.timestamp,
      error: '순위권 밖 (검색 결과 300위 이하)',
    };
  }

  // 성공
  return {
    success: true,
    keyword,
    placeId,
    rank: result.targetPlaceRank,
    reviewCount: result.targetPlaceReviewCount,
    blogCount: result.targetPlaceBlogCount,
    timestamp: result.timestamp,
  };
}
