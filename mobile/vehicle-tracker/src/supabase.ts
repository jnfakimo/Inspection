import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { encryptedStorage } from './encrypted-storage';

export const supabase = createClient(SUPABASE_URL || 'https://invalid.local', SUPABASE_ANON_KEY || '尚未設定', {
  auth: {
    storage: encryptedStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
