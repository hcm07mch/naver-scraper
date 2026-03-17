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
  targetPlaceId?: string | null
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
      
      // 리뷰 수 파싱 함수 (예: "리뷰 2.2만" → 22000, "리뷰 3,537" → 3537)
      const parseReviewCount = (text: string): { count: number; raw: string } | null => {
        const match = text.match(/리뷰\s*([\d,.]+)(만)?/);
        if (!match) return null;
        
        const rawValue = match[1] + (match[2] || '');
        let count = parseFloat(match[1].replace(/,/g, ''));
        
        if (match[2] === '만') {
          count = count * 10000;
        }
        
        return { count: Math.round(count), raw: rawValue };
      };

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
          place_name: string;
          href: string;
          category?: string;
          review_count?: number;
          review_count_raw?: string;
        }> = [];
        
        let targetRank: number | null = null;

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          
          const isAd = item.querySelector('.place_ad_label_text') !== null ||
                      (item.textContent || '').includes('광고');
          
          if (isAd) continue;
          
          // 사진 카드 UI 대응: /photo가 없는 업체 상세 링크 우선 선택
          const allLinks = item.querySelectorAll('a[href*="/place/"]');
          let link: Element | null = null;
          let bestHref = '';
          
          for (const a of Array.from(allLinks)) {
            const href = a.getAttribute('href') || '';
            // /photo, /review 등이 없는 순수 상세페이지 링크 우선
            if (href.match(/\/place\/\d+(\?|$)/) || href.match(/\/place\/\d+\/home/)) {
              link = a;
              bestHref = href;
              break;
            }
            // 첫 번째 place 링크 백업
            if (!link && href.includes('/place/')) {
              link = a;
              bestHref = href;
            }
          }
          
          // fallback: 기존 방식
          if (!link) {
            link = item.querySelector('a');
            bestHref = link?.getAttribute('href') || '';
          }
          
          if (link) {
            const href = bestHref;
            const regex = /\/(place)\/(\d+)/;
            const match = href.match(regex);
            
            if (match) {
              const placeId = match[2];
              let placeName: string | null = null;
              
              // 1. 기존 선택자 시도
              const ywYLLInItem = item.querySelector('.YwYLL');
              if (ywYLLInItem) {
                placeName = ywYLLInItem.textContent?.trim() || null;
              }
              
              // 2. 대체 선택자들 시도 (네이버 UI 변경 대응 + 사진 카드 UI)
              if (!placeName) {
                const nameSelectors = [
                  '.place_bluelink',          // 일반 목록
                  '.oVW7l',                   // 사진 카드 UI 업체명
                  '.TYaxT',                   // 일부 키워드
                  '.CHC5F',                   // 업체명 대체 클래스
                  'a[class*="name"]',
                  'span[class*="name"]',
                  '.t3Ji3',                   // 카드형 업체명
                  '[class*="title"]',         // title 포함 클래스
                  'a > span:first-child',
                  '.laII9 span',              // 사진 카드 내 업체명
                ];
                for (const sel of nameSelectors) {
                  const el = item.querySelector(sel);
                  if (el) {
                    const text = el.textContent?.trim();
                    if (text && text.length > 0 && text.length < 100 && !text.includes('리뷰')) {
                      placeName = text;
                      break;
                    }
                  }
                }
              }
              
              // 3. 이미지 alt 속성에서 업체명 추출 시도 (사진 카드)
              if (!placeName) {
                const img = item.querySelector('img');
                if (img) {
                  const alt = img.getAttribute('alt')?.trim();
                  if (alt && alt.length > 0 && alt.length < 100 && !alt.includes('사진') && !alt.includes('이미지')) {
                    placeName = alt;
                  }
                }
              }
              
              // 4. 모든 링크 텍스트에서 추출 시도
              if (!placeName) {
                const allAnchors = item.querySelectorAll('a');
                for (const a of Array.from(allAnchors)) {
                  const aHref = a.getAttribute('href') || '';
                  // 업체 상세 페이지 링크의 텍스트만 확인 (photo, review 제외)
                  if (aHref.includes('/place/') && !aHref.includes('/photo') && !aHref.includes('/review')) {
                    const aText = a.textContent?.trim();
                    if (aText && aText.length > 1 && aText.length < 100) {
                      placeName = aText.split('\n')[0]?.trim() || null;
                      if (placeName) break;
                    }
                  }
                }
              }
              
              // 5. 최종 fallback - 전체 텍스트에서 추출
              if (!placeName) {
                const itemText = item.textContent?.trim();
                const lines = itemText?.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                if (lines && lines.length > 0) {
                  const validName = lines.find(l => 
                    !l.includes('광고') && 
                    !l.includes('AD') &&
                    !l.includes('리뷰') &&
                    !l.includes('사진') &&
                    !l.includes('m') &&  // 거리 정보 제외
                    l.length > 1 && 
                    l.length < 50
                  );
                  placeName = validName || '알 수 없음';
                } else {
                  placeName = '알 수 없음';
                }
              }
              
              // 6. 빈 문자열 방지
              if (!placeName || placeName.trim().length === 0) {
                placeName = '알 수 없음';
                console.warn(`⚠️ 업체명 수집 실패 - place_id: ${placeId}`);
              }

              // 카테고리 추출 시도
              let category: string | undefined;
              const categoryEl = item.querySelector('.YzBgS');
              if (categoryEl) {
                category = categoryEl.textContent?.trim();
              }

              // 리뷰 수 파싱
              const itemText = item.textContent || '';
              const reviewData = parseReviewCount(itemText);

              const currentRank = results.length + 1;
              
              // href 정규화: /photo, /review 등 제거하고 기본 상세 페이지 URL로
              let normalizedHref = href;
              if (href.includes('/place/')) {
                // /place/{id}/photo?... → /place/{id}
                normalizedHref = href.replace(/\/place\/(\d+)\/[^?]*/, '/place/$1');
                // 쿼리스트링 제거 (entry, bk_query 등)
                normalizedHref = normalizedHref.split('?')[0];
              }
              
              results.push({
                rank: currentRank,
                place_id: placeId,
                place_name: (placeName || '').substring(0, 100).replace(/\s+/g, ' ').trim(),
                href: normalizedHref.startsWith('http') ? normalizedHref : `https://m.place.naver.com${normalizedHref}`,
                category,
                review_count: reviewData?.count,
                review_count_raw: reviewData?.raw,
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
      const maxAttempts = 50;  // 더 많은 시도
      
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
        
        // 마지막 아이템으로 스크롤 (더 확실한 방법)
        const allListItems = document.querySelectorAll('ul > li.VLTHu');
        if (allListItems.length > 0) {
          allListItems[allListItems.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
        
        // 추가로 컨테이너 스크롤도 실행
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
        
        // 대기 시간 증가 (100개 경계에서 더 오래 대기)
        let waitTime = 1500;
        if (currentCount >= 95 && currentCount <= 105) {
          waitTime = 2500;  // 100개 근처에서 더 오래 대기
        } else if (currentCount >= 195 && currentCount <= 205) {
          waitTime = 2500;  // 200개 근처에서 더 오래 대기
        }
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        if (currentCount === previousCount) {
          stableCount++;
          // 100의 배수 근처에서는 더 기다려봄
          const nearBoundary = currentCount % 100 >= 95 || currentCount % 100 <= 5;
          const maxStable = nearBoundary ? 8 : 5;
          
          if (stableCount >= maxStable) {
            console.log(`⚠️ ${currentCount}개에서 ${stableCount}회 연속 변화 없음. 로딩 중단.`);
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
    
    // 타겟 업체 리뷰 수 수집 (순위 여부와 관계없이)
    let targetReviewCount: number | undefined;
    let targetBlogCount: number | undefined;

    if (targetPlaceId) {
      const rankStatus = rankingData.targetRank 
        ? `${rankingData.targetRank}위` 
        : '순위 밖';
      console.log(`🏪 타겟 업체(${rankStatus}) 상세 페이지 이동 중...`);
      
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

  // 순위권 밖이지만 리뷰 정보는 반환
  if (!result.targetPlaceRank) {
    return {
      success: true,  // 리뷰 수집은 성공
      keyword,
      placeId,
      rank: undefined,  // 순위 없음 (300위 밖)
      reviewCount: result.targetPlaceReviewCount,
      blogCount: result.targetPlaceBlogCount,
      timestamp: result.timestamp,
      error: result.targetPlaceReviewCount !== undefined 
        ? undefined 
        : '순위권 밖 (검색 결과 300위 이하)',
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
