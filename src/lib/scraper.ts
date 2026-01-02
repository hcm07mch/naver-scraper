import type { ScrapingRequest, ScrapingResult } from './types';

// 환경 감지: 로컬 개발 환경인지 확인 (CI 환경은 headless로 실행)
const isLocalDev = !process.env.CI && !process.env.GITHUB_ACTIONS;

/**
 * 네이버 플레이스 검색 결과 크롤링
 */
export async function scrapeNaverPlace(
  request: ScrapingRequest
): Promise<ScrapingResult> {
  const { keyword, placeId } = request;
  
  console.log('🚀 크롤링 시작');
  console.log('  - 키워드:', keyword);
  console.log('  - Place ID:', placeId);
  console.log('  - 환경:', isLocalDev ? '로컬 개발' : 'CI/서버');

  let browser;
  let businessType = 'place';

  try {
    const puppeteer = await import('puppeteer');
    
    console.log('🌐 브라우저 실행 중...');
    
    browser = await puppeteer.default.launch({
      headless: !isLocalDev,  // CI에서는 headless, 로컬에서는 화면 표시
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

    const page = await browser.newPage();

    // 콘솔 로그 포워딩
    page.on('console', async (msg) => {
      try {
        const type = msg.type();
        const text = msg.text();
        
        if (text.includes('JSHandle@')) {
          const args = msg.args();
          const values = await Promise.all(
            args.map(arg => arg.jsonValue().catch(() => arg.toString()))
          );
          console.log(`PAGE ${type.toUpperCase()}:`, ...values);
        } else {
          console.log(`PAGE ${type.toUpperCase()}:`, text);
        }
      } catch (err) {
        console.log('PAGE LOG (unserializable):', String(err));
      }
    });

    // 모바일 User Agent 설정
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
    );

    // HTTP 헤더 설정
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });

    // 네이버 플레이스 검색
    const searchUrl = `https://m.place.naver.com/place/list?query=${encodeURIComponent(keyword)}&x=126.9783882&y=37.5666103&level=top`;
    console.log('📍 네이버 플레이스 검색:', searchUrl);

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    console.log('⏳ 페이지 로딩 대기 중...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 리스트 로드 대기
    try {
      await page.waitForSelector('ul > li a, a[href*="/restaurant/"]', { timeout: 5000 });
      console.log('✅ 리스트 로드 완료');
    } catch (e) {
      console.log('⚠️ 리스트 셀렉터 대기 타임아웃 (계속 진행)');
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));

    // 점진적 스크롤 및 순위 확인 (100개 단위로 확인)
    console.log('🔍 점진적 스크롤 및 순위 확인 시작...');
    
    const rankingData = await page.evaluate(async (targetPlaceId, detectedType) => {
      const scrollContainer = document.querySelector('.YluNG');
      
      if (!scrollContainer) {
        console.error('스크롤 컨테이너 .YluNG를 찾을 수 없음');
        return { found: false, rank: null, allResults: [] };
      }
      
      console.log('스크롤 컨테이너 발견:', scrollContainer.className);
      
      // 현재 로드된 업체에서 순위 찾기 함수
      const findPlaceInCurrentList = () => {
        const newOpenSection = document.querySelector('.phKao.lLNP9');
        if (newOpenSection) {
          console.log('ℹ️ "새로 오픈했어요" 섹션 발견 - 제외 처리');
        }
        
        let items: Element[] = [];
        const listItems = document.querySelectorAll('ul > li.VLTHu');

        if (listItems.length > 0) {
          items = Array.from(listItems).filter(item => {
            const isInNewOpenSection = item.closest('.phKao.lLNP9') !== null;
            return !isInNewOpenSection;
          });
        }

        const results: Array<{rank: number; placeId: string; placeName: string; href: string}> = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          
          const itemText = item.textContent || '';
          const isAd = item.querySelector('.place_ad_label_text') !== null ||
                      itemText.includes('광고');
          
          if (isAd) {
            continue;
          }
          
          const link = item.querySelector('a');
          
          if (link) {
            const href = link.getAttribute('href') || '';
            
            let extractedPlaceId: string | null = null;
            const regex = new RegExp(`\\/(place)\\/(\\d+)`);
            const match1 = href.match(regex);
            if (match1) extractedPlaceId = match1[2];
            
            if (extractedPlaceId) {
              let placeName: string | null = null;
              
              const ywYLLInItem = item.querySelector('.YwYLL');
              if (ywYLLInItem) {
                placeName = ywYLLInItem.textContent?.trim() || null;
              }
              
              if (!placeName) {
                placeName = item.textContent?.trim().split('\n')[0] || '알 수 없음';
              }
              
              results.push({
                rank: results.length + 1,
                placeId: extractedPlaceId,
                placeName: (placeName || '').substring(0, 50).replace(/\s+/g, ' ').trim(),
                href: href.startsWith('http') ? href : `https://m.place.naver.com${href}`,
              });

              if (targetPlaceId && extractedPlaceId === targetPlaceId) {
                console.log(`✅ 타겟 업체 발견! ${results.length}위: ${(placeName || '').substring(0, 30)} (ID: ${extractedPlaceId})`);
                return {
                  found: true,
                  rank: results.length,
                  placeId: extractedPlaceId,
                  placeName: (placeName || '').substring(0, 50),
                  allResults: results,
                };
              }
            }
          }
        }

        return {
          found: false,
          rank: null,
          allResults: results,
          currentCount: results.length,
        };
      };

      // 100개, 200개, 300개 단계별로 확인
      const checkPoints = [100, 200, 300];
      let previousItemCount = 0;
      let stableCount = 0;
      const maxAttempts = 20;
      
      for (let checkpoint of checkPoints) {
        console.log(`🎯 ${checkpoint}개 업체 로딩 목표...`);
        
        // 목표 개수에 도달할 때까지 스크롤
        for (let i = 0; i < maxAttempts; i++) {
          const allLinks = Array.from(document.querySelectorAll('a'));
          const placeLinks = allLinks.filter(link => {
            const href = link.getAttribute('href') || '';
            const isPlaceLink = href.includes(`/${detectedType}/`) || href.includes('/place/');
            const isInNewOpenSection = link.closest('.phKao.lLNP9') !== null;
            const isAd = link.closest('[data-ad]') !== null ||
                        link.closest('[class*="ad"]') !== null ||
                        link.closest('[class*="Ad"]') !== null ||
                        link.textContent?.includes('광고');
            
            return isPlaceLink && !isAd && !isInNewOpenSection;
          });
          
          const currentItemCount = new Set(placeLinks.map(link => {
            const href = link.getAttribute('href') || '';
            const regex = new RegExp(`\\/(${detectedType}|place)\\/(\\d+)`);
            const match = href.match(regex);
            return match ? match[2] : null;
          }).filter(id => id !== null)).size;
          
          console.log(`[${i + 1}/${maxAttempts}] 현재 ${currentItemCount}개 업체 로드됨 (목표: ${checkpoint}개)`);
          
          // 목표 개수 도달 시 순위 확인
          if (currentItemCount >= checkpoint) {
            console.log(`✅ ${checkpoint}개 도달! 순위 확인 중...`);
            const result = findPlaceInCurrentList();
            
            if (result.found) {
              console.log(`🎉 ${checkpoint}개 이내에서 발견! 조기 종료`);
              return result;
            }
            
            console.log(`⏭️ ${checkpoint}개 이내에 없음. 다음 단계로...`);
            break;
          }
          
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
          
          if (placeLinks.length > 0) {
            const lastLink = placeLinks[placeLinks.length - 1];
            lastLink.scrollIntoView({ behavior: 'auto', block: 'end' });
          }
          
          const waitTime = currentItemCount < 100 ? 800 :
                          currentItemCount < 200 ? 1200 :
                          currentItemCount < 300 ? 1500 : 2000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
          
          if (currentItemCount === previousItemCount) {
            stableCount++;
            const maxStableCount = currentItemCount < checkpoint ? 3 : 2;
            
            if (stableCount >= maxStableCount) {
              console.log(`⚠️ ${currentItemCount}개에서 로딩 중단됨 (목표 ${checkpoint}개 미달)`);
              const result = findPlaceInCurrentList();
              return result;
            }
          } else {
            stableCount = 0;
          }
          
          previousItemCount = currentItemCount;
        }
      }
      
      // 최종 확인
      console.log('📊 최종 순위 확인...');
      return findPlaceInCurrentList();
    }, placeId, businessType);

    console.log('📊 비즈니스 유형:', businessType);
    console.log('📊 순위 결과:', {
      found: rankingData.found,
      rank: rankingData.rank || null,
      totalScanned: rankingData.allResults?.length || 0,
    });

    // placeId가 없으면 전체 검색 결과 반환
    if (!placeId) {
      await browser.close();
      return {
        success: true,
        keyword,
        placeId: undefined,
        timestamp: new Date().toISOString(),
      };
    }

    // 순위권 밖
    if (!rankingData.found) {
      await browser.close();
      return {
        success: false,
        keyword,
        placeId,
        rank: undefined,
        reviewCount: undefined,
        timestamp: new Date().toISOString(),
        error: '순위권 밖 (검색 결과 300위 이하)',
      };
    }

    // 업체 상세 페이지로 이동하여 리뷰 수 크롤링
    console.log('🏪 업체 상세 페이지 이동 중...');
    const detailUrl = `https://m.place.naver.com/place/${placeId}/home`;
    console.log(`📍 상세 페이지 URL: ${detailUrl}`);
    
    await page.goto(detailUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    console.log('⏳ 상세 페이지 로딩 대기 중...');
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    try {
      await page.waitForSelector('.place_section_content, [class*="review"]', { timeout: 3000 });
      console.log('✅ 리뷰 섹션 로드 완료');
    } catch (e) {
      console.log('⚠️ 리뷰 섹션 대기 타임아웃 (계속 진행)');
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));

    const finalUrl = page.url();
    console.log('리다이렉션 후 URL:', finalUrl);
    
    const typeMatch = finalUrl.match(/m\.place\.naver\.com\/([a-z]+)\//);
    if (typeMatch) {
      businessType = typeMatch[1];
      console.log(`✅ 업체 타입 감지: ${businessType}`);
    } else {
      console.log('⚠️ 업체 타입을 감지하지 못함, 기본값 사용: place');
    }

    console.log(`📌 감지된 업체 타입: ${businessType}`);

    // 리뷰 수 크롤링
    console.log('📝 리뷰 수 확인 중...');
    
    const reviewData = await page.evaluate((businessType) => {
      let visitorReviews = 0;
      let blogReviews = 0;

      // 방법 1: .dAsGb > .PXMot 구조에서 찾기 (가장 정확)
      const reviewLinks = document.querySelectorAll('.dAsGb .PXMot a');
      
      reviewLinks.forEach(link => {
        const text = link.textContent || '';
        console.log('리뷰 링크 텍스트:', text);
        
        // "방문자 리뷰 10,708" 형태에서 숫자 추출
        if (text.includes('방문자')) {
          const match = text.match(/(\d+(?:,\d+)*)/);
          if (match) {
            visitorReviews = parseInt(match[1].replace(/,/g, ''));
            console.log('✅ 방문자리뷰:', visitorReviews);
          }
        }
        
        // "블로그 리뷰 1,041" 형태에서 숫자 추출
        if (text.includes('블로그')) {
          const match = text.match(/(\d+(?:,\d+)*)/);
          if (match) {
            blogReviews = parseInt(match[1].replace(/,/g, ''));
            console.log('✅ 블로그리뷰:', blogReviews);
          }
        }
      });

      // 방법 2: 전체 텍스트에서 정규식으로 찾기 (보조 - 방법1 실패 시)
      if (visitorReviews === 0 || blogReviews === 0) {
        const bodyText = document.body.innerText;
        
        if (visitorReviews === 0) {
          const visitorMatch = bodyText.match(/방문자\s*리뷰\s*(\d+(?:,\d+)*)/);
          if (visitorMatch) {
            visitorReviews = parseInt(visitorMatch[1].replace(/,/g, ''));
            console.log('📝 방문자리뷰 (텍스트):', visitorReviews);
          }
        }
        
        if (blogReviews === 0) {
          const blogMatch = bodyText.match(/블로그\s*리뷰\s*(\d+(?:,\d+)*)/);
          if (blogMatch) {
            blogReviews = parseInt(blogMatch[1].replace(/,/g, ''));
            console.log('📝 블로그리뷰 (텍스트):', blogReviews);
          }
        }
      }

      console.log('🎯 최종 결과 - 방문자:', visitorReviews, '블로그:', blogReviews);
      
      return {
        visitorReviews,
        blogReviews,
        businessType,
      };
    }, businessType);

    console.log('✅ 리뷰 수 수집 완료:', reviewData);

    await browser.close();

    // 최종 결과 반환
    const result: ScrapingResult = {
      success: true,
      keyword,
      placeId,
      rank: rankingData.rank || undefined,
      reviewCount: reviewData.visitorReviews,
      blogCount: reviewData.blogReviews,
      timestamp: new Date().toISOString(),
    };

    console.log('🎉 크롤링 완료!');
    console.log(JSON.stringify(result, null, 2));

    return result;

  } catch (error: any) {
    console.error('❌ 크롤링 에러:', error);

    if (browser) {
      await browser.close();
    }

    return {
      success: false,
      keyword,
      placeId,
      timestamp: new Date().toISOString(),
      error: error.message || '크롤링 중 오류 발생',
    };
  }
}
