/**
 * Supabase 클라이언트 설정
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// 환경변수에서 Supabase 설정 가져오기
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Supabase 클라이언트 인스턴스 (싱글톤)
let supabaseInstance: SupabaseClient | null = null;

/**
 * Supabase 클라이언트 가져오기
 * Lambda 환경에서 재사용을 위해 싱글톤 패턴 사용
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase 환경변수가 설정되지 않았습니다. SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 확인하세요.');
    }
    
    supabaseInstance = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    
    console.log('✅ Supabase 클라이언트 초기화 완료');
  }
  
  return supabaseInstance;
}

export { SupabaseClient };
