import Constants from 'expo-constants';

const configuredUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim()
  || String(Constants.expoConfig?.extra?.supabaseUrl || '').trim();
const configuredAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';

export const SUPABASE_URL = configuredUrl;
export const SUPABASE_ANON_KEY = configuredAnonKey;

export function configurationError() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return '尚未設定定位服務連線資訊，請由資訊人員完成 App 環境設定。';
  }
  return '';
}
