import puppeteer, { Browser, Page } from 'puppeteer';
import type { PlaceReviewDetail } from './types';

/**
 * 단일 업체의 상세 페이지에서 리뷰 수 수집
 */
async function scrapeOneDetail(page: Page, placeId: string): Promise<PlaceReviewDetail | null> {
  try {
    const detailUrl = `https://m.place.naver.com/place/${placeId}/home`;
    
    await page.goto(detailUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
      await page.waitForSelector('.place_section_content, [class*="review"]', { timeout: 3000 });
    } catch {
      // 타임아웃은 무시하고 계속 진행
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    const reviewData = await page.evaluate(() => {
      let visitorReviews = 0;
      let blogReviews = 0;

      // 방법 1: .dAsGb > .PXMot 구조에서 찾기
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

      // 방법 2: 전체 텍스트에서 정규식으로 찾기
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

    return {
      place_id: placeId,
      visitor_review_count: reviewData.visitorReviews,
      blog_review_count: reviewData.blogReviews,
      total_review_count: reviewData.visitorReviews + reviewData.blogReviews,
    };

  } catch (error) {
    console.error(`❌ [상세 리뷰] ${placeId} 수집 실패:`, error);
    return null;
  }
}

/**
 * 여러 업체의 상세 페이지에서 리뷰 수 일괄 수집
 * 
 * @param placeIds 수집할 업체 Place ID 배열
 * @param existingBrowser 선택사항: 기존 브라우저 인스턴스 재사용
 * @returns Map<place_id, PlaceReviewDetail>
 */
export async function scrapePlaceDetailReviews(
  placeIds: string[],
  existingBrowser?: Browser
): Promise<Map<string, PlaceReviewDetail>> {
  const results = new Map<string, PlaceReviewDetail>();

  if (placeIds.length === 0) {
    return results;
  }

  console.log(`🔍 [상세 리뷰] ${placeIds.length}개 업체 리뷰 수집 시작...`);

  let browser: Browser;
  const shouldCloseBrowser = !existingBrowser;

  try {
    if (existingBrowser) {
      browser = existingBrowser;
    } else {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
    }

    const page = await browser.newPage();

    // 모바일 User Agent 설정
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
    );

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    });

    for (let i = 0; i < placeIds.length; i++) {
      const placeId = placeIds[i];
      console.log(`  [${i + 1}/${placeIds.length}] ${placeId} 수집 중...`);

      const detail = await scrapeOneDetail(page, placeId);
      
      if (detail) {
        results.set(placeId, detail);
        console.log(`    ✅ 방문자: ${detail.visitor_review_count}, 블로그: ${detail.blog_review_count}`);
      } else {
        console.log(`    ⚠️ 수집 실패`);
      }

      // 요청 간 딜레이 (2-3초)
      if (i < placeIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));
      }
    }

    await page.close();

    if (shouldCloseBrowser) {
      await browser.close();
    }

    console.log(`🎉 [상세 리뷰] ${results.size}/${placeIds.length}개 업체 수집 완료`);

    return results;

  } catch (error) {
    console.error('❌ [상세 리뷰] 수집 에러:', error);
    return results;
  }
}

/**
 * 단일 업체의 상세 리뷰 수집 (순위권 밖 업체용)
 */
export async function scrapeSinglePlaceDetail(
  placeId: string
): Promise<PlaceReviewDetail | null> {
  console.log(`🔍 [상세 리뷰] 단일 업체 ${placeId} 리뷰 수집...`);

  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
    );

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    });

    const detail = await scrapeOneDetail(page, placeId);

    await browser.close();

    if (detail) {
      console.log(`✅ [상세 리뷰] 방문자: ${detail.visitor_review_count}, 블로그: ${detail.blog_review_count}`);
    }

    return detail;

  } catch (error) {
    console.error('❌ [상세 리뷰] 단일 업체 수집 에러:', error);

    if (browser) {
      await browser.close();
    }

    return null;
  }
}
